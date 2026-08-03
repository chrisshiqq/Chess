
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovDQoNCi8vIOaji+ebmOW4uOmHj+WumuS5iQ0KY29uc3QgUk9XUyA9IDEwOw0KY29uc3QgQ09MUyA9IDk7DQoNCi8vIOaji+WtkOexu+Wei+WumuS5iQ0KY29uc3QgUElFQ0VfVFlQRVMgPSB7DQogICAgR0VORVJBTDogJ2dlbmVyYWwnLA0KICAgIENIQVJJT1Q6ICdjaGFyaW90JywNCiAgICBDQU5OT046ICdjYW5ub24nLA0KICAgIEhPUlNFOiAnaG9yc2UnLA0KICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLA0KICAgIEFEVklTT1I6ICdhZHZpc29yJywNCiAgICBTT0xESUVSOiAnc29sZGllcicNCn07DQoNCi8vIOadkOaWmeWAvOadg+mHjemFjee9rg0KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGdlbmVyYWw6IDEwMDAwLCAgLy8g5bCGL+W4hQ0KICAgIGNoYXJpb3Q6IDkwMCwgICAgIC8vIOi9pg0KICAgIGNhbm5vbjogew0KICAgICAgICBlYXJseTogNDUwLCAgICAvLyDlvIDlsYDpmLbmrrUNCiAgICAgICAgbWlkOiA0MDAsICAgICAgLy8g5Lit5bGA6Zi25q61DQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQ0KICAgIH0sICAgICAgICAgICAgICAgIC8vIOeCrg0KICAgIGhvcnNlOiB7DQogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDQ1MCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsDQogICAgZWxlcGhhbnQ6IDIwMCwgICAgLy8g6LGhL+ebuA0KICAgIGFkdmlzb3I6IDIwMCwgICAgIC8vIOWjqy/ku5UNCiAgICBzb2xkaWVyOiB7DQogICAgICAgIGVhcmx5OiAxMDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDIwMCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSAgICAgICAgICAgICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIOaji+WtkOS7t+WAvOadg+mHjemFjee9rg0KbGV0IFZBTFVFX1dFSUdIVFMgPSB7DQogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQ0KICAgIC8vcG9zaXRpb246IDAuMiwgICAvLyDkvY3nva7lgLzmnYPph40NCiAgICAvL3RocmVhdDogMC4xNSwgICAgLy8g5aiB6IOB5YC85p2D6YeNDQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQ0KICAgIC8vc2FmZXR5OiAwLjEsICAgICAvLyDlronlhajlgLzmnYPph40NCiAgICAvL21vYmlsaXR5OiAwLjA1ICAgLy8g5py65Yqo5YC85p2D6YeNDQoNCiAgICBtYXRlcmlhbDogMSwgICAgLy8g5p2Q5paZ5YC85p2D6YeNDQogICAgcG9zaXRpb246IDEsICAgIC8vIOS9jee9ruWAvOadg+mHjQ0KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQ0KICAgIHRhY3RpYzogMSwgICAgICAvLyDmiJjmnK/lgLzmnYPph40NCiAgICBzYWZldHk6IDEsICAgICAgLy8g5a6J5YWo5YC85p2D6YeNDQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQ0KfTsNCg0KLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XDQpjb25zdCBFVkFMVUFUSU9OX1BBUkFNRVRFUlMgPSB7DQogICAgLy8g5py65Yqo5YC85Y+C5pWwDQogICAgbW9iaWxpdHk6IHsNCiAgICAgICAgYmFzZU1vdmVWYWx1ZTogMSwgICAgICAvLyDln7rnoYDnp7vliqjku7flgLwNCiAgICB9LA0KICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQ0KICAgIGNoZWNrOiB7DQogICAgICAgIGJvbnVzOiA4MA0KICAgIH0NCn07DQoNCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rg0KY29uc3QgUE9TSVRJT05fVEFCTEVTID0gew0KICAgIC8vIOWFtS/ljZLkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBzb2xkaWVyOiBbDQogICAgICAgIFswLCA1LCAxMCwgMTUsIDIwLCAxNSwgMTAsIDUsIDBdLA0KICAgICAgICBbNSwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgY2hhcmlvdDogWw0KICAgICAgICBbNSwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDEwLCA1LCAxNSwgMCwgMTUsIDUsIDEwLCAxMF0sDQogICAgICAgIFswLCAxMCwgNSwgNSwgNSwgNSwgMTAsIDUsIDBdDQogICAgXSwNCiAgICAvLyDpqazkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBob3JzZTogWw0KICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgICAgICAgWzAsIDUsIDI1LCAxMCwgMTAsIDEwLCAyNSwgNSwgMF0sDQogICAgICAgIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sDQogICAgICAgIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMjUsIDIwLCAwLCAyMCwgMjUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgICAgICAgWzUsIDAsIDUsIDUsIDAsIDUsIDUsIDAsIDVdLA0KICAgICAgICBbMCwgMCwgMCwgNSwgLTIwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDngq7kvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBjYW5ub246IFsNCiAgICAgICAgWzEwLCAyMCwgMTUsIDEwLCAwLCAxMCwgMTUsIDIwLCAxMF0sDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLA0KICAgICAgICBbNSwgNSwgMTUsIDUsIDI1LCA1LCAxNSwgNSwgNV0sDQogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLA0KICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogICAgICAgIFsxMCwgMTAsIDE1LCAyMCwgMzAsIDIwLCAxNSwgMTAsIDEwXSwgDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBlbGVwaGFudDogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g5aOr5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgYWR2aXNvcjogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCA1LCAwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDEwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0NCiAgICBdDQp9Ow0KDQovLyDojrflj5bmo4vlrZDnmoTmnZDmlpnlgLwNCmNvbnN0IGdldE1hdGVyaWFsVmFsdWUgPSAocGllY2UsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOw0KICAgIA0KICAgIC8vIOmSiOWvueacieWIhumYtuauteadkOaWmeWAvOeahOWFteenje+8iOWFteOAgeeCruOAgemprO+8ieiwg+aVtOadkOaWmeWAvA0KICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7DQogICAgICAgIHZhbHVlID0gdmFsdWVbZ2FtZVN0YWdlXSB8fCB2YWx1ZS5taWQ7DQogICAgfQ0KICAgIA0KICAgIHJldHVybiB2YWx1ZTsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOS9jee9ruWAvA0KY29uc3QgZ2V0UG9zaXRpb25WYWx1ZSA9IChwaWVjZSwgciwgYykgPT4gew0KICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOw0KICAgIGlmICghdGFibGUpIHJldHVybiAwOw0KICAgIA0KICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqA0KICAgIGNvbnN0IHJvd0lkeCA9IHBpZWNlLmNvbG9yID09PSAncmVkJyA/ICg5LSByKSA6IHI7DQogICAgcmV0dXJuIHRhYmxlW3Jvd0lkeF1bY10gfHwgMDsNCn07DQoNCi8vIFNlYXJjaCBsZWF2ZXMgdXNlIG51bWVyaWMgcGllY2UgY29kZXMuIEZsYXR0ZW4gcG9zaXRpb24gdmFsdWVzIG9uY2Ugc28gdGhlDQovLyBob3QgZXZhbHVhdG9yIG5ldmVyIGhhcyB0byBkZXJlZmVyZW5jZSBhIHBpZWNlIG9iamVjdCBvciBhIG5lc3RlZCB0YWJsZS4NCmNvbnN0IFNFQVJDSF9QT1NJVElPTl9WQUxVRVMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAxNiB9LCAoKSA9PiBuZXcgSW50MTZBcnJheSg5MCkpOw0KKCgpID0+IHsNCiAgICBjb25zdCB0eXBlVGFibGVzID0gWw0KICAgICAgICBudWxsLA0KICAgICAgICBudWxsLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuY2hhcmlvdCwNCiAgICAgICAgUE9TSVRJT05fVEFCTEVTLmhvcnNlLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuZWxlcGhhbnQsDQogICAgICAgIFBPU0lUSU9OX1RBQkxFUy5hZHZpc29yLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuY2Fubm9uLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuc29sZGllcg0KICAgIF07DQogICAgZm9yIChsZXQgcGllY2VDb2RlID0gMTsgcGllY2VDb2RlIDwgMTY7IHBpZWNlQ29kZSsrKSB7DQogICAgICAgIGNvbnN0IHRhYmxlID0gdHlwZVRhYmxlc1twaWVjZUNvZGUgJiA3XTsNCiAgICAgICAgaWYgKCF0YWJsZSkgY29udGludWU7DQogICAgICAgIGNvbnN0IGlzUmVkID0gcGllY2VDb2RlIDwgODsNCiAgICAgICAgY29uc3QgdmFsdWVzID0gU0VBUkNIX1BPU0lUSU9OX1ZBTFVFU1twaWVjZUNvZGVdOw0KICAgICAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgOTA7IHNxKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHIgPSAoc3EgLyA5KSB8IDA7DQogICAgICAgICAgICB2YWx1ZXNbc3FdID0gdGFibGVbaXNSZWQgPyA5IC0gciA6IHJdW3NxICUgOV0gfHwgMDsNCiAgICAgICAgfQ0KICAgIH0NCn0pKCk7DQoNCi8vIOaUu+WHu+S9jeWbvu+8mjkwIOagvOeUqCAzw5dVaW50MzLjgILmkJzntKLlj7blj6rpnIDjgIzmmK/lkKbmlYzmjqfjgI3vvJvngrnmo4svVUkg5LuN55So5o6n5Yi26ICF5YiX6KGo44CCDQpjb25zdCBBVFRBQ0tfV09SRFMgPSAzOw0KY29uc3Qgc2NyYXRjaFJlZEF0dGFjayA9IG5ldyBVaW50MzJBcnJheShBVFRBQ0tfV09SRFMpOw0KY29uc3Qgc2NyYXRjaEJsYWNrQXR0YWNrID0gbmV3IFVpbnQzMkFycmF5KEFUVEFDS19XT1JEUyk7DQovLyB0cnVlPeaQnOe0ouWPtueUqOaUu+WHu+S9jeWbvu+8iOm7mOiupO+8ie+8m2ZhbHNlPeWPtuivhOS8sOS7jeW7uiAxMMOXOSDmjqfliLbogIXooajvvIhBL0LvvIkNCi8vIHRydWU95YWz57O755So5qC85L2NIFVpbnQzMiDmlLsv5a6IL+aOpyBtYXNr77yI6buY6K6k77yJ77ybZmFsc2U9dGhyZWF0L2d1YXJkIOWvueixoeWIl+ihqO+8iEEvQu+8iQ0KLy8gUGFja2VkIGRlc3RpbmF0aW9ucy9yYXlzIGFuZCBpbmxpbmVkIHJlbGF0aW9uIHdyaXRlcyBmb3Igc2VhcmNoIGxlYXZlcy4NCi8vIEtlcHQgc2VwYXJhdGUgZnJvbSB0aGUgb3JpZ2luYWwgc3BlY2lhbGl6ZWQgcGF0aCBmb3IgYmVuY2htYXJrIHZlcmlmaWNhdGlvbi4NCi8vIOaQnOe0ouacn+mXtOe7tOaKpOe0p+WHkeaji+WtkOihqO+8jOmBv+WFjeWPtuivhOS8sC/nnYDms5Xlh4blpIflj43lpI3miavmj48gMTB4OSDlr7nosaHmo4vnm5jvvIhBL0Ig5Y+v5YWz6Zet77yJDQovLyDpnZnpu5jmkJzntKLlkIPlrZDnlJ/miJDlpI3nlKjmkJzntKLmgIHmo4vlrZDooajvvJvni6znq4vlvIDlhbPnlKjkuo4gQS9C44CCDQovLyDku4Xln7rlh4bor4rmlq3lvIDlkK/vvJrpop3lpJYgcGVyZm9ybWFuY2Uubm93IOS8muW9seWTjee7neWvueiAl+aXtu+8jOato+W8j+WvueW8iOS/neaMgeWFs+mXreOAgg0KbGV0IFNFQVJDSF9QUk9GSUxFID0gZmFsc2U7DQoNCmNvbnN0IGNsZWFyQXR0YWNrQml0cyA9IChiaXRzKSA9PiB7DQogICAgYml0c1swXSA9IDA7DQogICAgYml0c1sxXSA9IDA7DQogICAgYml0c1syXSA9IDA7DQp9Ow0KDQpjb25zdCBzZXRBdHRhY2tCaXQgPSAoYml0cywgc3EpID0+IHsNCiAgICBiaXRzW3NxID4+PiA1XSB8PSAoMSA8PCAoc3EgJiAzMSkpOw0KfTsNCg0KY29uc3QgaGFzQXR0YWNrQml0ID0gKGJpdHMsIHNxKSA9PiAoYml0c1tzcSA+Pj4gNV0gJiAoMSA8PCAoc3EgJiAzMSkpKSAhPT0gMDsNCg0KY29uc3QgbWFrZUVtcHR5Q29udHJvbGxlckdyaWQgPSAoKSA9Pg0KICAgIEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpLm1hcCgoKSA9PiBbXSkpOw0KDQovLyDlhbPns7sgbWFza++8muacgOWkmiAzMiDlrZDvvIjkuK3lm73osaHmo4vmu6Hnm5jvvInvvIxiaXQgaSA9IHBpZWNlc0luZm9baV0NCmNvbnN0IFJFTF9TUVVBUkVTID0gOTA7DQpjb25zdCBzY3JhdGNoQXR0YWNrTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7ICAvLyDmlYzlrZDmiYDlnKjmoLzvvJrosIHlnKjmiZPlroMNCmNvbnN0IHNjcmF0Y2hHdWFyZE1hc2sgPSBuZXcgVWludDMyQXJyYXkoUkVMX1NRVUFSRVMpOyAgIC8vIOWPi+WGm+aJgOWcqOagvO+8muiwgeWcqOS/neWugw0KY29uc3Qgc2NyYXRjaENvbnRyb2xNYXNrID0gbmV3IFVpbnQzMkFycmF5KFJFTF9TUVVBUkVTKTsgLy8g56m65o6n5qC877ya6LCB5o6n5Yi25a6D77yI5a+56b2Q5penIGJvYXJkSW5mb++8iQ0KDQpjb25zdCBjbGVhclJlbGF0aW9uTWFza3MgPSAoY2xlYXJDb250cm9sID0gdHJ1ZSkgPT4gew0KICAgIHNjcmF0Y2hBdHRhY2tNYXNrLmZpbGwoMCk7DQogICAgc2NyYXRjaEd1YXJkTWFzay5maWxsKDApOw0KICAgIGlmIChjbGVhckNvbnRyb2wpIHNjcmF0Y2hDb250cm9sTWFzay5maWxsKDApOw0KfTsNCg0KLy8g5qC85L2NIOKGkiBwaWVjZXNJbmZvIOW8leeUqO+8iOabv+S7o+avj+WPtiBuZXcgTWFw77yJDQpjb25zdCBzY3JhdGNoUGllY2VBdFNxID0gbmV3IEFycmF5KFJFTF9TUVVBUkVTKTsNCmNvbnN0IGNsZWFyUGllY2VBdFNxID0gKCkgPT4gew0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgUkVMX1NRVUFSRVM7IGkrKykgc2NyYXRjaFBpZWNlQXRTcVtpXSA9IG51bGw7DQp9Ow0KDQovLyDlpI3nlKggcmVsQ3R477yM6YG/5YWN5q+P5a2QIG5ldyDlsI/lr7nosaENCmNvbnN0IHNjcmF0Y2hSZWxDdHggPSB7DQogICAgdXNlTWFza3M6IHRydWUsDQogICAgc2tpcENvbnRyb2xNYXNrOiBmYWxzZSwgLy8g5pCc57Si5Y+277ya5LiN5YaZ56m65o6nIGNvbnRyb2xNYXNr77yI5LuN5YaZ5pS75Ye75L2N5Zu+K+acuuWKqO+8iQ0KICAgIHBpZWNlSW5kZXg6IDAsDQogICAgYXR0YWNrTWFzazogbnVsbCwNCiAgICBndWFyZE1hc2s6IG51bGwsDQogICAgY29udHJvbE1hc2s6IG51bGwsDQogICAgcmVkQXR0YWNrOiBudWxsLA0KICAgIGJsYWNrQXR0YWNrOiBudWxsDQp9Ow0KDQpjb25zdCBzY3JhdGNoTGVhZlBpZWNlc0luZm8gPSBbXTsNCmNvbnN0IHNjcmF0Y2hMZWFmUGllY2VTbG90cyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDMyIH0sIChfLCBwaWVjZUluZGV4KSA9PiAoew0KICAgIHBpZWNlOiBudWxsLA0KICAgIHBpZWNlQ29kZTogMCwNCiAgICByOiAwLA0KICAgIGM6IDAsDQogICAgc3E6IDAsDQogICAgcGllY2VJbmRleCwNCiAgICBtb3ZlczogW10sDQogICAgYWxseUd1YXJkczogW10sDQogICAgbWF0ZXJpYWxWYWx1ZTogMCwNCiAgICBwb3NpdGlvblZhbHVlOiAwLA0KICAgIHRocmVhdFZhbHVlOiAwLA0KICAgIHNhZmV0eVZhbHVlOiAwLA0KICAgIHRhY3RpY1ZhbHVlOiAwLA0KICAgIG1vYmlsaXR5VmFsdWU6IDAsDQogICAgdGhyZWF0OiBbXSwNCiAgICB0aHJlYXRlbmVkQnk6IFtdLA0KICAgIGd1YXJkOiBbXSwNCiAgICBndWFyZGVkQnk6IFtdLA0KICAgIGNvbnRyb2w6IFtdLA0KICAgIHByb3RlY3Q6IFtdDQp9KSk7DQoNCmNvbnN0IHNjcmF0Y2hMZWFmQm9hcmRJbmZvID0gew0KICAgIHVzZVJlbGF0aW9uTWFza3M6IHRydWUsDQogICAgdXNlQXR0YWNrQml0czogdHJ1ZSwNCiAgICBza2lwQ29udHJvbE1hc2s6IHRydWUsDQogICAgYXR0YWNrTWFzazogc2NyYXRjaEF0dGFja01hc2ssDQogICAgZ3VhcmRNYXNrOiBzY3JhdGNoR3VhcmRNYXNrLA0KICAgIGNvbnRyb2xNYXNrOiBzY3JhdGNoQ29udHJvbE1hc2ssDQogICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgIGJsYWNrQXR0YWNrOiBzY3JhdGNoQmxhY2tBdHRhY2sNCn07DQoNCmxldCBhY3RpdmVTZWFyY2hQaWVjZVN0YXRlID0gbnVsbDsNCg0KY29uc3Qgc2VhcmNoUGllY2VUeXBlQ29kZSA9ICh0eXBlKSA9PiB7DQogICAgc3dpdGNoICh0eXBlKSB7DQogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuR0VORVJBTDogcmV0dXJuIDE7DQogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuQ0hBUklPVDogcmV0dXJuIDI7DQogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuSE9SU0U6IHJldHVybiAzOw0KICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkVMRVBIQU5UOiByZXR1cm4gNDsNCiAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5BRFZJU09SOiByZXR1cm4gNTsNCiAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5DQU5OT046IHJldHVybiA2Ow0KICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLlNPTERJRVI6IHJldHVybiA3Ow0KICAgICAgICBkZWZhdWx0OiByZXR1cm4gMDsNCiAgICB9DQp9Ow0KDQpjb25zdCBzZWFyY2hQaWVjZUNvZGUgPSAocGllY2UpID0+IHNlYXJjaFBpZWNlVHlwZUNvZGUocGllY2UudHlwZSkgKyAocGllY2UuY29sb3IgPT09ICdyZWQnID8gMCA6IDgpOw0KDQpjb25zdCBTRUFSQ0hfTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGVhcmx5OiBuZXcgSW50MTZBcnJheShbMCwgMTAwMDAsIDkwMCwgNDAwLCAyMDAsIDIwMCwgNDUwLCAxMDBdKSwNCiAgICBtaWQ6IG5ldyBJbnQxNkFycmF5KFswLCAxMDAwMCwgOTAwLCA0NTAsIDIwMCwgMjAwLCA0MDAsIDIwMF0pLA0KICAgIGxhdGU6IG5ldyBJbnQxNkFycmF5KFswLCAxMDAwMCwgOTAwLCA0NTAsIDIwMCwgMjAwLCA0MDAsIDQ1MF0pDQp9Ow0KDQpjb25zdCBzZWFyY2hNYXRlcmlhbFRhYmxlID0gKGdhbWVTdGFnZSkgPT4gU0VBUkNIX01BVEVSSUFMX1ZBTFVFU1tnYW1lU3RhZ2VdIHx8IFNFQVJDSF9NQVRFUklBTF9WQUxVRVMubWlkOw0KDQpjb25zdCBjcmVhdGVTZWFyY2hQaWVjZVN0YXRlID0gKGJvYXJkLCBnYW1lU3RhZ2UgPSAnbWlkJykgPT4gew0KICAgIGNvbnN0IHJlY29yZHMgPSBbXTsNCiAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBuZXcgSW50OEFycmF5KFJFTF9TUVVBUkVTKTsNCiAgICBjb25zdCBzcXVhcmVDb2RlcyA9IG5ldyBVaW50OEFycmF5KFJFTF9TUVVBUkVTKTsNCiAgICBjb25zdCBwaWVjZUNvZGVzID0gbmV3IFVpbnQ4QXJyYXkoMzIpOw0KICAgIGNvbnN0IG1hdGVyaWFsVmFsdWVzID0gc2VhcmNoTWF0ZXJpYWxUYWJsZShnYW1lU3RhZ2UpOw0KICAgIGxldCByZWRNYXRlcmlhbCA9IDA7DQogICAgbGV0IHJlZFBvc2l0aW9uID0gMDsNCiAgICBsZXQgYmxhY2tNYXRlcmlhbCA9IDA7DQogICAgbGV0IGJsYWNrUG9zaXRpb24gPSAwOw0KICAgIGxldCByZWRHZW5lcmFsU3EgPSAtMTsNCiAgICBsZXQgYmxhY2tHZW5lcmFsU3EgPSAtMTsNCiAgICBzcXVhcmVUb1Nsb3QuZmlsbCgtMSk7DQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAoIXBpZWNlKSBjb250aW51ZTsNCiAgICAgICAgICAgIGlmIChyZWNvcmRzLmxlbmd0aCA+PSAzMikgcmV0dXJuIG51bGw7DQogICAgICAgICAgICBjb25zdCBzbG90ID0gcmVjb3Jkcy5sZW5ndGg7DQogICAgICAgICAgICByZWNvcmRzLnB1c2goeyBwaWVjZSwgciwgYywgc3E6IHIgKiA5ICsgYywgYWxpdmU6IHRydWUgfSk7DQogICAgICAgICAgICBjb25zdCBjb2RlID0gc2VhcmNoUGllY2VDb2RlKHBpZWNlKTsNCiAgICAgICAgICAgIGlmICgoY29kZSAmIDcpID09PSAxKSB7DQogICAgICAgICAgICAgICAgaWYgKGNvZGUgPCA4KSByZWRHZW5lcmFsU3EgPSByICogOSArIGM7DQogICAgICAgICAgICAgICAgZWxzZSBibGFja0dlbmVyYWxTcSA9IHIgKiA5ICsgYzsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHBpZWNlQ29kZXNbc2xvdF0gPSBjb2RlOw0KICAgICAgICAgICAgc3F1YXJlVG9TbG90W3IgKiA5ICsgY10gPSBzbG90Ow0KICAgICAgICAgICAgc3F1YXJlQ29kZXNbciAqIDkgKyBjXSA9IGNvZGU7DQogICAgICAgICAgICBjb25zdCBtYXRlcmlhbFZhbHVlID0gbWF0ZXJpYWxWYWx1ZXNbY29kZSAmIDddOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25WYWx1ZSA9IFNFQVJDSF9QT1NJVElPTl9WQUxVRVNbY29kZV1bciAqIDkgKyBjXTsNCiAgICAgICAgICAgIGlmIChjb2RlIDwgOCkgew0KICAgICAgICAgICAgICAgIHJlZE1hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICAgICAgcmVkUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgYmxhY2tNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgIGJsYWNrUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICByZXR1cm4gew0KICAgICAgICBib2FyZCwNCiAgICAgICAgcmVjb3JkcywNCiAgICAgICAgc3F1YXJlVG9TbG90LA0KICAgICAgICBzcXVhcmVDb2RlcywNCiAgICAgICAgcGllY2VDb2RlcywNCiAgICAgICAgbWF0ZXJpYWxWYWx1ZXMsDQogICAgICAgIHJlZE1hdGVyaWFsLA0KICAgICAgICByZWRQb3NpdGlvbiwNCiAgICAgICAgYmxhY2tNYXRlcmlhbCwNCiAgICAgICAgYmxhY2tQb3NpdGlvbiwNCiAgICAgICAgcmVkR2VuZXJhbFNxLA0KICAgICAgICBibGFja0dlbmVyYWxTcSwNCiAgICAgICAgbW92ZXJTdGFjazogbmV3IEludDhBcnJheSgzMiksDQogICAgICAgIGNhcHR1cmVkU3RhY2s6IG5ldyBJbnQ4QXJyYXkoMzIpLA0KICAgICAgICBzdGFja0RlcHRoOiAwDQogICAgfTsNCn07DQoNCmNvbnN0IGFjdGl2ZVBpZWNlU3RhdGVGb3IgPSAoYm9hcmQpID0+IHsNCiAgICBjb25zdCBzdGF0ZSA9IGFjdGl2ZVNlYXJjaFBpZWNlU3RhdGU7DQogICAgcmV0dXJuIHN0YXRlICYmIHN0YXRlLmJvYXJkID09PSBib2FyZCA/IHN0YXRlIDogbnVsbDsNCn07DQoNCmNvbnN0IHVwZGF0ZVBpZWNlU3RhdGVBZnRlck1ha2UgPSAoYm9hcmQsIGZyb21TcSwgdG9TcSkgPT4gew0KICAgIGNvbnN0IHN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgaWYgKCFzdGF0ZSkgcmV0dXJuOw0KICAgIGNvbnN0IG1vdmVyU2xvdCA9IHN0YXRlLnNxdWFyZVRvU2xvdFtmcm9tU3FdOw0KICAgIGNvbnN0IGNhcHR1cmVkU2xvdCA9IHN0YXRlLnNxdWFyZVRvU2xvdFt0b1NxXTsNCiAgICBjb25zdCBzdGFja0luZGV4ID0gc3RhdGUuc3RhY2tEZXB0aCsrOw0KICAgIHN0YXRlLm1vdmVyU3RhY2tbc3RhY2tJbmRleF0gPSBtb3ZlclNsb3Q7DQogICAgc3RhdGUuY2FwdHVyZWRTdGFja1tzdGFja0luZGV4XSA9IGNhcHR1cmVkU2xvdDsNCiAgICBpZiAobW92ZXJTbG90IDwgMCkgcmV0dXJuOw0KDQogICAgY29uc3QgbW92ZXIgPSBzdGF0ZS5yZWNvcmRzW21vdmVyU2xvdF07DQogICAgY29uc3QgbW92ZXJDb2RlID0gc3RhdGUucGllY2VDb2Rlc1ttb3ZlclNsb3RdOw0KICAgIGNvbnN0IG1vdmVyUG9zaXRpb25EZWx0YSA9IFNFQVJDSF9QT1NJVElPTl9WQUxVRVNbbW92ZXJDb2RlXVt0b1NxXSAtDQogICAgICAgIFNFQVJDSF9QT1NJVElPTl9WQUxVRVNbbW92ZXJDb2RlXVtmcm9tU3FdOw0KICAgIGlmIChtb3ZlckNvZGUgPCA4KSBzdGF0ZS5yZWRQb3NpdGlvbiArPSBtb3ZlclBvc2l0aW9uRGVsdGE7DQogICAgZWxzZSBzdGF0ZS5ibGFja1Bvc2l0aW9uICs9IG1vdmVyUG9zaXRpb25EZWx0YTsNCiAgICBpZiAoY2FwdHVyZWRTbG90ID49IDApIHsNCiAgICAgICAgY29uc3QgY2FwdHVyZWRDb2RlID0gc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdOw0KICAgICAgICBjb25zdCBjYXB0dXJlZE1hdGVyaWFsID0gc3RhdGUubWF0ZXJpYWxWYWx1ZXNbY2FwdHVyZWRDb2RlICYgN107DQogICAgICAgIGNvbnN0IGNhcHR1cmVkUG9zaXRpb24gPSBTRUFSQ0hfUE9TSVRJT05fVkFMVUVTW2NhcHR1cmVkQ29kZV1bdG9TcV07DQogICAgICAgIGlmIChjYXB0dXJlZENvZGUgPCA4KSB7DQogICAgICAgICAgICBzdGF0ZS5yZWRNYXRlcmlhbCAtPSBjYXB0dXJlZE1hdGVyaWFsOw0KICAgICAgICAgICAgc3RhdGUucmVkUG9zaXRpb24gLT0gY2FwdHVyZWRQb3NpdGlvbjsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIHN0YXRlLmJsYWNrTWF0ZXJpYWwgLT0gY2FwdHVyZWRNYXRlcmlhbDsNCiAgICAgICAgICAgIHN0YXRlLmJsYWNrUG9zaXRpb24gLT0gY2FwdHVyZWRQb3NpdGlvbjsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBtb3Zlci5zcSA9IHRvU3E7DQogICAgbW92ZXIuciA9ICh0b1NxIC8gOSkgfCAwOw0KICAgIG1vdmVyLmMgPSB0b1NxICUgOTsNCiAgICBzdGF0ZS5zcXVhcmVUb1Nsb3RbZnJvbVNxXSA9IC0xOw0KICAgIHN0YXRlLnNxdWFyZVRvU2xvdFt0b1NxXSA9IG1vdmVyU2xvdDsNCiAgICBzdGF0ZS5zcXVhcmVDb2Rlc1tmcm9tU3FdID0gMDsNCiAgICBzdGF0ZS5zcXVhcmVDb2Rlc1t0b1NxXSA9IHN0YXRlLnBpZWNlQ29kZXNbbW92ZXJTbG90XTsNCiAgICBpZiAoKG1vdmVyQ29kZSAmIDcpID09PSAxKSB7DQogICAgICAgIGlmIChtb3ZlckNvZGUgPCA4KSBzdGF0ZS5yZWRHZW5lcmFsU3EgPSB0b1NxOw0KICAgICAgICBlbHNlIHN0YXRlLmJsYWNrR2VuZXJhbFNxID0gdG9TcTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwICYmIChzdGF0ZS5waWVjZUNvZGVzW2NhcHR1cmVkU2xvdF0gJiA3KSA9PT0gMSkgew0KICAgICAgICBpZiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gLTE7DQogICAgICAgIGVsc2Ugc3RhdGUuYmxhY2tHZW5lcmFsU3EgPSAtMTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwKSBzdGF0ZS5yZWNvcmRzW2NhcHR1cmVkU2xvdF0uYWxpdmUgPSBmYWxzZTsNCn07DQoNCmNvbnN0IHVwZGF0ZVBpZWNlU3RhdGVBZnRlclVubWFrZSA9IChib2FyZCwgZnJvbVNxLCB0b1NxKSA9PiB7DQogICAgY29uc3Qgc3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCiAgICBpZiAoIXN0YXRlKSByZXR1cm47DQogICAgY29uc3Qgc3RhY2tJbmRleCA9IC0tc3RhdGUuc3RhY2tEZXB0aDsNCiAgICBjb25zdCBtb3ZlclNsb3QgPSBzdGF0ZS5tb3ZlclN0YWNrW3N0YWNrSW5kZXhdOw0KICAgIGNvbnN0IGNhcHR1cmVkU2xvdCA9IHN0YXRlLmNhcHR1cmVkU3RhY2tbc3RhY2tJbmRleF07DQogICAgaWYgKG1vdmVyU2xvdCA8IDApIHJldHVybjsNCg0KICAgIGNvbnN0IG1vdmVyID0gc3RhdGUucmVjb3Jkc1ttb3ZlclNsb3RdOw0KICAgIGNvbnN0IG1vdmVyQ29kZSA9IHN0YXRlLnBpZWNlQ29kZXNbbW92ZXJTbG90XTsNCiAgICBjb25zdCBtb3ZlclBvc2l0aW9uRGVsdGEgPSBTRUFSQ0hfUE9TSVRJT05fVkFMVUVTW21vdmVyQ29kZV1bZnJvbVNxXSAtDQogICAgICAgIFNFQVJDSF9QT1NJVElPTl9WQUxVRVNbbW92ZXJDb2RlXVt0b1NxXTsNCiAgICBpZiAobW92ZXJDb2RlIDwgOCkgc3RhdGUucmVkUG9zaXRpb24gKz0gbW92ZXJQb3NpdGlvbkRlbHRhOw0KICAgIGVsc2Ugc3RhdGUuYmxhY2tQb3NpdGlvbiArPSBtb3ZlclBvc2l0aW9uRGVsdGE7DQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwKSB7DQogICAgICAgIGNvbnN0IGNhcHR1cmVkQ29kZSA9IHN0YXRlLnBpZWNlQ29kZXNbY2FwdHVyZWRTbG90XTsNCiAgICAgICAgY29uc3QgY2FwdHVyZWRNYXRlcmlhbCA9IHN0YXRlLm1hdGVyaWFsVmFsdWVzW2NhcHR1cmVkQ29kZSAmIDddOw0KICAgICAgICBjb25zdCBjYXB0dXJlZFBvc2l0aW9uID0gU0VBUkNIX1BPU0lUSU9OX1ZBTFVFU1tjYXB0dXJlZENvZGVdW3RvU3FdOw0KICAgICAgICBpZiAoY2FwdHVyZWRDb2RlIDwgOCkgew0KICAgICAgICAgICAgc3RhdGUucmVkTWF0ZXJpYWwgKz0gY2FwdHVyZWRNYXRlcmlhbDsNCiAgICAgICAgICAgIHN0YXRlLnJlZFBvc2l0aW9uICs9IGNhcHR1cmVkUG9zaXRpb247DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBzdGF0ZS5ibGFja01hdGVyaWFsICs9IGNhcHR1cmVkTWF0ZXJpYWw7DQogICAgICAgICAgICBzdGF0ZS5ibGFja1Bvc2l0aW9uICs9IGNhcHR1cmVkUG9zaXRpb247DQogICAgICAgIH0NCiAgICB9DQogICAgbW92ZXIuc3EgPSBmcm9tU3E7DQogICAgbW92ZXIuciA9IChmcm9tU3EgLyA5KSB8IDA7DQogICAgbW92ZXIuYyA9IGZyb21TcSAlIDk7DQogICAgc3RhdGUuc3F1YXJlVG9TbG90W2Zyb21TcV0gPSBtb3ZlclNsb3Q7DQogICAgc3RhdGUuc3F1YXJlVG9TbG90W3RvU3FdID0gY2FwdHVyZWRTbG90Ow0KICAgIHN0YXRlLnNxdWFyZUNvZGVzW2Zyb21TcV0gPSBzdGF0ZS5waWVjZUNvZGVzW21vdmVyU2xvdF07DQogICAgc3RhdGUuc3F1YXJlQ29kZXNbdG9TcV0gPSBjYXB0dXJlZFNsb3QgPj0gMCA/IHN0YXRlLnBpZWNlQ29kZXNbY2FwdHVyZWRTbG90XSA6IDA7DQogICAgaWYgKChtb3ZlckNvZGUgJiA3KSA9PT0gMSkgew0KICAgICAgICBpZiAobW92ZXJDb2RlIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gZnJvbVNxOw0KICAgICAgICBlbHNlIHN0YXRlLmJsYWNrR2VuZXJhbFNxID0gZnJvbVNxOw0KICAgIH0NCiAgICBpZiAoY2FwdHVyZWRTbG90ID49IDAgJiYgKHN0YXRlLnBpZWNlQ29kZXNbY2FwdHVyZWRTbG90XSAmIDcpID09PSAxKSB7DQogICAgICAgIGlmIChzdGF0ZS5waWVjZUNvZGVzW2NhcHR1cmVkU2xvdF0gPCA4KSBzdGF0ZS5yZWRHZW5lcmFsU3EgPSB0b1NxOw0KICAgICAgICBlbHNlIHN0YXRlLmJsYWNrR2VuZXJhbFNxID0gdG9TcTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwKSBzdGF0ZS5yZWNvcmRzW2NhcHR1cmVkU2xvdF0uYWxpdmUgPSB0cnVlOw0KfTsNCg0KY29uc3QgbG93ZXN0U2V0Qml0SW5kZXggPSAobWFzaykgPT4gMzEgLSBNYXRoLmNsejMyKG1hc2sgJiAtbWFzayk7DQoNCmNvbnN0IGZvckVhY2hTZXRCaXQgPSAobWFzaywgZm4pID0+IHsNCiAgICBsZXQgbSA9IG1hc2sgPj4+IDA7DQogICAgd2hpbGUgKG0gIT09IDApIHsNCiAgICAgICAgY29uc3QgYml0ID0gbSAmIC1tOw0KICAgICAgICBmbigzMSAtIE1hdGguY2x6MzIoYml0KSk7DQogICAgICAgIG0gXj0gYml0Ow0KICAgIH0NCn07DQoNCi8vIOS4u+ivhOS8sOWHveaVsCAtIOivpue7huivhOS8sOaji+ebmOWxgOWKv++8iFVJIC8g54K55qOL5YWz57O7IC8g5pCc57Si5Y+2IC8g5qC56IqC54K577yJDQovLyBvcHRpb25zLmZvclNlYXJjaExlYWY6IOS7hei3s+i/h+e7iOWxgCBnZXRWYWxpZE1vdmVz77yI5peg552A5bey5Zyo54i26IqC54K55aSE55CG77yJ77yb5Y+v55So5pS75Ye75L2N5Zu+5Luj5pu/5o6n5Yi26ICF6KGoDQpjb25zdCBldmFsdWF0ZUJvYXJkID0gKGJvYXJkLCBjdXJyZW50UGxheWVyID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcsIG9wdGlvbnMgPSBudWxsKSA9PiB7DQogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgIC8vIOe7n+iuoQ0KICAgIGlmIChjdXJyZW50UGxheWVyKSB7DQogICAgICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnRbY3VycmVudFBsYXllcl0rKzsNCiAgICB9DQogICAgY29uc3QgZm9yU2VhcmNoTGVhZiA9ICEhKG9wdGlvbnMgJiYgb3B0aW9ucy5mb3JTZWFyY2hMZWFmKTsNCg0KICAgIGNvbnN0IG91dHB1dFBoYXNlID0gZ2FtZVN0YWdlOw0KDQogICAgLy8g6YGN5Y6G5qOL55uY77ya5Y+q5pS26ZuG5a2Q5YqbL1BTVO+8m+edgOazlSvlhbPns7vnu5/kuIDlnKggY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMg5LiA5qyh5Yeg5L2V55Sf5oiQ77yI5a+56b2Q54Ku77yJDQogICAgbGV0IHBpZWNlc0luZm8gPSBbXTsNCiAgICBsZXQgcmVkTWF0ZXJpYWwgPSAwLCByZWRQb3NpdGlvbiA9IDA7DQogICAgbGV0IGJsYWNrTWF0ZXJpYWwgPSAwLCBibGFja1Bvc2l0aW9uID0gMDsNCiAgICANCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBjb25zdCBtYXRlcmlhbFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uVmFsdWUgPSBnZXRQb3NpdGlvblZhbHVlKHBpZWNlLCByLCBjKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKHBpZWNlLmNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgIHJlZE1hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICAgICAgcmVkUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgYmxhY2tNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgIGJsYWNrUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgcGllY2VzSW5mby5wdXNoKHsNCiAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICByLA0KICAgICAgICAgICAgICAgIGMsDQogICAgICAgICAgICAgICAgcGllY2VJbmRleDogcGllY2VzSW5mby5sZW5ndGgsDQogICAgICAgICAgICAgICAgbW92ZXM6IFtdLA0KICAgICAgICAgICAgICAgIGFsbHlHdWFyZHM6IFtdLA0KICAgICAgICAgICAgICAgIG1hdGVyaWFsVmFsdWUsDQogICAgICAgICAgICAgICAgcG9zaXRpb25WYWx1ZSwNCiAgICAgICAgICAgICAgICB0aHJlYXRWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICBzYWZldHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICB0YWN0aWNWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlOiAwLA0KICAgICAgICAgICAgICAgIHRocmVhdDogW10sDQogICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICBndWFyZDogW10sDQogICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICBjb250cm9sOiBbXSwNCiAgICAgICAgICAgICAgICBwcm90ZWN0OiBbXQ0KICAgICAgICAgICAgfSk7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDlhbPns7sgbWFza++8iOKJpDMyIOWtkO+8ieS8mOWFiO+8m+WQpuWImeWbnumAgOaXp+WIl+ihqCAvIOWPtuaUu+WHu+S9jeWbvg0KICAgIGNvbnN0IHVzZVJlbGF0aW9uTWFza3MgPSBwaWVjZXNJbmZvLmxlbmd0aCA8PSAzMjsNCiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gZmFsc2U7DQogICAgbGV0IGJvYXJkSW5mbzsNCiAgICBpZiAodXNlUmVsYXRpb25NYXNrcykgew0KICAgICAgICBjbGVhclJlbGF0aW9uTWFza3MoIWZvclNlYXJjaExlYWYpOw0KICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaFJlZEF0dGFjayk7DQogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOw0KICAgICAgICBib2FyZEluZm8gPSB7DQogICAgICAgICAgICB1c2VSZWxhdGlvbk1hc2tzOiB0cnVlLA0KICAgICAgICAgICAgdXNlQXR0YWNrQml0czogdHJ1ZSwNCiAgICAgICAgICAgIHNraXBDb250cm9sTWFzazogISFmb3JTZWFyY2hMZWFmLA0KICAgICAgICAgICAgYXR0YWNrTWFzazogc2NyYXRjaEF0dGFja01hc2ssDQogICAgICAgICAgICBndWFyZE1hc2s6IHNjcmF0Y2hHdWFyZE1hc2ssDQogICAgICAgICAgICBjb250cm9sTWFzazogc2NyYXRjaENvbnRyb2xNYXNrLA0KICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICB9Ow0KICAgIH0gZWxzZSBpZiAodXNlQXR0YWNrQml0cykgew0KICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaFJlZEF0dGFjayk7DQogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOw0KICAgICAgICBib2FyZEluZm8gPSB7DQogICAgICAgICAgICB1c2VBdHRhY2tCaXRzOiB0cnVlLA0KICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICB9Ow0KICAgIH0gZWxzZSB7DQogICAgICAgIGJvYXJkSW5mbyA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7DQogICAgfQ0KICAgIGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMoYm9hcmQsIHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbywgZm9yU2VhcmNoTGVhZik7DQogICAgDQogICAgLy8g56ys5LiJ5q2l77ya6K6h566X5oC75YiG77yI5Y+q6K6h566X5Ymp5L2Z5YiG5pWw77yM5Z+656GA5YiG5pWw5bey5Zyo5qOL55uY6YGN5Y6G5pe26K6h566X77yJDQogICAgbGV0IHJlZFRocmVhdCA9IDAsIHJlZFRhY3RpYyA9IDAsIHJlZFNhZmV0eSA9IDAsIHJlZE1vYmlsaXR5ID0gMDsNCiAgICBsZXQgYmxhY2tUaHJlYXQgPSAwLCBibGFja1RhY3RpYyA9IDAsIGJsYWNrU2FmZXR5ID0gMCwgYmxhY2tNb2JpbGl0eSA9IDA7DQogICAgDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgY29uc3QgeyBwaWVjZSwgdGhyZWF0VmFsdWUsIHRhY3RpY1ZhbHVlLCBzYWZldHlWYWx1ZSwgbW9iaWxpdHlWYWx1ZSB9ID0gaW5mbzsNCiAgICAgICAgDQogICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgIHJlZFRocmVhdCArPSB0aHJlYXRWYWx1ZTsNCiAgICAgICAgICAgIHJlZFRhY3RpYyArPSB0YWN0aWNWYWx1ZTsNCiAgICAgICAgICAgIHJlZFNhZmV0eSArPSBzYWZldHlWYWx1ZTsNCiAgICAgICAgICAgIHJlZE1vYmlsaXR5ICs9IG1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBibGFja1RocmVhdCArPSB0aHJlYXRWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrVGFjdGljICs9IHRhY3RpY1ZhbHVlOw0KICAgICAgICAgICAgYmxhY2tTYWZldHkgKz0gc2FmZXR5VmFsdWU7DQogICAgICAgICAgICBibGFja01vYmlsaXR5ICs9IG1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g6K6h566X5bGA5Yq/5oC75YiGDQogICAgY29uc3QgcmVkVG90YWwgPSANCiAgICAgICAgcmVkTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgcmVkUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsNCiAgICAgICAgcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKw0KICAgICAgICByZWRUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArDQogICAgICAgIHJlZFNhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsNCiAgICAgICAgcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5OyANCiAgICANCiAgICBjb25zdCBibGFja1RvdGFsID0gDQogICAgICAgIGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgYmxhY2tQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24gKw0KICAgICAgICBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsNCiAgICAgICAgYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArDQogICAgICAgIGJsYWNrU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHkgKw0KICAgICAgICBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsNCiAgICANCiAgICAvLyDov5Tlm57or6bnu4bor4TkvLDnu5PmnpwNCiAgICBjb25zdCBfX2V2YWxSZXN1bHQgPSB7DQogICAgICAgIHJlZDogew0KICAgICAgICAgICAgdG90YWw6IHJlZFRvdGFsLA0KICAgICAgICAgICAgbWF0ZXJpYWw6IHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwNCiAgICAgICAgICAgIHBvc2l0aW9uOiByZWRQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sDQogICAgICAgICAgICB0aHJlYXQ6IHJlZFRocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0LA0KICAgICAgICAgICAgdGFjdGljOiByZWRUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYywNCiAgICAgICAgICAgIHNhZmV0eTogcmVkU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHksDQogICAgICAgICAgICBtb2JpbGl0eTogcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgcGhhc2U6IG91dHB1dFBoYXNlLA0KICAgICAgICAgICAgd2VpZ2h0czogew0KICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLjQsDQogICAgICAgICAgICAgICAgcG9zaXRpb246IDAuMiwNCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwNCiAgICAgICAgICAgICAgICBzYWZldHk6IDAuMSwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eTogMC4wNSwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSwNCiAgICAgICAgYmxhY2s6IHsNCiAgICAgICAgICAgIHRvdGFsOiBibGFja1RvdGFsLA0KICAgICAgICAgICAgbWF0ZXJpYWw6IGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsLA0KICAgICAgICAgICAgcG9zaXRpb246IGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLA0KICAgICAgICAgICAgdGhyZWF0OiBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0LA0KICAgICAgICAgICAgdGFjdGljOiBibGFja1RhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljLA0KICAgICAgICAgICAgc2FmZXR5OiBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LA0KICAgICAgICAgICAgbW9iaWxpdHk6IGJsYWNrTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgcGhhc2U6IG91dHB1dFBoYXNlLA0KICAgICAgICAgICAgd2VpZ2h0czogew0KICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLjQsDQogICAgICAgICAgICAgICAgcG9zaXRpb246IDAuMiwNCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwNCiAgICAgICAgICAgICAgICBzYWZldHk6IDAuMSwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eTogMC4wNSwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSwNCiAgICAgICAgcGllY2VzSW5mbzogcGllY2VzSW5mbywNCiAgICAgICAgZ2FtZVN0YWdlOiBnYW1lU3RhZ2UsDQogICAgICAgIGJvYXJkSW5mbzogYm9hcmRJbmZvDQogICAgfTsNCiAgICBpZiAodHlwZW9mIHBlcmZTdGF0cyAhPT0gJ3VuZGVmaW5lZCcgJiYgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcyAhPSBudWxsKSB7DQogICAgICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIH0NCiAgICByZXR1cm4gX19ldmFsUmVzdWx0Ow0KfTsNCg0KY29uc3QgZXZhbHVhdGVTZWFyY2hMZWFmRmFzdCA9IChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpID0+IHsNCiAgICBjb25zdCBfX3QwID0gcGVyZm9ybWFuY2Uubm93KCk7DQogICAgY29uc3QgcGllY2VzSW5mbyA9IHNjcmF0Y2hMZWFmUGllY2VzSW5mbzsNCiAgICBsZXQgY291bnQgPSAwOw0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCiAgICBjb25zdCBudW1lcmljTGVhZiA9ICEhcGllY2VTdGF0ZTsNCiAgICBjb25zdCBtYXRlcmlhbFZhbHVlcyA9IG51bWVyaWNMZWFmID8gcGllY2VTdGF0ZS5tYXRlcmlhbFZhbHVlcyA6IG51bGw7DQogICAgbGV0IHJlZE1hdGVyaWFsID0gbnVtZXJpY0xlYWYgPyBwaWVjZVN0YXRlLnJlZE1hdGVyaWFsIDogMDsNCiAgICBsZXQgcmVkUG9zaXRpb24gPSBudW1lcmljTGVhZiA/IHBpZWNlU3RhdGUucmVkUG9zaXRpb24gOiAwOw0KICAgIGxldCBibGFja01hdGVyaWFsID0gbnVtZXJpY0xlYWYgPyBwaWVjZVN0YXRlLmJsYWNrTWF0ZXJpYWwgOiAwOw0KICAgIGxldCBibGFja1Bvc2l0aW9uID0gbnVtZXJpY0xlYWYgPyBwaWVjZVN0YXRlLmJsYWNrUG9zaXRpb24gOiAwOw0KICAgIGxldCBvdmVyZmxvdyA9IGZhbHNlOw0KICAgIGlmIChwaWVjZVN0YXRlKSB7DQogICAgICAgIGNvbnN0IHJlY29yZHMgPSBwaWVjZVN0YXRlLnJlY29yZHM7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVjb3Jkcy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgcmVjb3JkID0gcmVjb3Jkc1tpXTsNCiAgICAgICAgICAgIGlmICghcmVjb3JkLmFsaXZlKSBjb250aW51ZTsNCiAgICAgICAgICAgIGNvbnN0IGluZm8gPSBzY3JhdGNoTGVhZlBpZWNlU2xvdHNbY291bnQrK107DQogICAgICAgICAgICBjb25zdCBwaWVjZUNvZGUgPSBwaWVjZVN0YXRlLnBpZWNlQ29kZXNbaV07DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IG51bWVyaWNMZWFmID8gbnVsbCA6IHJlY29yZC5waWVjZTsNCiAgICAgICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWUgPSBudW1lcmljTGVhZg0KICAgICAgICAgICAgICAgID8gbWF0ZXJpYWxWYWx1ZXNbcGllY2VDb2RlICYgN10NCiAgICAgICAgICAgICAgICA6IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgICAgICAvLyBOdW1lcmljIGxlYXZlcyByZWFkIHRoZSBhZ2dyZWdhdGUgUFNUIHNjb3JlIGZyb20gcGllY2VTdGF0ZTsNCiAgICAgICAgICAgIC8vIG5vIGRvd25zdHJlYW0gc2VhcmNoIGNhbGN1bGF0aW9uIGNvbnN1bWVzIGEgcGVyLXBpZWNlIFBTVCB2YWx1ZS4NCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uVmFsdWUgPSBudW1lcmljTGVhZiA/IDAgOiBnZXRQb3NpdGlvblZhbHVlKHBpZWNlLCByZWNvcmQuciwgcmVjb3JkLmMpOw0KICAgICAgICAgICAgaW5mby5waWVjZSA9IHBpZWNlOw0KICAgICAgICAgICAgaW5mby5waWVjZUNvZGUgPSBwaWVjZUNvZGU7DQogICAgICAgICAgICBpbmZvLnIgPSByZWNvcmQucjsNCiAgICAgICAgICAgIGluZm8uYyA9IHJlY29yZC5jOw0KICAgICAgICAgICAgaW5mby5zcSA9IHJlY29yZC5zcTsNCiAgICAgICAgICAgIGluZm8ucGllY2VJbmRleCA9IGNvdW50IC0gMTsKICAgICAgICAgICAgaW5mby5tYXRlcmlhbFZhbHVlID0gbWF0ZXJpYWxWYWx1ZTsKICAgICAgICAgICAgaW5mby5wb3NpdGlvblZhbHVlID0gcG9zaXRpb25WYWx1ZTsKICAgICAgICAgICAgcGllY2VzSW5mb1tjb3VudCAtIDFdID0gaW5mbzsKICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgc2NhbkJvYXJkOiBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChjb3VudCA+PSBzY3JhdGNoTGVhZlBpZWNlU2xvdHMubGVuZ3RoKSB7DQogICAgICAgICAgICAgICAgICAgIG92ZXJmbG93ID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWsgc2NhbkJvYXJkOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gc2NyYXRjaExlYWZQaWVjZVNsb3RzW2NvdW50KytdOw0KICAgICAgICAgICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uVmFsdWUgPSBnZXRQb3NpdGlvblZhbHVlKHBpZWNlLCByLCBjKTsNCiAgICAgICAgICAgICAgICBpbmZvLnBpZWNlID0gcGllY2U7DQogICAgICAgICAgICAgICAgaW5mby5waWVjZUNvZGUgPSBzZWFyY2hQaWVjZUNvZGUocGllY2UpOw0KICAgICAgICAgICAgICAgIGluZm8uciA9IHI7DQogICAgICAgICAgICAgICAgaW5mby5jID0gYzsNCiAgICAgICAgICAgICAgICBpbmZvLnNxID0gciAqIDkgKyBjOw0KICAgICAgICAgICAgICAgIGluZm8ucGllY2VJbmRleCA9IGNvdW50IC0gMTsNCiAgICAgICAgICAgICAgICBpbmZvLm1hdGVyaWFsVmFsdWUgPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgIGluZm8ucG9zaXRpb25WYWx1ZSA9IHBvc2l0aW9uVmFsdWU7DQogICAgICAgICAgICAgICAgaW5mby50aHJlYXRWYWx1ZSA9IDA7DQogICAgICAgICAgICAgICAgaW5mby5zYWZldHlWYWx1ZSA9IDA7DQogICAgICAgICAgICAgICAgaW5mby50YWN0aWNWYWx1ZSA9IDA7DQogICAgICAgICAgICAgICAgaW5mby5tb2JpbGl0eVZhbHVlID0gMDsNCiAgICAgICAgICAgICAgICBwaWVjZXNJbmZvW2NvdW50IC0gMV0gPSBpbmZvOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICAgICAgcmVkTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgcmVkUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBibGFja01hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICAgICAgICAgIGJsYWNrUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgaWYgKG92ZXJmbG93KSB7DQogICAgICAgIGNvbnN0IHJlc3VsdCA9IGV2YWx1YXRlQm9hcmQoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB7IGZvclNlYXJjaExlYWY6IHRydWUgfSk7DQogICAgICAgIGNvbnN0IG9wcG9uZW50ID0gc2VhcmNoSW5pdGlhdG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgcmV0dXJuIHJlc3VsdFtzZWFyY2hJbml0aWF0b3JdLnRvdGFsIC0gcmVzdWx0W29wcG9uZW50XS50b3RhbDsNCiAgICB9DQogICAgcGllY2VzSW5mby5sZW5ndGggPSBjb3VudDsNCg0KICAgIGlmIChwaWVjZVN0YXRlKSB7DQogICAgICAgIGNhbGN1bGF0ZVBhY2tlZFNlYXJjaExlYWZSZWxhdGlvbnMocGllY2VzSW5mbywgcGllY2VTdGF0ZS5zcXVhcmVDb2Rlcyk7DQogICAgICAgIGNhbGN1bGF0ZU51bWVyaWNTZWFyY2hMZWFmVGhyZWF0VmFsdWVzKHBpZWNlc0luZm8sIHNlYXJjaEluaXRpYXRvcik7DQogICAgICAgIGNhbGN1bGF0ZU51bWVyaWNTZWFyY2hMZWFmU2FmZXR5VmFsdWVzKHBpZWNlc0luZm8sIHBpZWNlU3RhdGUuc3F1YXJlQ29kZXMpOw0KICAgIH0gZWxzZSB7DQogICAgICAgIGNsZWFyUmVsYXRpb25NYXNrcyh0cnVlKTsNCiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOw0KICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaEJsYWNrQXR0YWNrKTsNCiAgICAgICAgY2FsY3VsYXRlRGVyaXZlZFZhbHVlcyhib2FyZCwgcGllY2VzSW5mbywgc2VhcmNoSW5pdGlhdG9yLCBzY3JhdGNoTGVhZkJvYXJkSW5mbywgdHJ1ZSk7DQogICAgfQ0KDQogICAgbGV0IHJlZFRocmVhdCA9IDA7DQogICAgbGV0IHJlZFRhY3RpYyA9IDA7DQogICAgbGV0IHJlZFNhZmV0eSA9IDA7DQogICAgbGV0IHJlZE1vYmlsaXR5ID0gMDsNCiAgICBsZXQgYmxhY2tUaHJlYXQgPSAwOw0KICAgIGxldCBibGFja1RhY3RpYyA9IDA7DQogICAgbGV0IGJsYWNrU2FmZXR5ID0gMDsNCiAgICBsZXQgYmxhY2tNb2JpbGl0eSA9IDA7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICBpZiAobnVtZXJpY0xlYWYgPyBpbmZvLnBpZWNlQ29kZSA8IDggOiBpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgcmVkVGhyZWF0ICs9IGluZm8udGhyZWF0VmFsdWU7DQogICAgICAgICAgICByZWRUYWN0aWMgKz0gaW5mby50YWN0aWNWYWx1ZTsNCiAgICAgICAgICAgIHJlZFNhZmV0eSArPSBpbmZvLnNhZmV0eVZhbHVlOw0KICAgICAgICAgICAgcmVkTW9iaWxpdHkgKz0gaW5mby5tb2JpbGl0eVZhbHVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgYmxhY2tUaHJlYXQgKz0gaW5mby50aHJlYXRWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrVGFjdGljICs9IGluZm8udGFjdGljVmFsdWU7DQogICAgICAgICAgICBibGFja1NhZmV0eSArPSBpbmZvLnNhZmV0eVZhbHVlOw0KICAgICAgICAgICAgYmxhY2tNb2JpbGl0eSArPSBpbmZvLm1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBjb25zdCByZWRUb3RhbCA9DQogICAgICAgIHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArDQogICAgICAgIHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArDQogICAgICAgIHJlZFRocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsNCiAgICAgICAgcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKw0KICAgICAgICByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArDQogICAgICAgIHJlZE1vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsNCiAgICBjb25zdCBibGFja1RvdGFsID0NCiAgICAgICAgYmxhY2tNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwgKw0KICAgICAgICBibGFja1Bvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArDQogICAgICAgIGJsYWNrVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKw0KICAgICAgICBibGFja1RhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljICsNCiAgICAgICAgYmxhY2tTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArDQogICAgICAgIGJsYWNrTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5Ow0KDQogICAgcGVyZlN0YXRzLmZhc3RMZWFmRXZhbENvdW50Kys7DQogICAgcGVyZlN0YXRzLmZhc3RMZWFmRXZhbE1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsNCiAgICByZXR1cm4gc2VhcmNoSW5pdGlhdG9yID09PSAncmVkJyA/IHJlZFRvdGFsIC0gYmxhY2tUb3RhbCA6IGJsYWNrVG90YWwgLSByZWRUb3RhbDsNCn07DQoNCi8vIOWwhi/luIXkvY3nva7nvJPlrZjvvJrkvpsgcG9zdC1tb3ZlIGlzQ2hlY2sgLyDpo57lsIblv6vpgJ/mn6Xor6LvvIznlLEgbWFrZS91bm1ha2Ug57u05oqkDQpsZXQgZ2VuZXJhbFBvc0NhY2hlID0geyByZWQ6IG51bGwsIGJsYWNrOiBudWxsIH07DQoNCi8vIOWwhuW4heS7heWcqOS5neWuq+WGhe+8jOaMieS5neWuq+aJq+aPj+WNs+WPrw0KY29uc3QgZmluZEdlbmVyYWxQb3MgPSAoYm9hcmQsIGNvbG9yKSA9PiB7DQogICAgY29uc3Qgcm93U3RhcnQgPSBjb2xvciA9PT0gJ3JlZCcgPyAwIDogNzsNCiAgICBjb25zdCByb3dFbmQgPSBjb2xvciA9PT0gJ3JlZCcgPyAyIDogOTsNCiAgICBmb3IgKGxldCByID0gcm93U3RhcnQ7IHIgPD0gcm93RW5kOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDM7IGMgPD0gNTsgYysrKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAocCAmJiBwLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBwLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgICAgIHJldHVybiB7IHIsIGMgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICByZXR1cm4gbnVsbDsNCn07DQoNCmNvbnN0IHN5bmNHZW5lcmFsUG9zQ2FjaGUgPSAoYm9hcmQpID0+IHsNCiAgICBnZW5lcmFsUG9zQ2FjaGUucmVkID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsICdyZWQnKTsNCiAgICBnZW5lcmFsUG9zQ2FjaGUuYmxhY2sgPSBmaW5kR2VuZXJhbFBvcyhib2FyZCwgJ2JsYWNrJyk7DQp9Ow0KDQpjb25zdCBnZXRHZW5lcmFsUG9zID0gKGJvYXJkLCBjb2xvcikgPT4gew0KICAgIGNvbnN0IGNhY2hlZCA9IGdlbmVyYWxQb3NDYWNoZVtjb2xvcl07DQogICAgaWYgKGNhY2hlZCkgew0KICAgICAgICBjb25zdCBwID0gYm9hcmRbY2FjaGVkLnJdPy5bY2FjaGVkLmNdOw0KICAgICAgICBpZiAocCAmJiBwLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBwLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgcmV0dXJuIGNhY2hlZDsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBjb25zdCBwb3MgPSBmaW5kR2VuZXJhbFBvcyhib2FyZCwgY29sb3IpOw0KICAgIGdlbmVyYWxQb3NDYWNoZVtjb2xvcl0gPSBwb3M7DQogICAgcmV0dXJuIHBvczsNCn07DQoNCi8vIOaQnOe0oueUqOWOn+WcsOi1sOWtkCAvIOaBouWkje+8iOmBv+WFjeavj+asoemAkuW9kiBib2FyZC5tYXDvvInvvJvlkIzmraXnu7TmiqTlsIbkvY3nvJPlrZgNCmNvbnN0IG1ha2VNb3ZlID0gKGJvYXJkLCBmcm9tLCB0bykgPT4gew0KICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbZnJvbS5yXVtmcm9tLmNdOw0KICAgIGNvbnN0IGNhcHR1cmVkID0gYm9hcmRbdG8ucl1bdG8uY107DQogICAgYm9hcmRbdG8ucl1bdG8uY10gPSBwaWVjZTsNCiAgICBib2FyZFtmcm9tLnJdW2Zyb20uY10gPSBudWxsOw0KICAgIHVwZGF0ZVBpZWNlU3RhdGVBZnRlck1ha2UoYm9hcmQsIGZyb20uciAqIDkgKyBmcm9tLmMsIHRvLnIgKiA5ICsgdG8uYyk7DQogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbcGllY2UuY29sb3JdID0geyByOiB0by5yLCBjOiB0by5jIH07DQogICAgfQ0KICAgIGlmIChjYXB0dXJlZCAmJiBjYXB0dXJlZC50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IG51bGw7DQogICAgfQ0KICAgIHJldHVybiBjYXB0dXJlZDsNCn07DQoNCmNvbnN0IHVubWFrZU1vdmUgPSAoYm9hcmQsIGZyb20sIHRvLCBjYXB0dXJlZCkgPT4gew0KICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbdG8ucl1bdG8uY107DQogICAgYm9hcmRbZnJvbS5yXVtmcm9tLmNdID0gcGllY2U7DQogICAgYm9hcmRbdG8ucl1bdG8uY10gPSBjYXB0dXJlZDsNCiAgICB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJVbm1ha2UoYm9hcmQsIGZyb20uciAqIDkgKyBmcm9tLmMsIHRvLnIgKiA5ICsgdG8uYyk7DQogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbcGllY2UuY29sb3JdID0geyByOiBmcm9tLnIsIGM6IGZyb20uYyB9Ow0KICAgIH0NCiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSB7IHI6IHRvLnIsIGM6IHRvLmMgfTsNCiAgICB9DQp9Ow0KDQovLyDotbDlrZDlkI7mmK/lkKbkvb/lt7HmlrnlsIbkuI3lronlhajvvIjpo57lsIbmiJbooqvlsIbvvInjgILosIPnlKjliY3pobvlt7IgbWFrZU1vdmXjgIINCmNvbnN0IGxlYXZlc093bktpbmdVbnNhZmUgPSAoYm9hcmQsIGNvbG9yKSA9PiB7DQogICAgY29uc3QgX190MCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOw0KICAgIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcysrOw0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCiAgICBjb25zdCB1bnNhZmUgPSBwaWVjZVN0YXRlID8gaXNDaGVja1Jhd0Zyb21QaWVjZVN0YXRlKHBpZWNlU3RhdGUsIGNvbG9yKSA6IChpc0ZseWluZ0dlbmVyYWwoYm9hcmQpIHx8IGlzQ2hlY2tSYXcoYm9hcmQsIGNvbG9yKSk7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMubGVnYWxpdHlDaGVja01zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsNCiAgICByZXR1cm4gdW5zYWZlOw0KfTsNCg0KLy8g5LuO5Lyq5ZCI5rOV552A5rOV5Lit6L+H5ruk5Ye65LiN6YCB5bCGL+S4jemjnuWwhueahOWQiOazleedgOazle+8iFVJL+agueiKgueCuS/lvIDlsYDlupPmoKHpqozvvIkNCi8vIOaQnOe0oueDrei3r+W+hOS9v+eUqOW7tui/n+WQiOazleaAp++8iOivlei1sOaXtuajgOa1i++8ie+8jOmBv+WFjeWvueWJquaeneacquinpuWPiueahOedgOazleWBmuWFqOmHj+i/h+a7pA0KY29uc3QgZmlsdGVyTGVnYWxNb3ZlcyA9IChib2FyZCwgZnJvbSwgcGllY2UsIHBzZXVkb01vdmVzKSA9PiB7DQogICAgY29uc3QgdmFsaWRNb3ZlcyA9IFtdOw0KICAgIGZvciAoY29uc3QgdG8gb2YgcHNldWRvTW92ZXMpIHsNCiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlTW92ZShib2FyZCwgZnJvbSwgdG8pOw0KICAgICAgICBjb25zdCBpbGxlZ2FsID0gbGVhdmVzT3duS2luZ1Vuc2FmZShib2FyZCwgcGllY2UuY29sb3IpOw0KICAgICAgICB1bm1ha2VNb3ZlKGJvYXJkLCBmcm9tLCB0bywgY2FwdHVyZWQpOw0KICAgICAgICBpZiAoIWlsbGVnYWwpIHZhbGlkTW92ZXMucHVzaCh0byk7DQogICAgfQ0KICAgIHJldHVybiB2YWxpZE1vdmVzOw0KfTsNCg0KLy8gU2VhcmNoIGhvdCBwYXRoIG1vdmUgZW5jb2Rpbmc6IG1vdmUgPSAoZnJvbVNxIDw8IDcpIHwgdG9TcS4NCmNvbnN0IE1PVkVfVE9fTUFTSyA9IDB4N2Y7DQpjb25zdCBlbmNvZGVNb3ZlID0gKGZyb20sIHRvKSA9PiAoKGZyb20uciAqIDkgKyBmcm9tLmMpIDw8IDcpIHwgKHRvLnIgKiA5ICsgdG8uYyk7DQpjb25zdCBlbmNvZGVNb3ZlRnJvbUNvb3JkcyA9IChmciwgZmMsIHRyLCB0YykgPT4gKChmciAqIDkgKyBmYykgPDwgNykgfCAodHIgKiA5ICsgdGMpOw0KY29uc3QgaXNFbmNvZGVkTW92ZSA9IChtb3ZlKSA9PiB0eXBlb2YgbW92ZSA9PT0gJ251bWJlcic7DQpjb25zdCBtb3ZlRnJvbVNxID0gKG1vdmUpID0+IGlzRW5jb2RlZE1vdmUobW92ZSkgPyAobW92ZSA+Pj4gNykgOiBtb3ZlLmZyb20uciAqIDkgKyBtb3ZlLmZyb20uYzsNCmNvbnN0IG1vdmVUb1NxID0gKG1vdmUpID0+IGlzRW5jb2RlZE1vdmUobW92ZSkgPyAobW92ZSAmIE1PVkVfVE9fTUFTSykgOiBtb3ZlLnRvLnIgKiA5ICsgbW92ZS50by5jOw0KY29uc3QgbW92ZUZyb21SID0gKG1vdmUpID0+IHsNCiAgICBjb25zdCBzcSA9IG1vdmVGcm9tU3EobW92ZSk7DQogICAgcmV0dXJuIChzcSAvIDkpIHwgMDsNCn07DQpjb25zdCBtb3ZlRnJvbUMgPSAobW92ZSkgPT4gbW92ZUZyb21TcShtb3ZlKSAlIDk7DQpjb25zdCBtb3ZlVG9SID0gKG1vdmUpID0+IHsNCiAgICBjb25zdCBzcSA9IG1vdmVUb1NxKG1vdmUpOw0KICAgIHJldHVybiAoc3EgLyA5KSB8IDA7DQp9Ow0KY29uc3QgbW92ZVRvQyA9IChtb3ZlKSA9PiBtb3ZlVG9TcShtb3ZlKSAlIDk7DQpjb25zdCBtb3ZlVG9PYmplY3QgPSAobW92ZSkgPT4gew0KICAgIGlmICghaXNFbmNvZGVkTW92ZShtb3ZlKSkgcmV0dXJuIG1vdmU7DQogICAgY29uc3QgZnJvbSA9IG1vdmVGcm9tU3EobW92ZSk7DQogICAgY29uc3QgdG8gPSBtb3ZlVG9TcShtb3ZlKTsNCiAgICByZXR1cm4gew0KICAgICAgICBmcm9tOiB7IHI6IChmcm9tIC8gOSkgfCAwLCBjOiBmcm9tICUgOSB9LA0KICAgICAgICB0bzogeyByOiAodG8gLyA5KSB8IDAsIGM6IHRvICUgOSB9DQogICAgfTsNCn07DQoNCmNvbnN0IG1ha2VTZWFyY2hNb3ZlID0gKGJvYXJkLCBtb3ZlKSA9PiB7DQogICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSByZXR1cm4gbWFrZU1vdmUoYm9hcmQsIG1vdmUuZnJvbSwgbW92ZS50byk7DQogICAgY29uc3QgZnJvbSA9IG1vdmUgPj4+IDc7DQogICAgY29uc3QgdG8gPSBtb3ZlICYgTU9WRV9UT19NQVNLOw0KICAgIGNvbnN0IGZyID0gKGZyb20gLyA5KSB8IDAsIGZjID0gZnJvbSAlIDk7DQogICAgY29uc3QgdHIgPSAodG8gLyA5KSB8IDAsIHRjID0gdG8gJSA5Ow0KICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbZnJdW2ZjXTsNCiAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW3RyXVt0Y107DQogICAgYm9hcmRbdHJdW3RjXSA9IHBpZWNlOw0KICAgIGJvYXJkW2ZyXVtmY10gPSBudWxsOw0KICAgIHVwZGF0ZVBpZWNlU3RhdGVBZnRlck1ha2UoYm9hcmQsIGZyb20sIHRvKTsNCiAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtwaWVjZS5jb2xvcl0gPSB7IHI6IHRyLCBjOiB0YyB9Ow0KICAgIH0NCiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSBudWxsOw0KICAgIH0NCiAgICByZXR1cm4gY2FwdHVyZWQ7DQp9Ow0KDQpjb25zdCB1bm1ha2VTZWFyY2hNb3ZlID0gKGJvYXJkLCBtb3ZlLCBjYXB0dXJlZCkgPT4gew0KICAgIGlmICghaXNFbmNvZGVkTW92ZShtb3ZlKSkgew0KICAgICAgICB1bm1ha2VNb3ZlKGJvYXJkLCBtb3ZlLmZyb20sIG1vdmUudG8sIGNhcHR1cmVkKTsNCiAgICAgICAgcmV0dXJuOw0KICAgIH0NCiAgICBjb25zdCBmcm9tID0gbW92ZSA+Pj4gNzsNCiAgICBjb25zdCB0byA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7DQogICAgY29uc3QgZnIgPSAoZnJvbSAvIDkpIHwgMCwgZmMgPSBmcm9tICUgOTsNCiAgICBjb25zdCB0ciA9ICh0byAvIDkpIHwgMCwgdGMgPSB0byAlIDk7DQogICAgY29uc3QgcGllY2UgPSBib2FyZFt0cl1bdGNdOw0KICAgIGJvYXJkW2ZyXVtmY10gPSBwaWVjZTsNCiAgICBib2FyZFt0cl1bdGNdID0gY2FwdHVyZWQ7DQogICAgdXBkYXRlUGllY2VTdGF0ZUFmdGVyVW5tYWtlKGJvYXJkLCBmcm9tLCB0byk7DQogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbcGllY2UuY29sb3JdID0geyByOiBmciwgYzogZmMgfTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0geyByOiB0ciwgYzogdGMgfTsNCiAgICB9DQp9Ow0KDQpjb25zdCBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaCA9IFtdOw0KY29uc3Qgc29ydE1vdmVTY29yZVNjcmF0Y2ggPSBbXTsNCmNvbnN0IGNhcHR1cmVTb3J0U2NvcmVTY3JhdGNoID0gW107DQpjb25zdCBzcXVhcmVNYXJrU2NyYXRjaCA9IG5ldyBVaW50OEFycmF5KFJFTF9TUVVBUkVTKTsNCmNvbnN0IHNxdWFyZU1hcmtUb3VjaGVkID0gW107DQoNCmNvbnN0IG1hcmtTb3J0U3F1YXJlID0gKHNxKSA9PiB7DQogICAgaWYgKCFzcXVhcmVNYXJrU2NyYXRjaFtzcV0pIHsNCiAgICAgICAgc3F1YXJlTWFya1NjcmF0Y2hbc3FdID0gMTsNCiAgICAgICAgc3F1YXJlTWFya1RvdWNoZWQucHVzaChzcSk7DQogICAgfQ0KfTsNCg0KY29uc3QgY2xlYXJTb3J0U3F1YXJlTWFya3MgPSAoKSA9PiB7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzcXVhcmVNYXJrVG91Y2hlZC5sZW5ndGg7IGkrKykgew0KICAgICAgICBzcXVhcmVNYXJrU2NyYXRjaFtzcXVhcmVNYXJrVG91Y2hlZFtpXV0gPSAwOw0KICAgIH0NCiAgICBzcXVhcmVNYXJrVG91Y2hlZC5sZW5ndGggPSAwOw0KfTsNCg0KY29uc3Qgc29ydE1vdmVzRmFzdCA9IChtb3ZlcywgYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIHBpZWNlc0luZm8sIGdhbWVTdGFnZSA9ICdtaWQnLCBib2FyZEluZm8gPSBudWxsLCBzZWFyY2hIZXVyaXN0aWNzID0gbnVsbCkgPT4gew0KICAgIGNvbnN0IF9fdDAgPSBTRUFSQ0hfUFJPRklMRSA/IHBlcmZvcm1hbmNlLm5vdygpIDogMDsNCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5zb3J0TW92ZXNDb3VudCsrOw0KICAgIGNvbnN0IGN1cnJlbnRJc0luQ2hlY2sgPSBib2FyZEluZm8NCiAgICAgICAgPyAoKGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnICYmIGJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8DQogICAgICAgICAgIChjdXJyZW50UGxheWVyID09PSAnYmxhY2snICYmIGJvYXJkSW5mby5ibGFja0lzSW5DaGVjaykpDQogICAgICAgIDogaXNDaGVjayhib2FyZCwgY3VycmVudFBsYXllcik7DQoNCiAgICBpZiAoY3VycmVudElzSW5DaGVjayAmJiBwaWVjZXNJbmZvICYmIHBpZWNlc0luZm8ubGVuZ3RoID4gMCkgew0KICAgICAgICBsZXQgZ2VuZXJhbEluZm8gPSBudWxsOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICAgICAgaWYgKGluZm8ucGllY2UgJiYgaW5mby5waWVjZS50eXBlID09PSAnZ2VuZXJhbCcgJiYgaW5mby5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgIGdlbmVyYWxJbmZvID0gaW5mbzsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoZ2VuZXJhbEluZm8pIHsNCiAgICAgICAgICAgIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpIHsNCiAgICAgICAgICAgICAgICBsZXQgbSA9IGJvYXJkSW5mby5hdHRhY2tNYXNrW2dlbmVyYWxJbmZvLnIgKiA5ICsgZ2VuZXJhbEluZm8uY10gPj4+IDA7DQogICAgICAgICAgICAgICAgd2hpbGUgKG0gIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgYml0ID0gbSAmIC1tOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0ID0gcGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV07DQogICAgICAgICAgICAgICAgICAgIGlmICh0ICYmIHQucGllY2UgJiYgdC5waWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgbWFya1NvcnRTcXVhcmUodC5yICogOSArIHQuYyk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgbSBePSBiaXQ7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIGlmIChnZW5lcmFsSW5mby50aHJlYXRlbmVkQnkpIHsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeS5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0ID0gZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5W2ldOw0KICAgICAgICAgICAgICAgICAgICBpZiAodC5waWVjZSAmJiB0LnBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBtYXJrU29ydFNxdWFyZSh0LnIgKiA5ICsgdC5jKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGNvbnN0IGhhc1RocmVhdGVuZWQgPSAhY3VycmVudElzSW5DaGVjayAmJiAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMgJiYgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMubGVuZ3RoID4gMCk7DQogICAgaWYgKGhhc1RocmVhdGVuZWQpIHsNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzW2ldOw0KICAgICAgICAgICAgbWFya1NvcnRTcXVhcmUocC5yICogOSArIHAuYyk7DQogICAgICAgIH0NCiAgICB9DQogICAgY29uc3QgdGhyZWF0ZW5lZE1hcmtFbmQgPSBzcXVhcmVNYXJrVG91Y2hlZC5sZW5ndGg7DQoNCiAgICBjb25zdCBoYXNDYW5DYXB0dXJlID0gIWN1cnJlbnRJc0luQ2hlY2sgJiYgISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby5jYW5DYXB0dXJlICYmIGJvYXJkSW5mby5jYW5DYXB0dXJlLmxlbmd0aCA+IDApOw0KICAgIGlmIChoYXNDYW5DYXB0dXJlKSB7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYm9hcmRJbmZvLmNhbkNhcHR1cmUubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZEluZm8uY2FuQ2FwdHVyZVtpXTsNCiAgICAgICAgICAgIG1hcmtTb3J0U3F1YXJlKHAuciAqIDkgKyBwLmMpOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3QgdHRNb3ZlID0gc2VhcmNoSGV1cmlzdGljcz8udHRNb3ZlIHx8IG51bGw7DQogICAgY29uc3Qga2lsbGVycyA9IHNlYXJjaEhldXJpc3RpY3M/LmtpbGxlcnMgfHwgbnVsbDsNCiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgY29uc3QgdXNlU2ltcGxlU2VhcmNoU29ydCA9IHBpZWNlU3RhdGUgJiYgIWN1cnJlbnRJc0luQ2hlY2sgJiYgIWhhc1RocmVhdGVuZWQgJiYgIWhhc0NhbkNhcHR1cmU7DQogICAgY29uc3QgaXNNYXJrZWRUaHJlYXRlbmVkID0gKHNxKSA9PiB7DQogICAgICAgIGlmICghaGFzVGhyZWF0ZW5lZCkgcmV0dXJuIGZhbHNlOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRocmVhdGVuZWRNYXJrRW5kOyBpKyspIHsNCiAgICAgICAgICAgIGlmIChzcXVhcmVNYXJrVG91Y2hlZFtpXSA9PT0gc3EpIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBmYWxzZTsNCiAgICB9Ow0KDQogICAgaWYgKHVzZVNpbXBsZVNlYXJjaFNvcnQpIHsNCiAgICAgICAgY29uc3Qgc3F1YXJlVG9TbG90ID0gcGllY2VTdGF0ZS5zcXVhcmVUb1Nsb3Q7DQogICAgICAgIGNvbnN0IHBpZWNlQ29kZXMgPSBwaWVjZVN0YXRlLnBpZWNlQ29kZXM7DQogICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWVzID0gc2VhcmNoTWF0ZXJpYWxUYWJsZShnYW1lU3RhZ2UpOw0KICAgICAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbW92ZXMubGVuZ3RoOyBpbmRleCsrKSB7DQogICAgICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbaW5kZXhdOw0KICAgICAgICAgICAgY29uc3QgZnJvbVNxID0gbW92ZSA+Pj4gNzsNCiAgICAgICAgICAgIGNvbnN0IHRvU3EgPSBtb3ZlICYgTU9WRV9UT19NQVNLOw0KICAgICAgICAgICAgY29uc3QgdGFyZ2V0U2xvdCA9IHNxdWFyZVRvU2xvdFt0b1NxXTsNCiAgICAgICAgICAgIGNvbnN0IHRhcmdldFBpZWNlQ29kZSA9IHRhcmdldFNsb3QgPj0gMCA/IHBpZWNlQ29kZXNbdGFyZ2V0U2xvdF0gOiAwOw0KICAgICAgICAgICAgbGV0IHByaW9yaXR5ID0gNDsNCiAgICAgICAgICAgIGxldCBzY29yZSA9IDA7DQoNCiAgICAgICAgICAgIGlmICh0dE1vdmUgPT09IG1vdmUpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IC0xOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gMTAwMDAwMDsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0U2xvdCA+PSAwKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gbWF0ZXJpYWxWYWx1ZXNbdGFyZ2V0UGllY2VDb2RlICYgN10gKiAxNiAtIG1hdGVyaWFsVmFsdWVzW3BpZWNlQ29kZXNbc3F1YXJlVG9TbG90W2Zyb21TcV1dICYgN107DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmIChwcmlvcml0eSA+PSAwKSB7DQogICAgICAgICAgICAgICAgaWYgKHRhcmdldFNsb3QgPCAwICYmIGtpbGxlcnMgJiYgbW92ZSA9PT0ga2lsbGVyc1swXSkgew0KICAgICAgICAgICAgICAgICAgICBwcmlvcml0eSA9IE1hdGgubWluKHByaW9yaXR5LCAyKTsNCiAgICAgICAgICAgICAgICAgICAgc2NvcmUgKz0gODAwMDsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFNsb3QgPCAwICYmIGtpbGxlcnMgJiYgbW92ZSA9PT0ga2lsbGVyc1sxXSkgew0KICAgICAgICAgICAgICAgICAgICBwcmlvcml0eSA9IE1hdGgubWluKHByaW9yaXR5LCAyKTsNCiAgICAgICAgICAgICAgICAgICAgc2NvcmUgKz0gNzAwMDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgc2NvcmUgKz0gZ2V0SGlzdG9yeVNjb3JlKG1vdmUpOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtpbmRleF0gPSBwcmlvcml0eTsNCiAgICAgICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2luZGV4XSA9IHNjb3JlOw0KICAgICAgICB9DQogICAgfSBlbHNlIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBtb3Zlcy5sZW5ndGg7IGluZGV4KyspIHsNCiAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2luZGV4XTsNCiAgICAgICAgY29uc3QgZnJvbVNxID0gbW92ZUZyb21TcShtb3ZlKTsNCiAgICAgICAgY29uc3QgdG9TcSA9IG1vdmVUb1NxKG1vdmUpOw0KICAgICAgICBjb25zdCBmcm9tUiA9IChmcm9tU3EgLyA5KSB8IDAsIGZyb21DID0gZnJvbVNxICUgOTsNCiAgICAgICAgY29uc3QgdG9SID0gKHRvU3EgLyA5KSB8IDAsIHRvQyA9IHRvU3EgJSA5Ow0KICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2Zyb21SXVtmcm9tQ107DQogICAgICAgIGNvbnN0IHBpZWNlVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCB0YXJnZXRQaWVjZSA9IGJvYXJkW3RvUl1bdG9DXTsNCiAgICAgICAgY29uc3QgdGFyZ2V0UGllY2VWYWx1ZSA9IHRhcmdldFBpZWNlID8gZ2V0TWF0ZXJpYWxWYWx1ZSh0YXJnZXRQaWVjZSwgZ2FtZVN0YWdlKSA6IDA7DQogICAgICAgIGxldCBwcmlvcml0eSA9IDQ7DQogICAgICAgIGxldCBzY29yZSA9IDA7DQoNCiAgICAgICAgaWYgKHR0TW92ZSAmJiBpc1NhbWVNb3ZlKG1vdmUsIHR0TW92ZSkpIHsNCiAgICAgICAgICAgIHByaW9yaXR5ID0gLTE7DQogICAgICAgICAgICBzY29yZSA9IDEwMDAwMDA7DQogICAgICAgIH0gZWxzZSBpZiAoY3VycmVudElzSW5DaGVjaykgew0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZXNDaGVja2VyID0gdGFyZ2V0UGllY2UgJiYgc3F1YXJlTWFya1NjcmF0Y2hbdG9TcV0gIT09IDA7DQogICAgICAgICAgICBpZiAoY2FwdHVyZXNDaGVja2VyKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAwOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gMTAwMDAgKyB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMjsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWUgKiAxNiAtIHBpZWNlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHBpZWNlVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoaGFzVGhyZWF0ZW5lZCkgew0KICAgICAgICAgICAgaWYgKGlzTWFya2VkVGhyZWF0ZW5lZChmcm9tU3EpKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAxOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gcGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IGhhc0NhbkNhcHR1cmUgJiYgc3F1YXJlTWFya1NjcmF0Y2hbdG9TcV0gIT09IDAgPyAyIDogMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoaGFzQ2FuQ2FwdHVyZSkgew0KICAgICAgICAgICAgaWYgKHNxdWFyZU1hcmtTY3JhdGNoW3RvU3FdICE9PSAwKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7DQogICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWUgKiAxNiAtIHBpZWNlVmFsdWU7DQogICAgICAgIH0NCg0KICAgICAgICBpZiAocHJpb3JpdHkgPj0gMCkgew0KICAgICAgICAgICAgaWYgKCF0YXJnZXRQaWVjZSAmJiBraWxsZXJzICYmIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc1swXSkpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IE1hdGgubWluKHByaW9yaXR5LCAyKTsNCiAgICAgICAgICAgICAgICBzY29yZSArPSA4MDAwOw0KICAgICAgICAgICAgfSBlbHNlIGlmICghdGFyZ2V0UGllY2UgJiYga2lsbGVycyAmJiBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNbMV0pKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7DQogICAgICAgICAgICAgICAgc2NvcmUgKz0gNzAwMDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHNjb3JlICs9IGdldEhpc3RvcnlTY29yZShtb3ZlKTsNCiAgICAgICAgfQ0KDQogICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2luZGV4XSA9IHByaW9yaXR5Ow0KICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtpbmRleF0gPSBzY29yZTsNCiAgICAgICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSB7DQogICAgICAgICAgICBtb3ZlLnByaW9yaXR5ID0gcHJpb3JpdHk7DQogICAgICAgICAgICBtb3ZlLnNvcnRTY29yZSA9IHNjb3JlOw0KICAgICAgICAgICAgbW92ZS5vcmlnaW5hbEluZGV4ID0gaW5kZXg7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBmb3IgKGxldCBpID0gMTsgaSA8IG1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpXTsNCiAgICAgICAgY29uc3QgcHJpb3JpdHkgPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtpXTsNCiAgICAgICAgY29uc3Qgc2NvcmUgPSBzb3J0TW92ZVNjb3JlU2NyYXRjaFtpXTsNCiAgICAgICAgbGV0IGogPSBpIC0gMTsNCiAgICAgICAgd2hpbGUgKA0KICAgICAgICAgICAgaiA+PSAwICYmDQogICAgICAgICAgICAoc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbal0gPiBwcmlvcml0eSB8fA0KICAgICAgICAgICAgIChzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXSA9PT0gcHJpb3JpdHkgJiYgc29ydE1vdmVTY29yZVNjcmF0Y2hbal0gPCBzY29yZSkpDQogICAgICAgICkgew0KICAgICAgICAgICAgbW92ZXNbaiArIDFdID0gbW92ZXNbal07DQogICAgICAgICAgICBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqICsgMV0gPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXTsNCiAgICAgICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2ogKyAxXSA9IHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2pdOw0KICAgICAgICAgICAgai0tOw0KICAgICAgICB9DQogICAgICAgIG1vdmVzW2ogKyAxXSA9IG1vdmU7DQogICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2ogKyAxXSA9IHByaW9yaXR5Ow0KICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqICsgMV0gPSBzY29yZTsNCiAgICB9DQoNCiAgICBjbGVhclNvcnRTcXVhcmVNYXJrcygpOw0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnNvcnRNb3Zlc01zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsNCiAgICByZXR1cm4gbW92ZXM7DQp9Ow0KDQovLyBQbGF5LW9ubHkgbm9ybWFsLW5vZGUgb3JkZXJpbmcuIHByZXBhcmVTZWFyY2hJbmZvIGhhcyBubyByZWxhdGlvbiBsaXN0cywgc28NCi8vIGl0cyBub24tY2hlY2sgcGF0aCBpcyBleGFjdGx5IHRoZSBzaW1wbGUgYnJhbmNoIG9mIHNvcnRNb3Zlc0Zhc3Qgd2l0aG91dCB0aGUNCi8vIGdlbmVyaWMgVUkvYW5hbHlzaXMgYm9va2tlZXBpbmcuIENoZWNrZWQgcG9zaXRpb25zIHJldGFpbiB0aGUgZ2VuZXJpYyBvcmRlci4NCmNvbnN0IHNvcnRNb3Zlc1BsYXkgPSAobW92ZXMsIGJvYXJkLCBjdXJyZW50UGxheWVyLCBwaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGJvYXJkSW5mbywgdHRNb3ZlLCBraWxsZXJzLCBpbkNoZWNrKSA9PiB7DQogICAgaWYgKGluQ2hlY2spIHsNCiAgICAgICAgcmV0dXJuIHNvcnRNb3Zlc0Zhc3QobW92ZXMsIGJvYXJkLCBjdXJyZW50UGxheWVyLCBwaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGJvYXJkSW5mbywgeyB0dE1vdmUsIGtpbGxlcnMgfSk7DQogICAgfQ0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCiAgICBpZiAoIXBpZWNlU3RhdGUpIHsNCiAgICAgICAgcmV0dXJuIHNvcnRNb3Zlc0Zhc3QobW92ZXMsIGJvYXJkLCBjdXJyZW50UGxheWVyLCBwaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGJvYXJkSW5mbywgeyB0dE1vdmUsIGtpbGxlcnMgfSk7DQogICAgfQ0KDQogICAgY29uc3QgX190MCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOw0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnNvcnRNb3Zlc0NvdW50Kys7DQogICAgY29uc3Qgc3F1YXJlVG9TbG90ID0gcGllY2VTdGF0ZS5zcXVhcmVUb1Nsb3Q7DQogICAgY29uc3QgcGllY2VDb2RlcyA9IHBpZWNlU3RhdGUucGllY2VDb2RlczsNCiAgICBjb25zdCBtYXRlcmlhbFZhbHVlcyA9IHBpZWNlU3RhdGUubWF0ZXJpYWxWYWx1ZXM7DQoNCiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbW92ZXMubGVuZ3RoOyBpbmRleCsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpbmRleF07DQogICAgICAgIGNvbnN0IGZyb21TcSA9IG1vdmUgPj4+IDc7DQogICAgICAgIGNvbnN0IHRvU3EgPSBtb3ZlICYgTU9WRV9UT19NQVNLOw0KICAgICAgICBjb25zdCB0YXJnZXRTbG90ID0gc3F1YXJlVG9TbG90W3RvU3FdOw0KICAgICAgICBsZXQgcHJpb3JpdHkgPSA0Ow0KICAgICAgICBsZXQgc2NvcmUgPSAwOw0KDQogICAgICAgIGlmICh0dE1vdmUgPT09IG1vdmUpIHsNCiAgICAgICAgICAgIHByaW9yaXR5ID0gLTE7DQogICAgICAgICAgICBzY29yZSA9IDEwMDAwMDA7DQogICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0U2xvdCA+PSAwKSB7DQogICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICBzY29yZSA9IG1hdGVyaWFsVmFsdWVzW3BpZWNlQ29kZXNbdGFyZ2V0U2xvdF0gJiA3XSAqIDE2IC0NCiAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlc1twaWVjZUNvZGVzW3NxdWFyZVRvU2xvdFtmcm9tU3FdXSAmIDddOw0KICAgICAgICB9DQoNCiAgICAgICAgaWYgKHByaW9yaXR5ID49IDApIHsNCiAgICAgICAgICAgIGlmICh0YXJnZXRTbG90IDwgMCAmJiBraWxsZXJzICYmIG1vdmUgPT09IGtpbGxlcnNbMF0pIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDI7DQogICAgICAgICAgICAgICAgc2NvcmUgKz0gODAwMDsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0U2xvdCA8IDAgJiYga2lsbGVycyAmJiBtb3ZlID09PSBraWxsZXJzWzFdKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOw0KICAgICAgICAgICAgICAgIHNjb3JlICs9IDcwMDA7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBzY29yZSArPSBnZXRIaXN0b3J5U2NvcmUobW92ZSk7DQogICAgICAgIH0NCg0KICAgICAgICBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtpbmRleF0gPSBwcmlvcml0eTsNCiAgICAgICAgc29ydE1vdmVTY29yZVNjcmF0Y2hbaW5kZXhdID0gc2NvcmU7DQogICAgfQ0KDQogICAgZm9yIChsZXQgaSA9IDE7IGkgPCBtb3Zlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbaV07DQogICAgICAgIGNvbnN0IHByaW9yaXR5ID0gc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaV07DQogICAgICAgIGNvbnN0IHNjb3JlID0gc29ydE1vdmVTY29yZVNjcmF0Y2hbaV07DQogICAgICAgIGxldCBqID0gaSAtIDE7DQogICAgICAgIHdoaWxlICgNCiAgICAgICAgICAgIGogPj0gMCAmJg0KICAgICAgICAgICAgKHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2pdID4gcHJpb3JpdHkgfHwNCiAgICAgICAgICAgICAoc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbal0gPT09IHByaW9yaXR5ICYmIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2pdIDwgc2NvcmUpKQ0KICAgICAgICApIHsNCiAgICAgICAgICAgIG1vdmVzW2ogKyAxXSA9IG1vdmVzW2pdOw0KICAgICAgICAgICAgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaiArIDFdID0gc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbal07DQogICAgICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqICsgMV0gPSBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqXTsNCiAgICAgICAgICAgIGotLTsNCiAgICAgICAgfQ0KICAgICAgICBtb3Zlc1tqICsgMV0gPSBtb3ZlOw0KICAgICAgICBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqICsgMV0gPSBwcmlvcml0eTsNCiAgICAgICAgc29ydE1vdmVTY29yZVNjcmF0Y2hbaiArIDFdID0gc2NvcmU7DQogICAgfQ0KDQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuc29ydE1vdmVzTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIHJldHVybiBtb3ZlczsNCn07DQoNCi8vIOaQnOe0oueUqOedgOazleWHhuWkh++8iOi9u+mHj++8ie+8muS4jeW7uuWFs+ezu+Wbvi/lqIHog4Ev5py65Yqo5oCnDQovLyBTRUFSQ0hfREVGRVJfTEVHQUxJVFk9dHJ1Ze+8muWPqueUn+aIkOS8quWQiOazle+8jOWQiOazleaAp+WcqOivlei1sOaXtuajgOa1iw0KLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPWZhbHNl77ya6aKE6L+H5ruk5ZCI5rOV552A77yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQ0KLy8g54K55qOL5YWz57O75LuN6LWw5a6M5pW0IGV2YWx1YXRlQm9hcmTvvIzkuI3lj5flvbHlk40NCmNvbnN0IHByZXBhcmVTZWFyY2hJbmZvID0gKGJvYXJkLCBjdXJyZW50UGxheWVyKSA9PiB7DQogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQoNCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVja1Jhdyhib2FyZCwgY3VycmVudFBsYXllcik7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMucHJlcGFyZUNoZWNrTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIGNvbnN0IF9fbW92ZXNUMCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOw0KICAgIGNvbnN0IHBpZWNlc0luZm8gPSBbXTsNCiAgICBjb25zdCBsZWdhbE1vdmVMaXN0ID0gW107DQogICAgY29uc3QgZGVmZXIgPSB0cnVlOw0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCg0KICAgIGlmIChwaWVjZVN0YXRlKSB7DQogICAgICAgIGNvbnN0IHJlY29yZHMgPSBwaWVjZVN0YXRlLnJlY29yZHM7DQogICAgICAgIGNvbnN0IHNxdWFyZVRvU2xvdCA9IHBpZWNlU3RhdGUuc3F1YXJlVG9TbG90Ow0KICAgICAgICBjb25zdCBzcXVhcmVDb2RlcyA9IHBpZWNlU3RhdGUuc3F1YXJlQ29kZXM7DQogICAgICAgIGNvbnN0IHBpZWNlQ29kZXMgPSBwaWVjZVN0YXRlLnBpZWNlQ29kZXM7DQogICAgICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgew0KICAgICAgICAgICAgY29uc3Qgc2xvdCA9IHNxdWFyZVRvU2xvdFtzcV07DQogICAgICAgICAgICBpZiAoc2xvdCA8IDApIGNvbnRpbnVlOw0KICAgICAgICAgICAgY29uc3QgcmVjb3JkID0gcmVjb3Jkc1tzbG90XTsNCiAgICAgICAgICAgIGlmICghcmVjb3JkLmFsaXZlIHx8IHJlY29yZC5waWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7DQogICAgICAgICAgICBwaWVjZXNJbmZvLnB1c2goeyBwaWVjZTogcmVjb3JkLnBpZWNlLCByOiByZWNvcmQuciwgYzogcmVjb3JkLmMgfSk7DQogICAgICAgICAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgKz0gYXBwZW5kU2VhcmNoUHNldWRvTW92ZXNGb3JQaWVjZSgNCiAgICAgICAgICAgICAgICBsZWdhbE1vdmVMaXN0LCBzcSwgcGllY2VDb2Rlc1tzbG90XSwgc3F1YXJlQ29kZXMsIGZhbHNlDQogICAgICAgICAgICApOw0KICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICBpZiAoIXBpZWNlIHx8IHBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBjb25zdCBmcm9tID0geyByLCBjIH07DQogICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCBmcm9tLCBwaWVjZSk7DQogICAgICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IG1vdmVzIDogZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UsIG1vdmVzKTsNCiAgICAgICAgICAgICAgICBwaWVjZXNJbmZvLnB1c2goeyBwaWVjZSwgciwgYywgbW92ZXMsIGxlZ2FsTW92ZXM6IHVzZU1vdmVzIH0pOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdXNlTW92ZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tpXTsNCiAgICAgICAgICAgICAgICAgICAgbGVnYWxNb3ZlTGlzdC5wdXNoKGVuY29kZU1vdmVGcm9tQ29vcmRzKHIsIGMsIHRvLnIsIHRvLmMpKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IG1vdmVzLmxlbmd0aDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5wcmVwYXJlTW92ZUdlbk1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX19tb3Zlc1QwOw0KDQogICAgLy8g6L276YePIGJvYXJkSW5mb++8muS7heiiq+Wwhuagh+W/lw0KICAgIGNvbnN0IGJvYXJkSW5mbyA9IHsNCiAgICAgICAgcmVkSXNJbkNoZWNrOiBjdXJyZW50UGxheWVyID09PSAncmVkJyA/IGluQ2hlY2sgOiBmYWxzZSwNCiAgICAgICAgYmxhY2tJc0luQ2hlY2s6IGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgPyBpbkNoZWNrIDogZmFsc2UsDQogICAgICAgIGdhbWVTdGF0ZTogbnVsbA0KICAgIH07DQoNCiAgICBpZiAobGVnYWxNb3ZlTGlzdC5sZW5ndGggPT09IDApIHsNCiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IGluQ2hlY2sNCiAgICAgICAgICAgID8geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH0NCiAgICAgICAgICAgIDogeyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfSBlbHNlIHsNCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAncGxheWluZycgfTsNCiAgICB9DQoNCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7DQogICAgcmV0dXJuIHsgcGllY2VzSW5mbywgYm9hcmRJbmZvLCBsZWdhbE1vdmVMaXN0LCBpbkNoZWNrIH07DQp9Ow0KDQovLyDorqHnrpfooY3nlJ/lgLzvvJrlqIHog4HlgLzjgIHlronlhajlgLzjgIHmiJjmnK/lgLzjgIHmnLrliqjlgLwNCmNvbnN0IGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMgPSAoYm9hcmQsIHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIgPSBudWxsLCBib2FyZEluZm8gPSBudWxsLCBmb3JTZWFyY2hMZWFmID0gZmFsc2UpID0+IHsNCiAgICAvLyDph43nva7miYDmnInooY3nlJ/lgLzvvIzpmaTkuobmnLrliqjlgLzvvIjlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpfvvIkNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpbmZvLnRocmVhdFZhbHVlID0gMDsNCiAgICAgICAgaW5mby5zYWZldHlWYWx1ZSA9IDA7DQogICAgICAgIGluZm8udGFjdGljVmFsdWUgPSAwOw0KICAgICAgICAvLyDkv53nlZnmnLrliqjlgLzvvIzlm6DkuLrlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpcNCiAgICB9DQogICAgDQogICAgLy8gMS4g6K6h566X5qOL5a2Q5YWz57O777yI5aiB6IOB6ICF44CB6KKr5aiB6IOB6ICF44CB5L+d5oqk6ICF44CB6KKr5L+d5oqk6ICF77yJDQogICAgaWYgKCFib2FyZEluZm8pIHsNCiAgICAgICAgYm9hcmRJbmZvID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7DQogICAgfQ0KICAgIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zKGJvYXJkLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgIA0KICAgIC8vIDIuIOiuoeeul+WogeiDgeWAvO+8iOaMieiiq+WogeiDgeWtkOiBmuWQiO+8jFNFRSDmr4/nm67moIfkuIDmrKHvvIkNCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMocGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvLCBmb3JTZWFyY2hMZWFmKTsNCiAgICANCiAgICAvLyAzLiDorqHnrpflronlhajlgLwNCiAgICBjYWxjdWxhdGVTYWZldHlWYWx1ZXMocGllY2VzSW5mbywgYm9hcmRJbmZvLCBib2FyZCwgZm9yU2VhcmNoTGVhZik7DQogICAgDQogICAgLy8gNC4g6K6h566X5ri45oiP54q25oCB5bm25L+d5a2Y5YiwYm9hcmRJbmZvDQogICAgLy8g5pCc57Si5Y+26IqC54K56Lez6L+H77ya5peg552AL+Wwhuatu+W3suWcqOeItuiKgueCueWkhOeQhu+8jOatpOWkhOWPqumcgOmdmeaAgeWIhg0KICAgIGlmIChjdXJyZW50UGxheWVyICYmICFmb3JTZWFyY2hMZWFmKSB7DQogICAgICAgIC8vIOajgOafpeW9k+WJjeeOqeWutuaYr+WQpuacieWQiOazlei1sOazlQ0KICAgICAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsNCiAgICAgICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5qOL5a2Q55qE5pyJ5pWI6LWw5rOVDQogICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHI6IGluZm8uciwgYzogaW5mby5jIH0pOw0KICAgICAgICAgICAgICAgIGlmIChtb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDliKTmlq3muLjmiI/nirbmgIENCiAgICAgICAgbGV0IGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAncGxheWluZycgfTsNCiAgICAgICAgaWYgKCFoYXNNb3Zlcykgew0KICAgICAgICAgICAgLy8g5rKh5pyJ5ZCI5rOV6LWw5rOV77yM5qOA5p+l5piv5ZCm6KKr5bCG5YabDQogICAgICAgICAgICBjb25zdCBpbkNoZWNrID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkSXNJbkNoZWNrIDogYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrOw0KICAgICAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKGluQ2hlY2spIHsNCiAgICAgICAgICAgICAgICBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIOS/neWtmOa4uOaIj+eKtuaAgeWIsGJvYXJkSW5mbw0KICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0gZ2FtZVN0YXRlOw0KICAgIH0NCn07DQoNCi8vIOaji+WtkOWHoOS9leaWueWQkeihqO+8iOmihOiuoeeul+iFvy/nnLzlgY/np7vvvIzng63ot6/lvoTpgb/lhY0gTWF0aC5zaWduIC8gZHIvMu+8iQ0KY29uc3QgT1JUSF9ESVJTID0gWw0KICAgIFswLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdDQpdOw0KY29uc3QgRElBR19ESVJTID0gWw0KICAgIFsxLCAxXSwgWzEsIC0xXSwgWy0xLCAxXSwgWy0xLCAtMV0NCl07DQpjb25zdCBFTEVQSEFOVF9ESVJTID0gWw0KICAgIHsgZHI6IDIsIGRjOiAyLCBleWVEcjogMSwgZXllRGM6IDEgfSwNCiAgICB7IGRyOiAyLCBkYzogLTIsIGV5ZURyOiAxLCBleWVEYzogLTEgfSwNCiAgICB7IGRyOiAtMiwgZGM6IDIsIGV5ZURyOiAtMSwgZXllRGM6IDEgfSwNCiAgICB7IGRyOiAtMiwgZGM6IC0yLCBleWVEcjogLTEsIGV5ZURjOiAtMSB9DQpdOw0KY29uc3QgSE9SU0VfRElSUyA9IFsNCiAgICB7IGRyOiAyLCBkYzogMSwgbGVnRHI6IDEsIGxlZ0RjOiAwIH0sDQogICAgeyBkcjogMiwgZGM6IC0xLCBsZWdEcjogMSwgbGVnRGM6IDAgfSwNCiAgICB7IGRyOiAtMiwgZGM6IDEsIGxlZ0RyOiAtMSwgbGVnRGM6IDAgfSwNCiAgICB7IGRyOiAtMiwgZGM6IC0xLCBsZWdEcjogLTEsIGxlZ0RjOiAwIH0sDQogICAgeyBkcjogMSwgZGM6IDIsIGxlZ0RyOiAwLCBsZWdEYzogMSB9LA0KICAgIHsgZHI6IDEsIGRjOiAtMiwgbGVnRHI6IDAsIGxlZ0RjOiAtMSB9LA0KICAgIHsgZHI6IC0xLCBkYzogMiwgbGVnRHI6IDAsIGxlZ0RjOiAxIH0sDQogICAgeyBkcjogLTEsIGRjOiAtMiwgbGVnRHI6IDAsIGxlZ0RjOiAtMSB9DQpdOw0KDQovLyDnn63mraXlrZDpooTooajvvJrkuI7ljp8gc3dpdGNoIOaWueWQkemhuuW6jy/lrqvmsrPov4fmu6TkuIDoh7TvvJvpqazosaHluKYgYnIsYmPvvIjohb8v55y877yJDQpjb25zdCBHRU5FUkFMX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07DQpjb25zdCBBRFZJU09SX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07DQpjb25zdCBFTEVQSEFOVF9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgSE9SU0VfREVTVCA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7DQpjb25zdCBTT0xESUVSX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07DQoNCigoKSA9PiB7DQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHNxID0gciAqIDkgKyBjOw0KICAgICAgICAgICAgY29uc3QgZ1JlZCA9IFtdLCBnQmxhY2sgPSBbXSwgYVJlZCA9IFtdLCBhQmxhY2sgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IGVSZWQgPSBbXSwgZUJsYWNrID0gW10sIGhvcnNlID0gW10sIHNSZWQgPSBbXSwgc0JsYWNrID0gW107DQoNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgT1JUSF9ESVJTW2ldWzBdLCBuYyA9IGMgKyBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgICAgICAgICAgaWYgKG5jIDwgMyB8fCBuYyA+IDUpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChuciA+PSAwICYmIG5yIDw9IDIpIGdSZWQucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPj0gNyAmJiBuciA8PSA5KSBnQmxhY2sucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgRElBR19ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgRElBR19ESVJTW2ldWzBdLCBuYyA9IGMgKyBESUFHX0RJUlNbaV1bMV07DQogICAgICAgICAgICAgICAgaWYgKG5jIDwgMyB8fCBuYyA+IDUpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChuciA+PSAwICYmIG5yIDw9IDIpIGFSZWQucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPj0gNyAmJiBuciA8PSA5KSBhQmxhY2sucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgRUxFUEhBTlRfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBFTEVQSEFOVF9ESVJTW2ldOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIGQuZHIsIG5jID0gYyArIGQuZGM7DQogICAgICAgICAgICAgICAgaWYgKG5yIDwgMCB8fCBuciA+PSBST1dTIHx8IG5jIDwgMCB8fCBuYyA+PSBDT0xTKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBjb25zdCBleWVSID0gciArIGQuZXllRHIsIGV5ZUMgPSBjICsgZC5leWVEYzsNCiAgICAgICAgICAgICAgICBpZiAobnIgPD0gNCkgZVJlZC5wdXNoKHsgcjogbnIsIGM6IG5jLCBicjogZXllUiwgYmM6IGV5ZUMgfSk7DQogICAgICAgICAgICAgICAgaWYgKG5yID49IDUpIGVCbGFjay5wdXNoKHsgcjogbnIsIGM6IG5jLCBicjogZXllUiwgYmM6IGV5ZUMgfSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IEhPUlNFX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gSE9SU0VfRElSU1tpXTsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBkLmRyLCBuYyA9IGMgKyBkLmRjOw0KICAgICAgICAgICAgICAgIGNvbnN0IGxlZ1IgPSByICsgZC5sZWdEciwgbGVnQyA9IGMgKyBkLmxlZ0RjOw0KICAgICAgICAgICAgICAgIGlmIChsZWdSIDwgMCB8fCBsZWdSID49IFJPV1MgfHwgbGVnQyA8IDAgfHwgbGVnQyA+PSBDT0xTKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPCAwIHx8IG5yID49IFJPV1MgfHwgbmMgPCAwIHx8IG5jID49IENPTFMpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGhvcnNlLnB1c2goeyByOiBuciwgYzogbmMsIGJyOiBsZWdSLCBiYzogbGVnQyB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHsNCiAgICAgICAgICAgICAgICBjb25zdCBmciA9IHIgKyAxOw0KICAgICAgICAgICAgICAgIGlmIChmciA+PSAwICYmIGZyIDwgUk9XUykgc1JlZC5wdXNoKHsgcjogZnIsIGMgfSk7DQogICAgICAgICAgICAgICAgaWYgKHIgPj0gNSkgew0KICAgICAgICAgICAgICAgICAgICBpZiAoYyAtIDEgPj0gMCkgc1JlZC5wdXNoKHsgciwgYzogYyAtIDEgfSk7DQogICAgICAgICAgICAgICAgICAgIGlmIChjICsgMSA8IENPTFMpIHNSZWQucHVzaCh7IHIsIGM6IGMgKyAxIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBjb25zdCBmYnIgPSByIC0gMTsNCiAgICAgICAgICAgICAgICBpZiAoZmJyID49IDAgJiYgZmJyIDwgUk9XUykgc0JsYWNrLnB1c2goeyByOiBmYnIsIGMgfSk7DQogICAgICAgICAgICAgICAgaWYgKHIgPD0gNCkgew0KICAgICAgICAgICAgICAgICAgICBpZiAoYyAtIDEgPj0gMCkgc0JsYWNrLnB1c2goeyByLCBjOiBjIC0gMSB9KTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGMgKyAxIDwgQ09MUykgc0JsYWNrLnB1c2goeyByLCBjOiBjICsgMSB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIEdFTkVSQUxfREVTVFswXVtzcV0gPSBnUmVkOw0KICAgICAgICAgICAgR0VORVJBTF9ERVNUWzFdW3NxXSA9IGdCbGFjazsNCiAgICAgICAgICAgIEFEVklTT1JfREVTVFswXVtzcV0gPSBhUmVkOw0KICAgICAgICAgICAgQURWSVNPUl9ERVNUWzFdW3NxXSA9IGFCbGFjazsNCiAgICAgICAgICAgIEVMRVBIQU5UX0RFU1RbMF1bc3FdID0gZVJlZDsNCiAgICAgICAgICAgIEVMRVBIQU5UX0RFU1RbMV1bc3FdID0gZUJsYWNrOw0KICAgICAgICAgICAgSE9SU0VfREVTVFtzcV0gPSBob3JzZTsNCiAgICAgICAgICAgIFNPTERJRVJfREVTVFswXVtzcV0gPSBzUmVkOw0KICAgICAgICAgICAgU09MRElFUl9ERVNUWzFdW3NxXSA9IHNCbGFjazsNCiAgICAgICAgfQ0KICAgIH0NCn0pKCk7DQoNCmNvbnN0IFNFQVJDSF9HRU5FUkFMX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07DQpjb25zdCBTRUFSQ0hfQURWSVNPUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgU0VBUkNIX0VMRVBIQU5UX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07DQpjb25zdCBTRUFSQ0hfSE9SU0VfREVTVCA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7DQpjb25zdCBTRUFSQ0hfU09MRElFUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KLy8gQWxsIG9ydGhvZ29uYWwgcmF5cyBsaXZlIGluIG9uZSBjb21wYWN0IGJ1ZmZlci4gVGhlIG9mZnNldCB0YWJsZSBhdm9pZHMNCi8vIGh1bmRyZWRzIG9mIHRpbnkgVHlwZWRBcnJheXMgaW4gdGhlIHJlbGF0aW9uLCBwc2V1ZG8tbW92ZSwgYW5kIGNoZWNrIHBhdGhzLg0KY29uc3QgU0VBUkNIX1JBWV9PRkZTRVRTID0gbmV3IFVpbnQxNkFycmF5KFJFTF9TUVVBUkVTICogT1JUSF9ESVJTLmxlbmd0aCArIDEpOw0KbGV0IFNFQVJDSF9SQVlfU1FVQVJFUyA9IG51bGw7DQpjb25zdCBTRUFSQ0hfUkFZX0RJUlMgPSA0Ow0KY29uc3QgU0VBUkNIX0hPUlNFX0NIRUNLRVJTID0gbmV3IEFycmF5KFJFTF9TUVVBUkVTKTsNCmNvbnN0IFNFQVJDSF9TUV9ST1dTID0gbmV3IFVpbnQ4QXJyYXkoUkVMX1NRVUFSRVMpOw0KY29uc3QgU0VBUkNIX1NRX0NPTFMgPSBuZXcgVWludDhBcnJheShSRUxfU1FVQVJFUyk7DQoNCigoKSA9PiB7DQogICAgY29uc3Qgc2VhcmNoUmF5U3F1YXJlcyA9IFtdOw0KICAgIGNvbnN0IHNxdWFyZURlc3RpbmF0aW9ucyA9IChkZXN0cykgPT4gew0KICAgICAgICBjb25zdCBwYWNrZWQgPSBuZXcgVWludDhBcnJheShkZXN0cy5sZW5ndGgpOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSBwYWNrZWRbaV0gPSBkZXN0c1tpXS5yICogOSArIGRlc3RzW2ldLmM7DQogICAgICAgIHJldHVybiBwYWNrZWQ7DQogICAgfTsNCiAgICBjb25zdCBibG9ja2VkRGVzdGluYXRpb25zID0gKGRlc3RzKSA9PiB7DQogICAgICAgIGNvbnN0IHBhY2tlZCA9IG5ldyBVaW50MTZBcnJheShkZXN0cy5sZW5ndGgpOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBwYWNrZWRbaV0gPSAoZGVzdHNbaV0uYnIgKiA5ICsgZGVzdHNbaV0uYmMpICogMTI4ICsgZGVzdHNbaV0uciAqIDkgKyBkZXN0c1tpXS5jOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBwYWNrZWQ7DQogICAgfTsNCg0KICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgew0KICAgICAgICBTRUFSQ0hfR0VORVJBTF9ERVNUWzBdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhHRU5FUkFMX0RFU1RbMF1bc3FdKTsNCiAgICAgICAgU0VBUkNIX0dFTkVSQUxfREVTVFsxXVtzcV0gPSBzcXVhcmVEZXN0aW5hdGlvbnMoR0VORVJBTF9ERVNUWzFdW3NxXSk7DQogICAgICAgIFNFQVJDSF9BRFZJU09SX0RFU1RbMF1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKEFEVklTT1JfREVTVFswXVtzcV0pOw0KICAgICAgICBTRUFSQ0hfQURWSVNPUl9ERVNUWzFdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhBRFZJU09SX0RFU1RbMV1bc3FdKTsNCiAgICAgICAgU0VBUkNIX0VMRVBIQU5UX0RFU1RbMF1bc3FdID0gYmxvY2tlZERlc3RpbmF0aW9ucyhFTEVQSEFOVF9ERVNUWzBdW3NxXSk7DQogICAgICAgIFNFQVJDSF9FTEVQSEFOVF9ERVNUWzFdW3NxXSA9IGJsb2NrZWREZXN0aW5hdGlvbnMoRUxFUEhBTlRfREVTVFsxXVtzcV0pOw0KICAgICAgICBTRUFSQ0hfSE9SU0VfREVTVFtzcV0gPSBibG9ja2VkRGVzdGluYXRpb25zKEhPUlNFX0RFU1Rbc3FdKTsNCiAgICAgICAgU0VBUkNIX1NPTERJRVJfREVTVFswXVtzcV0gPSBzcXVhcmVEZXN0aW5hdGlvbnMoU09MRElFUl9ERVNUWzBdW3NxXSk7DQogICAgICAgIFNFQVJDSF9TT0xESUVSX0RFU1RbMV1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKFNPTERJRVJfREVTVFsxXVtzcV0pOw0KDQogICAgICAgIGNvbnN0IHIgPSAoc3EgLyA5KSB8IDA7DQogICAgICAgIGNvbnN0IGMgPSBzcSAlIDk7DQogICAgICAgIFNFQVJDSF9TUV9ST1dTW3NxXSA9IHI7DQogICAgICAgIFNFQVJDSF9TUV9DT0xTW3NxXSA9IGM7DQogICAgICAgIGZvciAobGV0IGRpciA9IDA7IGRpciA8IE9SVEhfRElSUy5sZW5ndGg7IGRpcisrKSB7DQogICAgICAgICAgICBTRUFSQ0hfUkFZX09GRlNFVFNbKHNxIDw8IDIpIHwgZGlyXSA9IHNlYXJjaFJheVNxdWFyZXMubGVuZ3RoOw0KICAgICAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbZGlyXVswXTsNCiAgICAgICAgICAgIGNvbnN0IGRjID0gT1JUSF9ESVJTW2Rpcl1bMV07DQogICAgICAgICAgICBmb3IgKGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7IG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTOyBuciArPSBkciwgbmMgKz0gZGMpIHsNCiAgICAgICAgICAgICAgICBzZWFyY2hSYXlTcXVhcmVzLnB1c2gobnIgKiA5ICsgbmMpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgY29uc3QgaG9yc2VDaGVja2VycyA9IFtdOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IEhPUlNFX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IGQgPSBIT1JTRV9ESVJTW2ldOw0KICAgICAgICAgICAgY29uc3QgaG9yc2VSID0gciArIGQuZHI7DQogICAgICAgICAgICBjb25zdCBob3JzZUMgPSBjICsgZC5kYzsNCiAgICAgICAgICAgIGlmIChob3JzZVIgPCAwIHx8IGhvcnNlUiA+PSBST1dTIHx8IGhvcnNlQyA8IDAgfHwgaG9yc2VDID49IENPTFMpIGNvbnRpbnVlOw0KICAgICAgICAgICAgY29uc3QgbGVnUiA9IGhvcnNlUiAtIGQubGVnRHI7DQogICAgICAgICAgICBjb25zdCBsZWdDID0gaG9yc2VDIC0gZC5sZWdEYzsNCiAgICAgICAgICAgIGhvcnNlQ2hlY2tlcnMucHVzaCgobGVnUiAqIDkgKyBsZWdDKSAqIDEyOCArIGhvcnNlUiAqIDkgKyBob3JzZUMpOw0KICAgICAgICB9DQogICAgICAgIFNFQVJDSF9IT1JTRV9DSEVDS0VSU1tzcV0gPSBuZXcgVWludDE2QXJyYXkoaG9yc2VDaGVja2Vycyk7DQogICAgfQ0KICAgIFNFQVJDSF9SQVlfT0ZGU0VUU1tSRUxfU1FVQVJFUyA8PCAyXSA9IHNlYXJjaFJheVNxdWFyZXMubGVuZ3RoOw0KICAgIFNFQVJDSF9SQVlfU1FVQVJFUyA9IG5ldyBVaW50OEFycmF5KHNlYXJjaFJheVNxdWFyZXMpOw0KfSkoKTsNCg0KY29uc3QgYXBwZW5kU2VhcmNoU2hvcnRNb3ZlcyA9IChtb3ZlcywgZnJvbVNxLCBkZXN0cywgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIGJsb2NrZWQpID0+IHsNCiAgICBsZXQgZ2VuZXJhdGVkID0gMDsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGxldCB0b1NxID0gZGVzdHNbaV07DQogICAgICAgIGlmIChibG9ja2VkKSB7DQogICAgICAgICAgICBpZiAoc3F1YXJlQ29kZXNbdG9TcSA+Pj4gN10gIT09IDApIGNvbnRpbnVlOw0KICAgICAgICAgICAgdG9TcSAmPSAxMjc7DQogICAgICAgIH0NCiAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3RvU3FdOw0KICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICAgICAgZ2VuZXJhdGVkKys7DQogICAgICAgICAgICBpZiAoIWNhcHR1cmVzT25seSkgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7DQogICAgICAgIH0gZWxzZSBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHsNCiAgICAgICAgICAgIGdlbmVyYXRlZCsrOw0KICAgICAgICAgICAgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7DQogICAgICAgIH0NCiAgICB9DQogICAgcmV0dXJuIGdlbmVyYXRlZDsNCn07DQoNCmNvbnN0IGFwcGVuZFNlYXJjaFBzZXVkb01vdmVzRm9yUGllY2UgPSAobW92ZXMsIGZyb21TcSwgcGllY2VDb2RlLCBzcXVhcmVDb2RlcywgY2FwdHVyZXNPbmx5ID0gZmFsc2UpID0+IHsNCiAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZUNvZGUgJiA3Ow0KICAgIGNvbnN0IGlzUmVkID0gcGllY2VDb2RlIDwgODsNCiAgICBjb25zdCBjb2xvcklkeCA9IGlzUmVkID8gMCA6IDE7DQogICAgbGV0IGdlbmVyYXRlZCA9IDA7DQoNCiAgICBzd2l0Y2ggKHBpZWNlVHlwZSkgew0KICAgICAgICBjYXNlIDE6DQogICAgICAgICAgICByZXR1cm4gYXBwZW5kU2VhcmNoU2hvcnRNb3Zlcyhtb3ZlcywgZnJvbVNxLCBTRUFSQ0hfR0VORVJBTF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdLCBzcXVhcmVDb2RlcywgaXNSZWQsIGNhcHR1cmVzT25seSwgZmFsc2UpOw0KICAgICAgICBjYXNlIDU6DQogICAgICAgICAgICByZXR1cm4gYXBwZW5kU2VhcmNoU2hvcnRNb3Zlcyhtb3ZlcywgZnJvbVNxLCBTRUFSQ0hfQURWSVNPUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdLCBzcXVhcmVDb2RlcywgaXNSZWQsIGNhcHR1cmVzT25seSwgZmFsc2UpOw0KICAgICAgICBjYXNlIDQ6DQogICAgICAgICAgICByZXR1cm4gYXBwZW5kU2VhcmNoU2hvcnRNb3Zlcyhtb3ZlcywgZnJvbVNxLCBTRUFSQ0hfRUxFUEhBTlRfREVTVFtjb2xvcklkeF1bZnJvbVNxXSwgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIHRydWUpOw0KICAgICAgICBjYXNlIDM6DQogICAgICAgICAgICByZXR1cm4gYXBwZW5kU2VhcmNoU2hvcnRNb3Zlcyhtb3ZlcywgZnJvbVNxLCBTRUFSQ0hfSE9SU0VfREVTVFtmcm9tU3FdLCBzcXVhcmVDb2RlcywgaXNSZWQsIGNhcHR1cmVzT25seSwgdHJ1ZSk7DQogICAgICAgIGNhc2UgNzoNCiAgICAgICAgICAgIHJldHVybiBhcHBlbmRTZWFyY2hTaG9ydE1vdmVzKG1vdmVzLCBmcm9tU3EsIFNFQVJDSF9TT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV0sIHNxdWFyZUNvZGVzLCBpc1JlZCwgY2FwdHVyZXNPbmx5LCBmYWxzZSk7DQogICAgICAgIGNhc2UgMjoNCiAgICAgICAgICAgIGZvciAobGV0IGRpciA9IDAsIHJheUluZGV4ID0gZnJvbVNxIDw8IDI7IGRpciA8IFNFQVJDSF9SQVlfRElSUzsgZGlyKyssIHJheUluZGV4KyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCByYXlFbmQgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXggKyAxXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCByYXlQb3MgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXhdOyByYXlQb3MgPCByYXlFbmQ7IHJheVBvcysrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvU3EgPSBTRUFSQ0hfUkFZX1NRVUFSRVNbcmF5UG9zXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3RvU3FdOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgZ2VuZXJhdGVkKys7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWNhcHR1cmVzT25seSkgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBnZW5lcmF0ZWQrKzsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKChmcm9tU3EgPDwgNykgfCB0b1NxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgcmV0dXJuIGdlbmVyYXRlZDsNCiAgICAgICAgY2FzZSA2Og0KICAgICAgICAgICAgZm9yIChsZXQgZGlyID0gMCwgcmF5SW5kZXggPSBmcm9tU3EgPDwgMjsgZGlyIDwgU0VBUkNIX1JBWV9ESVJTOyBkaXIrKywgcmF5SW5kZXgrKykgew0KICAgICAgICAgICAgICAgIGxldCBzY3JlZW5Gb3VuZCA9IGZhbHNlOw0KICAgICAgICAgICAgICAgIGNvbnN0IHJheUVuZCA9IFNFQVJDSF9SQVlfT0ZGU0VUU1tyYXlJbmRleCArIDFdOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IHJheVBvcyA9IFNFQVJDSF9SQVlfT0ZGU0VUU1tyYXlJbmRleF07IHJheVBvcyA8IHJheUVuZDsgcmF5UG9zKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9TcSA9IFNFQVJDSF9SQVlfU1FVQVJFU1tyYXlQb3NdOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbdG9TcV07DQogICAgICAgICAgICAgICAgICAgIGlmICghc2NyZWVuRm91bmQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2VuZXJhdGVkKys7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjYXB0dXJlc09ubHkpIG1vdmVzLnB1c2goKGZyb21TcSA8PCA3KSB8IHRvU3EpOw0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzY3JlZW5Gb3VuZCA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0Q29kZSAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2VuZXJhdGVkKys7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHJldHVybiBnZW5lcmF0ZWQ7DQogICAgICAgIGRlZmF1bHQ6DQogICAgICAgICAgICByZXR1cm4gZ2VuZXJhdGVkOw0KICAgIH0NCn07DQoNCi8vIOaooeWdl+e6p+iQveeCueWkhOeQhu+8iOmdnuavj+WtkOaWsOW7uumXreWMhe+8ie+8m+i/lOWbnuacuuWKqOWinumHjw0KLy8gcGllY2VBdFNxOiA5MCDmoLwg4oaSIHBpZWNlc0luZm/vvJtyZWxDdHgudXNlTWFza3Mg5pe25YaZIG1hc2sNCmNvbnN0IGFwcGx5UmVsYXRpb25TcXVhcmUgPSAoYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgdHIsIHRjLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yKSA9PiB7DQogICAgaWYgKHRyIDwgMCB8fCB0ciA+PSBST1dTIHx8IHRjIDwgMCB8fCB0YyA+PSBDT0xTKSByZXR1cm4gMDsNCiAgICBjb25zdCB0YXJnZXQgPSBib2FyZFt0cl1bdGNdOw0KICAgIGlmICghdGFyZ2V0KSB7DQogICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgY29uc3Qgc3EgPSB0ciAqIDkgKyB0YzsNCiAgICAgICAgICAgIGlmICghcmVsQ3R4LnNraXBDb250cm9sTWFzaykgcmVsQ3R4LmNvbnRyb2xNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChyZWxDdHgucmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICBlbHNlIHNldEF0dGFja0JpdChyZWxDdHguYmxhY2tBdHRhY2ssIHNxKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICB9DQogICAgaWYgKHRhcmdldC5jb2xvciAhPT0gcGllY2VDb2xvcikgew0KICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgIGlmIChwaWVjZUF0U3FbdHIgKiA5ICsgdGNdKSB7DQogICAgICAgICAgICAgICAgcmVsQ3R4LmF0dGFja01hc2tbdHIgKiA5ICsgdGNdIHw9IGJpdDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbdHIgKiA5ICsgdGNdOw0KICAgICAgICAgICAgaWYgKHRhcmdldEluZm8pIHsNCiAgICAgICAgICAgICAgICBpbmZvLnRocmVhdC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIDA7DQogICAgfQ0KICAgIGlmICh0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbdHIgKiA5ICsgdGNdOw0KICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICByZWxDdHguZ3VhcmRNYXNrW3RyICogOSArIHRjXSB8PSBiaXQ7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLmd1YXJkZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgIGluZm8uYWxseUd1YXJkcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiAwOw0KfTsNCg0KLy8g6Z2e54Ku77ya5LiA5qyh5Yeg5L2V5omr5o+P77yb55+t5q2l5a2Q6LWw6aKE6KGo77yM6L2m5LuN5bCE57q/77yb6K+t5LmJ5LiOIGdldFBpZWNlTW92ZXMg5LiA6Ie0DQpjb25zdCBmaWxsTm9uQ2Fubm9uUmVsYXRpb25zID0gKGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIHJlbEN0eCA9IG51bGwpID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGluZm8ucGllY2U7DQogICAgY29uc3QgeyByLCBjIH0gPSBpbmZvOw0KICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICAgIGNvbnN0IHBpZWNlQ29sb3IgPSBwaWVjZS5jb2xvcjsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKHJlbEN0eCAmJiByZWxDdHgudXNlTWFza3MpOw0KICAgIGNvbnN0IHNraXBDb250cm9sID0gdXNlTWFza3MgJiYgcmVsQ3R4LnNraXBDb250cm9sTWFzazsNCiAgICBjb25zdCBiaXQgPSB1c2VNYXNrcyA/ICgxIDw8IHJlbEN0eC5waWVjZUluZGV4KSA6IDA7DQogICAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOw0KICAgIGNvbnN0IGZyb21TcSA9IHIgKiA5ICsgYzsNCiAgICBpZiAoIXVzZU1hc2tzKSB7DQogICAgICAgIGluZm8ubW92ZXMgPSBbXTsNCiAgICAgICAgaW5mby5jb250cm9sID0gW107DQogICAgICAgIGluZm8uYWxseUd1YXJkcyA9IFtdOw0KICAgIH0NCiAgICBsZXQgbW9iaWxpdHlWYWx1ZSA9IDA7DQoNCiAgICBzd2l0Y2ggKHBpZWNlLnR5cGUpIHsNCiAgICAgICAgY2FzZSAnZ2VuZXJhbCc6IHsNCiAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gR0VORVJBTF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoDQogICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGNhc2UgJ2Fkdmlzb3InOiB7DQogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEFEVklTT1JfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVJlbGF0aW9uU3F1YXJlKA0KICAgICAgICAgICAgICAgICAgICBib2FyZCwgaW5mbywgcGllY2VBdFNxLCBkLnIsIGQuYywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcg0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBjYXNlICdlbGVwaGFudCc6IHsNCiAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gRUxFUEhBTlRfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW2QuYnJdW2QuYmNdID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnaG9yc2UnOiB7DQogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEhPUlNFX0RFU1RbZnJvbVNxXTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW2QuYnJdW2QuYmNdID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnY2hhcmlvdCc6DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIHdoaWxlIChuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0ID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzcSA9IG5yICogOSArIG5jOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghc2tpcENvbnRyb2wpIHJlbEN0eC5jb250cm9sTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHJlbEN0eC5yZWRBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHNldEF0dGFja0JpdChyZWxDdHguYmxhY2tBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlQXRTcVtuciAqIDkgKyBuY10pIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5hdHRhY2tNYXNrW25yICogOSArIG5jXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbbnIgKiA5ICsgbmNdOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW25yICogOSArIG5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsQ3R4Lmd1YXJkTWFza1tuciAqIDkgKyBuY10gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5ndWFyZC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uYWxseUd1YXJkcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICAgICAgICAgIG5jICs9IGRjOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICBjYXNlICdzb2xkaWVyJzogew0KICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBTT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgZC5yLCBkLmMsIHVzZU1hc2tzLCBiaXQsIHJlbEN0eCwgaXNSZWQsIHBpZWNlQ29sb3INCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgZGVmYXVsdDoNCiAgICAgICAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOw0KfTsNCg0KLy8g54Ku77ya5LiA5qyh5Zub5ZCR5bCE57q/77ybbWFzayDmqKHlvI/lhpkgYXR0YWNrL2d1YXJkL2NvbnRyb2zvvIzliJfooajmqKHlvI/kv53mjIHml6for63kuYkNCmNvbnN0IGZpbGxDYW5ub25SZWxhdGlvbnMgPSAoYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgcmVsQ3R4ID0gbnVsbCkgPT4gew0KICAgIGNvbnN0IHBpZWNlID0gaW5mby5waWVjZTsNCiAgICBjb25zdCB7IHIsIGMgfSA9IGluZm87DQogICAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQogICAgY29uc3QgcGllY2VDb2xvciA9IHBpZWNlLmNvbG9yOw0KICAgIGNvbnN0IHsgYmFzZU1vdmVWYWx1ZSB9ID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5Ow0KICAgIGNvbnN0IHVzZU1hc2tzID0gISEocmVsQ3R4ICYmIHJlbEN0eC51c2VNYXNrcyk7DQogICAgY29uc3Qgc2tpcENvbnRyb2wgPSB1c2VNYXNrcyAmJiByZWxDdHguc2tpcENvbnRyb2xNYXNrOw0KICAgIGNvbnN0IGJpdCA9IHVzZU1hc2tzID8gKDEgPDwgcmVsQ3R4LnBpZWNlSW5kZXgpIDogMDsNCiAgICBpZiAoIXVzZU1hc2tzKSB7DQogICAgICAgIGluZm8ubW92ZXMgPSBbXTsNCiAgICAgICAgaW5mby5jb250cm9sID0gW107DQogICAgfQ0KICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsNCg0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgbGV0IHNjcmVlbkZvdW5kQ291bnQgPSAwOw0KICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMgJiYgc2NyZWVuRm91bmRDb3VudCA8IDIpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgIT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICBzY3JlZW5Gb3VuZENvdW50Kys7DQogICAgICAgICAgICAgICAgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDIpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBpZWNlQXRTcVtuciAqIDkgKyBuY107DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRJbmZvICYmIHRhcmdldEluZm8gIT09IGluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yICE9PSBwaWVjZUNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5hdHRhY2tNYXNrW25yICogOSArIG5jXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby50aHJlYXRlbmVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsQ3R4Lmd1YXJkTWFza1tuciAqIDkgKyBuY10gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocC5jb2xvciAhPT0gcGllY2VDb2xvcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF1c2VNYXNrcykgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMCkgew0KICAgICAgICAgICAgICAgIGlmICghdXNlTWFza3MpIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDEpIHsNCiAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBuciAqIDkgKyBuYzsNCiAgICAgICAgICAgICAgICAgICAgaWYgKCFza2lwQ29udHJvbCkgcmVsQ3R4LmNvbnRyb2xNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHJlbEN0eC5yZWRBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgaW5mby5jb250cm9sLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOw0KfTsNCg0KLy8g5LuO5qC85L2NIG1hc2sg6L+Y5Y6fIHRocmVhdC9ndWFyZC9jb250cm9sIOWIl+ihqO+8iOeCueajiy9VSe+8iQ0KLy8gU2VhcmNoIGxlYXZlcyBhbHdheXMgdXNlIG1hc2tzIGFuZCBhdHRhY2sgYml0cywgc28gdGhpcyBhdm9pZHMgVUkvY29udHJvbC1saXN0IGJyYW5jaGVzLg0KY29uc3QgYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUgPSAoc3F1YXJlQ29kZXMsIHNxLCBiaXQsIGlzUmVkKSA9PiB7DQogICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3NxXTsNCiAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChzY3JhdGNoUmVkQXR0YWNrLCBzcSk7DQogICAgICAgIGVsc2Ugc2V0QXR0YWNrQml0KHNjcmF0Y2hCbGFja0F0dGFjaywgc3EpOw0KICAgICAgICByZXR1cm4gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5LmJhc2VNb3ZlVmFsdWU7DQogICAgfQ0KICAgIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgew0KICAgICAgICBzY3JhdGNoQXR0YWNrTWFza1tzcV0gfD0gYml0Ow0KICAgIH0gZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgew0KICAgICAgICBzY3JhdGNoR3VhcmRNYXNrW3NxXSB8PSBiaXQ7DQogICAgfQ0KICAgIHJldHVybiAwOw0KfTsNCg0KY29uc3QgY2FsY3VsYXRlU2VhcmNoTGVhZlJlbGF0aW9ucyA9IChwaWVjZXNJbmZvLCBzcXVhcmVDb2RlcykgPT4gew0KICAgIHNjcmF0Y2hBdHRhY2tNYXNrLmZpbGwoMCk7DQogICAgc2NyYXRjaEd1YXJkTWFzay5maWxsKDApOw0KICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsNCiAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaEJsYWNrQXR0YWNrKTsNCg0KICAgIGNvbnN0IGJhc2VNb3ZlVmFsdWUgPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICBmb3IgKGxldCBwaSA9IDA7IHBpIDwgcGllY2VzSW5mby5sZW5ndGg7IHBpKyspIHsNCiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9bcGldOw0KICAgICAgICBjb25zdCByID0gaW5mby5yOw0KICAgICAgICBjb25zdCBjID0gaW5mby5jOw0KICAgICAgICBjb25zdCBmcm9tU3EgPSByICogOSArIGM7DQogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IGluZm8ucGllY2VDb2RlOw0KICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZUNvZGUgJiA3Ow0KICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlQ29kZSA8IDg7DQogICAgICAgIGNvbnN0IGNvbG9ySWR4ID0gaXNSZWQgPyAwIDogMTsNCiAgICAgICAgY29uc3QgYml0ID0gMSA8PCBwaTsNCiAgICAgICAgbGV0IG1vYmlsaXR5VmFsdWUgPSAwOw0KDQogICAgICAgIHN3aXRjaCAocGllY2VUeXBlKSB7DQogICAgICAgICAgICBjYXNlIDE6IHsNCiAgICAgICAgICAgICAgICBjb25zdCBkZXN0cyA9IEdFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVNlYXJjaExlYWZSZWxhdGlvblNxdWFyZShzcXVhcmVDb2RlcywgZC5yICogOSArIGQuYywgYml0LCBpc1JlZCk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgY2FzZSA1OiB7DQogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBBRFZJU09SX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUoc3F1YXJlQ29kZXMsIGQuciAqIDkgKyBkLmMsIGJpdCwgaXNSZWQpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGNhc2UgNDogew0KICAgICAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gRUxFUEhBTlRfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHNxdWFyZUNvZGVzW2QuYnIgKiA5ICsgZC5iY10gPT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUoc3F1YXJlQ29kZXMsIGQuciAqIDkgKyBkLmMsIGJpdCwgaXNSZWQpOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgY2FzZSAzOiB7DQogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBIT1JTRV9ERVNUW2Zyb21TcV07DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgICAgIGlmIChzcXVhcmVDb2Rlc1tkLmJyICogOSArIGQuYmNdID09PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5U2VhcmNoTGVhZlJlbGF0aW9uU3F1YXJlKHNxdWFyZUNvZGVzLCBkLnIgKiA5ICsgZC5jLCBiaXQsIGlzUmVkKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGNhc2UgMjoNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgICAgICAgICAgICAgIGxldCBuciA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IG5jID0gYyArIGRjOw0KICAgICAgICAgICAgICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gbnIgKiA5ICsgbmM7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbc3FdOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChzY3JhdGNoUmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQoc2NyYXRjaEJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHNjcmF0Y2hBdHRhY2tNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgc2NyYXRjaEd1YXJkTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICAgICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIGNhc2UgNjoNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgICAgICAgICAgICAgIGxldCBuciA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IG5jID0gYyArIGRjOw0KICAgICAgICAgICAgICAgICAgICBsZXQgc2NyZWVucyA9IDA7DQogICAgICAgICAgICAgICAgICAgIHdoaWxlIChuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUyAmJiBzY3JlZW5zIDwgMikgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBuciAqIDkgKyBuYzsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1tzcV07DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjcmVlbnMrKzsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2NyZWVucyA9PT0gMikgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHNjcmF0Y2hBdHRhY2tNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCh0YXJnZXRDb2RlICYgNykgIT09IDEpIHNjcmF0Y2hHdWFyZE1hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChzY3JlZW5zID09PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChzY3JhdGNoUmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQoc2NyYXRjaEJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICBuciArPSBkcjsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5jICs9IGRjOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgY2FzZSA3OiB7DQogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBTT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUoc3F1YXJlQ29kZXMsIGQuciAqIDkgKyBkLmMsIGJpdCwgaXNSZWQpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGRlZmF1bHQ6DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgaW5mby5tb2JpbGl0eVZhbHVlID0gbW9iaWxpdHlWYWx1ZTsNCiAgICB9DQp9Ow0KDQovLyBTZWFyY2gtb25seSByZWxhdGlvbiBidWlsZGVyLiBJdCBpcyBlcXVpdmFsZW50IHRvIGNhbGN1bGF0ZVNlYXJjaExlYWZSZWxhdGlvbnMsDQovLyBidXQgcmV1c2VzIHRoZSBwYWNrZWQgbW92ZSB0YWJsZXMgYW5kIHJheXMgYWxyZWFkeSB1c2VkIGJ5IHBzZXVkbyBtb3ZlIGdlbmVyYXRpb24uDQpjb25zdCBjYWxjdWxhdGVQYWNrZWRTZWFyY2hMZWFmUmVsYXRpb25zID0gKHBpZWNlc0luZm8sIHNxdWFyZUNvZGVzKSA9PiB7DQogICAgc2NyYXRjaEF0dGFja01hc2suZmlsbCgwKTsNCiAgICBzY3JhdGNoR3VhcmRNYXNrLmZpbGwoMCk7DQogICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOw0KICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOw0KDQogICAgY29uc3QgYmFzZU1vdmVWYWx1ZSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eS5iYXNlTW92ZVZhbHVlOw0KICAgIGNvbnN0IGF0dGFja01hc2sgPSBzY3JhdGNoQXR0YWNrTWFzazsNCiAgICBjb25zdCBndWFyZE1hc2sgPSBzY3JhdGNoR3VhcmRNYXNrOw0KICAgIGNvbnN0IHJlZEF0dGFjayA9IHNjcmF0Y2hSZWRBdHRhY2s7DQogICAgY29uc3QgYmxhY2tBdHRhY2sgPSBzY3JhdGNoQmxhY2tBdHRhY2s7DQoNCiAgICBmb3IgKGxldCBwaSA9IDA7IHBpIDwgcGllY2VzSW5mby5sZW5ndGg7IHBpKyspIHsKICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1twaV07CiAgICAgICAgLy8gU2xvdHMgYXJlIHJldXNlZCBiZXR3ZWVuIGxlYXZlcy4gQ2xlYXIgZGVyaXZlZCBzY29yZXMgd2hpbGUgYWxyZWFkeQogICAgICAgIC8vIHZpc2l0aW5nIGVhY2ggcGllY2UgdG8gYnVpbGQgaXRzIHBhY2tlZCBhdHRhY2sgYW5kIGd1YXJkIHJlbGF0aW9ucy4KICAgICAgICBpbmZvLnRocmVhdFZhbHVlID0gMDsKICAgICAgICBpbmZvLnNhZmV0eVZhbHVlID0gMDsKICAgICAgICBpbmZvLnRhY3RpY1ZhbHVlID0gMDsKICAgICAgICBjb25zdCBmcm9tU3EgPSBpbmZvLnNxOwogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IGluZm8ucGllY2VDb2RlOw0KICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZUNvZGUgJiA3Ow0KICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlQ29kZSA8IDg7DQogICAgICAgIGNvbnN0IGNvbG9ySWR4ID0gaXNSZWQgPyAwIDogMTsNCiAgICAgICAgY29uc3QgYml0ID0gMSA8PCBwaTsNCiAgICAgICAgY29uc3QgYXR0YWNrQml0cyA9IGlzUmVkID8gcmVkQXR0YWNrIDogYmxhY2tBdHRhY2s7DQogICAgICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsNCg0KICAgICAgICBzd2l0Y2ggKHBpZWNlVHlwZSkgew0KICAgICAgICAgICAgY2FzZSAxOg0KICAgICAgICAgICAgY2FzZSA1Og0KICAgICAgICAgICAgY2FzZSA3OiB7DQogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBwaWVjZVR5cGUgPT09IDENCiAgICAgICAgICAgICAgICAgICAgPyBTRUFSQ0hfR0VORVJBTF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdDQogICAgICAgICAgICAgICAgICAgIDogcGllY2VUeXBlID09PSA1DQogICAgICAgICAgICAgICAgICAgICAgICA/IFNFQVJDSF9BRFZJU09SX0RFU1RbY29sb3JJZHhdW2Zyb21TcV0NCiAgICAgICAgICAgICAgICAgICAgICAgIDogU0VBUkNIX1NPTERJRVJfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1tzcV07DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tCaXRzW3NxID4+PiA1XSB8PSAxIDw8IChzcSAmIDMxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCh0YXJnZXRDb2RlICYgNykgIT09IDEpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgY2FzZSA0Og0KICAgICAgICAgICAgY2FzZSAzOiB7DQogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBwaWVjZVR5cGUgPT09IDQNCiAgICAgICAgICAgICAgICAgICAgPyBTRUFSQ0hfRUxFUEhBTlRfREVTVFtjb2xvcklkeF1bZnJvbVNxXQ0KICAgICAgICAgICAgICAgICAgICA6IFNFQVJDSF9IT1JTRV9ERVNUW2Zyb21TcV07DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwYWNrZWQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHNxdWFyZUNvZGVzW3BhY2tlZCA+Pj4gN10gIT09IDApIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzcSA9IHBhY2tlZCAmIDEyNzsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3NxXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja0JpdHNbc3EgPj4+IDVdIHw9IDEgPDwgKHNxICYgMzEpOw0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBjYXNlIDI6DQogICAgICAgICAgICAgICAgZm9yIChsZXQgZGlyID0gMCwgcmF5SW5kZXggPSBmcm9tU3EgPDwgMjsgZGlyIDwgU0VBUkNIX1JBWV9ESVJTOyBkaXIrKywgcmF5SW5kZXgrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCByYXlFbmQgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXggKyAxXTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgcmF5UG9zID0gU0VBUkNIX1JBWV9PRkZTRVRTW3JheUluZGV4XTsgcmF5UG9zIDwgcmF5RW5kOyByYXlQb3MrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBTRUFSQ0hfUkFZX1NRVUFSRVNbcmF5UG9zXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1tzcV07DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja0JpdHNbc3EgPj4+IDVdIHw9IDEgPDwgKHNxICYgMzEpOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgYXR0YWNrTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgZ3VhcmRNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIGNhc2UgNjoNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBkaXIgPSAwLCByYXlJbmRleCA9IGZyb21TcSA8PCAyOyBkaXIgPCBTRUFSQ0hfUkFZX0RJUlM7IGRpcisrLCByYXlJbmRleCsrKSB7DQogICAgICAgICAgICAgICAgICAgIGxldCBzY3JlZW5Gb3VuZCA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCByYXlFbmQgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXggKyAxXTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgcmF5UG9zID0gU0VBUkNIX1JBWV9PRkZTRVRTW3JheUluZGV4XTsgcmF5UG9zIDwgcmF5RW5kOyByYXlQb3MrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBTRUFSQ0hfUkFZX1NRVUFSRVNbcmF5UG9zXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1tzcV07DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjcmVlbkZvdW5kID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldENvZGUgPT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tCaXRzW3NxID4+PiA1XSB8PSAxIDw8IChzcSAmIDMxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSBhdHRhY2tNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgZ3VhcmRNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICBkZWZhdWx0Og0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGluZm8ubW9iaWxpdHlWYWx1ZSA9IG1vYmlsaXR5VmFsdWU7DQogICAgfQ0KfTsNCg0KY29uc3QgaHlkcmF0ZVJlbGF0aW9uc0Zyb21NYXNrcyA9IChwaWVjZXNJbmZvLCBib2FyZEluZm8pID0+IHsNCiAgICBjb25zdCBhdHRhY2tNYXNrID0gYm9hcmRJbmZvLmF0dGFja01hc2s7DQogICAgY29uc3QgZ3VhcmRNYXNrID0gYm9hcmRJbmZvLmd1YXJkTWFzazsNCiAgICBjb25zdCBjb250cm9sTWFzayA9IGJvYXJkSW5mby5jb250cm9sTWFzazsNCiAgICBjb25zdCBuID0gcGllY2VzSW5mby5sZW5ndGg7DQogICAgY29uc3QgYnlTcSA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHsNCiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07DQogICAgICAgIGluZm8udGhyZWF0ID0gW107DQogICAgICAgIGluZm8udGhyZWF0ZW5lZEJ5ID0gW107DQogICAgICAgIGluZm8uZ3VhcmQgPSBbXTsNCiAgICAgICAgaW5mby5ndWFyZGVkQnkgPSBbXTsNCiAgICAgICAgaW5mby5jb250cm9sID0gW107DQogICAgICAgIGJ5U3FbaW5mby5yICogOSArIGluZm8uY10gPSBpbmZvOw0KICAgIH0NCg0KICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgew0KICAgICAgICBjb25zdCByID0gKHNxIC8gOSkgfCAwOw0KICAgICAgICBjb25zdCBjID0gc3EgJSA5Ow0KICAgICAgICBjb25zdCB0YXJnZXQgPSBieVNxW3NxXTsNCg0KICAgICAgICBsZXQgY20gPSBjb250cm9sTWFza1tzcV0gPj4+IDA7DQogICAgICAgIHdoaWxlIChjbSAhPT0gMCkgew0KICAgICAgICAgICAgY29uc3QgYml0ID0gY20gJiAtY207DQogICAgICAgICAgICBjb25zdCBpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7DQogICAgICAgICAgICBwaWVjZXNJbmZvW2ldLmNvbnRyb2wucHVzaCh7IHIsIGMgfSk7DQogICAgICAgICAgICBjbSBePSBiaXQ7DQogICAgICAgIH0NCg0KICAgICAgICBsZXQgYW0gPSBhdHRhY2tNYXNrW3NxXSA+Pj4gMDsNCiAgICAgICAgd2hpbGUgKGFtICE9PSAwKSB7DQogICAgICAgICAgICBjb25zdCBiaXQgPSBhbSAmIC1hbTsNCiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsNCiAgICAgICAgICAgIGNvbnN0IGF0dGFja2VyID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgICAgIGlmICh0YXJnZXQgJiYgdGFyZ2V0ICE9PSBhdHRhY2tlciAmJiB0YXJnZXQucGllY2UuY29sb3IgIT09IGF0dGFja2VyLnBpZWNlLmNvbG9yKSB7DQogICAgICAgICAgICAgICAgYXR0YWNrZXIudGhyZWF0LnB1c2godGFyZ2V0KTsNCiAgICAgICAgICAgICAgICB0YXJnZXQudGhyZWF0ZW5lZEJ5LnB1c2goYXR0YWNrZXIpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYW0gXj0gYml0Ow0KICAgICAgICB9DQoNCiAgICAgICAgbGV0IGdtID0gZ3VhcmRNYXNrW3NxXSA+Pj4gMDsNCiAgICAgICAgd2hpbGUgKGdtICE9PSAwKSB7DQogICAgICAgICAgICBjb25zdCBiaXQgPSBnbSAmIC1nbTsNCiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsNCiAgICAgICAgICAgIGNvbnN0IGd1YXJkZXIgPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICAgICAgaWYgKHRhcmdldCAmJiB0YXJnZXQgIT09IGd1YXJkZXIgJiYgdGFyZ2V0LnBpZWNlLmNvbG9yID09PSBndWFyZGVyLnBpZWNlLmNvbG9yKSB7DQogICAgICAgICAgICAgICAgZ3VhcmRlci5ndWFyZC5wdXNoKHRhcmdldCk7DQogICAgICAgICAgICAgICAgdGFyZ2V0Lmd1YXJkZWRCeS5wdXNoKGd1YXJkZXIpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZ20gXj0gYml0Ow0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5L6bIGlzUG9zaXRpb25BY2NlcHRhYmxlIC8g54K55qOLIGNvbnRyb2xsZXJz77ya5LiO5pen6K+t5LmJ5LiA6Ie077yM5LuF56m65o6n5qC8DQogICAgY29uc3QgZ3JpZCA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7DQogICAgZm9yIChsZXQgc3EgPSAwOyBzcSA8IFJFTF9TUVVBUkVTOyBzcSsrKSB7DQogICAgICAgIGxldCBjbSA9IGNvbnRyb2xNYXNrW3NxXSA+Pj4gMDsNCiAgICAgICAgaWYgKGNtID09PSAwKSBjb250aW51ZTsNCiAgICAgICAgY29uc3QgciA9IChzcSAvIDkpIHwgMDsNCiAgICAgICAgY29uc3QgYyA9IHNxICUgOTsNCiAgICAgICAgd2hpbGUgKGNtICE9PSAwKSB7DQogICAgICAgICAgICBjb25zdCBiaXQgPSBjbSAmIC1jbTsNCiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsNCiAgICAgICAgICAgIGdyaWRbcl1bY10ucHVzaChwaWVjZXNJbmZvW2ldKTsNCiAgICAgICAgICAgIGNtIF49IGJpdDsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBib2FyZEluZm8uY29udHJvbGxlckdyaWQgPSBncmlkOw0KfTsNCg0KLy8g6K6h566X5qOL5a2Q5YWz57O777yabWFzayDot6/lvoTlhpkgVWludDMyIOagvOS9jeihqO+8m+WIl+ihqOi3r+W+hOS/neaMgeaXpyBwdXNoDQpjb25zdCBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyA9IChib2FyZCwgcGllY2VzSW5mbywgYm9hcmRJbmZvKSA9PiB7DQogICAgY29uc3QgdXNlTWFza3MgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpOw0KICAgIGNvbnN0IHVzZUF0dGFja0JpdHMgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMpICYmICF1c2VNYXNrczsNCg0KICAgIGlmICghdXNlTWFza3MpIHsNCiAgICAgICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgICAgIGluZm8udGhyZWF0ID0gW107DQogICAgICAgICAgICBpbmZvLnRocmVhdGVuZWRCeSA9IFtdOw0KICAgICAgICAgICAgaW5mby5ndWFyZCA9IFtdOw0KICAgICAgICAgICAgaW5mby5ndWFyZGVkQnkgPSBbXTsNCiAgICAgICAgICAgIGluZm8uY29udHJvbCA9IFtdOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgaWYgKCFib2FyZEluZm8pIHsNCiAgICAgICAgYm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsNCiAgICB9DQoNCiAgICBjbGVhclBpZWNlQXRTcSgpOw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgaWYgKGluZm8ucGllY2VJbmRleCA9PSBudWxsKSBpbmZvLnBpZWNlSW5kZXggPSBpOw0KICAgICAgICBzY3JhdGNoUGllY2VBdFNxW2luZm8uciAqIDkgKyBpbmZvLmNdID0gaW5mbzsNCiAgICB9DQoNCiAgICBsZXQgcmVsQ3R4ID0gbnVsbDsNCiAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgcmVsQ3R4ID0gc2NyYXRjaFJlbEN0eDsNCiAgICAgICAgcmVsQ3R4LnVzZU1hc2tzID0gdHJ1ZTsNCiAgICAgICAgcmVsQ3R4LnNraXBDb250cm9sTWFzayA9ICEhYm9hcmRJbmZvLnNraXBDb250cm9sTWFzazsNCiAgICAgICAgcmVsQ3R4LmF0dGFja01hc2sgPSBib2FyZEluZm8uYXR0YWNrTWFzazsNCiAgICAgICAgcmVsQ3R4Lmd1YXJkTWFzayA9IGJvYXJkSW5mby5ndWFyZE1hc2s7DQogICAgICAgIHJlbEN0eC5jb250cm9sTWFzayA9IGJvYXJkSW5mby5jb250cm9sTWFzazsNCiAgICAgICAgcmVsQ3R4LnJlZEF0dGFjayA9IGJvYXJkSW5mby5yZWRBdHRhY2s7DQogICAgICAgIHJlbEN0eC5ibGFja0F0dGFjayA9IGJvYXJkSW5mby5ibGFja0F0dGFjazsNCiAgICB9DQoNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07DQogICAgICAgIGlmIChyZWxDdHgpIHJlbEN0eC5waWVjZUluZGV4ID0gaW5mby5waWVjZUluZGV4Ow0KDQogICAgICAgIGlmIChpbmZvLnBpZWNlLnR5cGUgPT09ICdjYW5ub24nKSB7DQogICAgICAgICAgICBmaWxsQ2Fubm9uUmVsYXRpb25zKGJvYXJkLCBpbmZvLCBzY3JhdGNoUGllY2VBdFNxLCByZWxDdHgpOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgZmlsbE5vbkNhbm5vblJlbGF0aW9ucyhib2FyZCwgaW5mbywgc2NyYXRjaFBpZWNlQXRTcSwgcmVsQ3R4KTsNCiAgICAgICAgfQ0KDQogICAgICAgIGlmICghdXNlTWFza3MpIHsNCiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2wgPSBpbmZvLmNvbnRyb2w7DQogICAgICAgICAgICBpZiAodXNlQXR0YWNrQml0cykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGJpdHMgPSBpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRBdHRhY2sgOiBib2FyZEluZm8uYmxhY2tBdHRhY2s7DQogICAgICAgICAgICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBjb250cm9sLmxlbmd0aDsgaysrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvcyA9IGNvbnRyb2xba107DQogICAgICAgICAgICAgICAgICAgIHNldEF0dGFja0JpdChiaXRzLCBwb3MuciAqIDkgKyBwb3MuYyk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGJvYXJkSW5mb1swXSkpIHsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBrID0gMDsgayA8IGNvbnRyb2wubGVuZ3RoOyBrKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zID0gY29udHJvbFtrXTsNCiAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvW3Bvcy5yXVtwb3MuY10ucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBsZXQgcmVkSXNJbkNoZWNrID0gZmFsc2U7DQogICAgbGV0IGJsYWNrSXNJbkNoZWNrID0gZmFsc2U7DQogICAgbGV0IHJlZEdlbmVyYWxJbmZvID0gbnVsbDsNCiAgICBsZXQgYmxhY2tHZW5lcmFsSW5mbyA9IG51bGw7DQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICBpZiAoaW5mby5waWVjZS5jb2xvciA9PT0gJ3JlZCcpIHJlZEdlbmVyYWxJbmZvID0gaW5mbzsNCiAgICAgICAgICAgIGVsc2UgYmxhY2tHZW5lcmFsSW5mbyA9IGluZm87DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgaWYgKHJlZEdlbmVyYWxJbmZvICYmIGJvYXJkSW5mby5hdHRhY2tNYXNrW3JlZEdlbmVyYWxJbmZvLnIgKiA5ICsgcmVkR2VuZXJhbEluZm8uY10gIT09IDApIHsNCiAgICAgICAgICAgIHJlZElzSW5DaGVjayA9IHRydWU7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGJsYWNrR2VuZXJhbEluZm8gJiYgYm9hcmRJbmZvLmF0dGFja01hc2tbYmxhY2tHZW5lcmFsSW5mby5yICogOSArIGJsYWNrR2VuZXJhbEluZm8uY10gIT09IDApIHsNCiAgICAgICAgICAgIGJsYWNrSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0gZWxzZSB7DQogICAgICAgIGlmIChyZWRHZW5lcmFsSW5mbykgew0KICAgICAgICAgICAgZm9yIChjb25zdCB0aHJlYXRlbmVyIG9mIHJlZEdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgew0KICAgICAgICAgICAgICAgIGlmICh0aHJlYXRlbmVyLnBpZWNlLmNvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgIHJlZElzSW5DaGVjayA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoYmxhY2tHZW5lcmFsSW5mbykgew0KICAgICAgICAgICAgZm9yIChjb25zdCB0aHJlYXRlbmVyIG9mIGJsYWNrR2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7DQogICAgICAgICAgICAgICAgaWYgKHRocmVhdGVuZXIucGllY2UuY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICAgICAgICAgIGJsYWNrSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgaWYgKHJlZEdlbmVyYWxJbmZvICYmIGJsYWNrR2VuZXJhbEluZm8gJiYgcmVkR2VuZXJhbEluZm8uYyA9PT0gYmxhY2tHZW5lcmFsSW5mby5jKSB7DQogICAgICAgIGxldCBoYXNQaWVjZUJldHdlZW4gPSBmYWxzZTsNCiAgICAgICAgY29uc3Qgc3RhcnRSID0gTWF0aC5taW4ocmVkR2VuZXJhbEluZm8uciwgYmxhY2tHZW5lcmFsSW5mby5yKSArIDE7DQogICAgICAgIGNvbnN0IGVuZFIgPSBNYXRoLm1heChyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpIC0gMTsNCiAgICAgICAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtyXVtyZWRHZW5lcmFsSW5mby5jXSkgew0KICAgICAgICAgICAgICAgIGhhc1BpZWNlQmV0d2VlbiA9IHRydWU7DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKCFoYXNQaWVjZUJldHdlZW4pIHsNCiAgICAgICAgICAgIHJlZElzSW5DaGVjayA9IHRydWU7DQogICAgICAgICAgICBibGFja0lzSW5DaGVjayA9IHRydWU7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBib2FyZEluZm8ucmVkSXNJbkNoZWNrID0gcmVkSXNJbkNoZWNrOw0KICAgIGJvYXJkSW5mby5ibGFja0lzSW5DaGVjayA9IGJsYWNrSXNJbkNoZWNrOw0KfTsNCg0KY29uc3QgaXNQb3NpdGlvbkFjY2VwdGFibGUgPSAoYm9hcmQsIGZyb20sIHRvLCBjdXJyZW50UGxheWVyLCBib2FyZEluZm8gPSBudWxsLCBwaWVjZXNJbmZvID0gbnVsbCwgdHJ5TW92ZVBpZWNlID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcpID0+IHsNCiAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IHRyeU1vdmVQaWVjZSB8fCBib2FyZFtmcm9tLnJdW2Zyb20uY107DQogICAgY29uc3QgdGFyZ2V0UGllY2UgPSBib2FyZFt0by5yXVt0by5jXTsNCiAgICBjb25zdCBpc0NhcHR1cmUgPSB0YXJnZXRQaWVjZSAmJiB0YXJnZXRQaWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcjsNCg0KICAgIC8vIOaUtumbhuaJgOacieaji+WtkOS/oeaBr++8jOWPquWcqOayoeacieaPkOS+m+aXtuiuoeeulw0KICAgIGxldCBsb2NhbFBpZWNlc0luZm8gPSBwaWVjZXNJbmZvOw0KICAgIGlmICghbG9jYWxQaWVjZXNJbmZvKSB7DQogICAgICAgIGxvY2FsUGllY2VzSW5mbyA9IFtdOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBhbGx5R3VhcmRzID0gW107DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlLCBhbGx5R3VhcmRzKTsNCiAgICAgICAgICAgICAgICAgICAgbG9jYWxQaWVjZXNJbmZvLnB1c2goew0KICAgICAgICAgICAgICAgICAgICAgICAgcGllY2UsDQogICAgICAgICAgICAgICAgICAgICAgICByLCBjLCBtb3ZlcywgYWxseUd1YXJkcywNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsVmFsdWU6IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSksDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkOiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkZWRCeTogW10sDQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpY1ZhbHVlOiAwDQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOiuoeeul+aji+WtkOWFs+ezu+WSjOaOp+WItuS/oeaBr++8jOWPquWcqOayoeacieaPkOS+m+aXtuiuoeeulw0KICAgIGxldCBsb2NhbEJvYXJkSW5mbyA9IGJvYXJkSW5mbzsNCiAgICBpZiAoIWxvY2FsQm9hcmRJbmZvKSB7DQogICAgICAgIGlmIChsb2NhbFBpZWNlc0luZm8ubGVuZ3RoIDw9IDMyKSB7DQogICAgICAgICAgICBjbGVhclJlbGF0aW9uTWFza3MoKTsNCiAgICAgICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsNCiAgICAgICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsb2NhbFBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBsb2NhbFBpZWNlc0luZm9baV0ucGllY2VJbmRleCA9IGk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBsb2NhbEJvYXJkSW5mbyA9IHsNCiAgICAgICAgICAgICAgICB1c2VSZWxhdGlvbk1hc2tzOiB0cnVlLA0KICAgICAgICAgICAgICAgIHVzZUF0dGFja0JpdHM6IHRydWUsDQogICAgICAgICAgICAgICAgYXR0YWNrTWFzazogc2NyYXRjaEF0dGFja01hc2ssDQogICAgICAgICAgICAgICAgZ3VhcmRNYXNrOiBzY3JhdGNoR3VhcmRNYXNrLA0KICAgICAgICAgICAgICAgIGNvbnRyb2xNYXNrOiBzY3JhdGNoQ29udHJvbE1hc2ssDQogICAgICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgICAgICAgICAgICAgIGJsYWNrQXR0YWNrOiBzY3JhdGNoQmxhY2tBdHRhY2sNCiAgICAgICAgICAgIH07DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBsb2NhbEJvYXJkSW5mbyA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7DQogICAgICAgIH0NCiAgICAgICAgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMoYm9hcmQsIGxvY2FsUGllY2VzSW5mbywgbG9jYWxCb2FyZEluZm8pOw0KICAgIH0NCg0KICAgIC8vIOaOp+WItuiAhe+8mm1hc2sg55SoIGNvbnRyb2xNYXNr77yb5pen6Lev5b6E55SoIGJvYXJkSW5mb1tyXVtjXe+8m2h5ZHJhdGUg5ZCO5Y+v55SoIGNvbnRyb2xsZXJHcmlkDQogICAgbGV0IGNvbnRyb2xsZXJzOw0KICAgIGlmIChsb2NhbEJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKSB7DQogICAgICAgIGNvbnRyb2xsZXJzID0gW107DQogICAgICAgIGZvckVhY2hTZXRCaXQobG9jYWxCb2FyZEluZm8uY29udHJvbE1hc2tbdG8uciAqIDkgKyB0by5jXSwgKGkpID0+IHsNCiAgICAgICAgICAgIGNvbnRyb2xsZXJzLnB1c2gobG9jYWxQaWVjZXNJbmZvW2ldKTsNCiAgICAgICAgfSk7DQogICAgfSBlbHNlIGlmIChsb2NhbEJvYXJkSW5mby5jb250cm9sbGVyR3JpZCkgew0KICAgICAgICBjb250cm9sbGVycyA9IGxvY2FsQm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkW3RvLnJdW3RvLmNdIHx8IFtdOw0KICAgIH0gZWxzZSB7DQogICAgICAgIGNvbnRyb2xsZXJzID0gbG9jYWxCb2FyZEluZm9bdG8ucl1bdG8uY10gfHwgW107DQogICAgfQ0KICAgIGxldCBoYXNBbGx5Q29udHJvbGxlciA9IGZhbHNlOw0KICAgIGxldCBoYXNFbmVteUNvbnRyb2xsZXIgPSBmYWxzZTsNCg0KICAgIC8vIOaOp+WItuiAheWPr+iDveaYryBwaWVjZXNJbmZvIOW8leeUqCB7cGllY2UscixjfSDmiJbml6fnu5PmnoQge2NvbG9yLHR5cGUscixjfQ0KICAgIGNvbnN0IGNvbnRyb2xsZXJDb2xvciA9IChjb250cm9sbGVyKSA9Pg0KICAgICAgICBjb250cm9sbGVyLnBpZWNlID8gY29udHJvbGxlci5waWVjZS5jb2xvciA6IGNvbnRyb2xsZXIuY29sb3I7DQoNCiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgY29udHJvbGxlcnMpIHsNCiAgICAgICAgLy8g5o6S6Zmk5q2j5Zyo56e75Yqo55qE5qOL5a2Q5pys6Lqr77yI6LWw5ZCO5a6D5LiN5YaN5LuO5Y6f5L2N5o6n5Yi255uu5qCH77yJDQogICAgICAgIGlmIChtb3ZpbmdQaWVjZSAmJiBjb250cm9sbGVyLnIgPT09IGZyb20uciAmJiBjb250cm9sbGVyLmMgPT09IGZyb20uYykgew0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGNvbnRyb2xsZXJDb2xvcihjb250cm9sbGVyKSA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgaGFzQWxseUNvbnRyb2xsZXIgPSB0cnVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaGFzRW5lbXlDb250cm9sbGVyID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGlmIChpc0NhcHR1cmUpIHsNCiAgICAgICAgLy8g55m95ZCD77ya55uu5qCH5pyq6KKr5pWM5pa55L+d5oqkDQogICAgICAgIGlmICghaGFzRW5lbXlDb250cm9sbGVyKSB7DQogICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgfQ0KICAgICAgICAvLyDnroDljZUgU0VF77ya5YWI5b6X55uu5qCH5YiG77yM6Iul5Lya6KKr5Y+N5ZCD5YiZ5YaN5aSx5bex5pa55qOL5a2QDQogICAgICAgIGNvbnN0IHRhcmdldFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZSh0YXJnZXRQaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgY29uc3Qgb3VyVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKG1vdmluZ1BpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICBsZXQgc2VlID0gdGFyZ2V0VmFsdWUgLSBvdXJWYWx1ZTsNCiAgICAgICAgLy8g6Iul5pyJ5bex5pa557un57ut5L+d5oqk77yM57KX55Wl6K6k5Li65Y+v6IO95YaN5ZCD5Zue5pyA5L2O5Lu35YC855qE5pWM5pa55L+d5oqk6ICFDQogICAgICAgIGlmIChoYXNBbGx5Q29udHJvbGxlcikgew0KICAgICAgICAgICAgY29uc3QgZW5lbXlHdWFyZFZhbHVlcyA9IGNvbnRyb2xsZXJzDQogICAgICAgICAgICAgICAgLmZpbHRlcihjID0+IGNvbnRyb2xsZXJDb2xvcihjKSAhPT0gY3VycmVudFBsYXllciAmJiAhKGMuciA9PT0gZnJvbS5yICYmIGMuYyA9PT0gZnJvbS5jKSkNCiAgICAgICAgICAgICAgICAubWFwKGMgPT4gew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbYy5yXVtjLmNdOw0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gcCA/IGdldE1hdGVyaWFsVmFsdWUocCwgZ2FtZVN0YWdlKSA6IDA7DQogICAgICAgICAgICAgICAgfSkNCiAgICAgICAgICAgICAgICAuZmlsdGVyKHYgPT4gdiA+IDApDQogICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IGEgLSBiKTsNCiAgICAgICAgICAgIGlmIChlbmVteUd1YXJkVmFsdWVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICBzZWUgKz0gZW5lbXlHdWFyZFZhbHVlc1swXTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICAvLyDmmI7mmL7kuo/mjaLvvIjlpoLovabmjaLml6DmoLnlhbXkuJTkvJrooqvlj43lkIPvvInliJnov4fmu6TvvJvlubPmjaIv6LWa5o2i55WZ57uZ5pCc57SiDQogICAgICAgIHJldHVybiBzZWUgPj0gMDsNCiAgICB9DQoNCiAgICAvLyDpnZ7lkIPlrZDvvJrnm67moIfku4XooqvmlYzmlrnmjqfliLbliJnop4bkuLrpgIHlkIMNCiAgICBpZiAoY29udHJvbGxlcnMubGVuZ3RoID09PSAwKSB7DQogICAgICAgIHJldHVybiB0cnVlOw0KICAgIH0NCiAgICByZXR1cm4gIWhhc0VuZW15Q29udHJvbGxlciB8fCBoYXNBbGx5Q29udHJvbGxlcjsNCn07DQoNCi8vIFNFRSDmjpLluo/lpI3nlKjnvJPlhrLvvIzpmY3kvY7lj7bor4TkvLAgR0MKY29uc3Qgc2VlQXR0YWNrZXJTY3JhdGNoID0gW107CmNvbnN0IHNlZUd1YXJkU2NyYXRjaCA9IFtdOwpjb25zdCBzZWVBdHRhY2tlclR5cGVDb3VudHMgPSBuZXcgVWludDhBcnJheSg4KTsKY29uc3Qgc2VlR3VhcmRUeXBlQ291bnRzID0gbmV3IFVpbnQ4QXJyYXkoOCk7CmNvbnN0IHNlZU1hdGVyaWFsQnlUeXBlID0gbmV3IEludDMyQXJyYXkoOCk7Cgpjb25zdCB0YWtlTG93ZXN0U2VlTWF0ZXJpYWwgPSAoY291bnRzLCBtYXRlcmlhbEJ5VHlwZSkgPT4gewogICAgbGV0IGJlc3RUeXBlID0gMDsKICAgIGxldCBiZXN0VmFsdWUgPSBJbmZpbml0eTsKICAgIGZvciAobGV0IHR5cGUgPSAxOyB0eXBlIDwgY291bnRzLmxlbmd0aDsgdHlwZSsrKSB7CiAgICAgICAgaWYgKGNvdW50c1t0eXBlXSAhPT0gMCAmJiBtYXRlcmlhbEJ5VHlwZVt0eXBlXSA8IGJlc3RWYWx1ZSkgewogICAgICAgICAgICBiZXN0VHlwZSA9IHR5cGU7CiAgICAgICAgICAgIGJlc3RWYWx1ZSA9IG1hdGVyaWFsQnlUeXBlW3R5cGVdOwogICAgICAgIH0KICAgIH0KICAgIGlmIChiZXN0VHlwZSAhPT0gMCkgY291bnRzW2Jlc3RUeXBlXS0tOwogICAgcmV0dXJuIGJlc3RWYWx1ZTsKfTsKCmNvbnN0IGhhc0FueVNlZU1hdGVyaWFsID0gKGNvdW50cykgPT4gewogICAgZm9yIChsZXQgdHlwZSA9IDE7IHR5cGUgPCBjb3VudHMubGVuZ3RoOyB0eXBlKyspIHsKICAgICAgICBpZiAoY291bnRzW3R5cGVdICE9PSAwKSByZXR1cm4gdHJ1ZTsKICAgIH0KICAgIHJldHVybiBmYWxzZTsKfTsKDQovLyDmnInmoLnlrZDnroDljJYgU0VF77yI5LiO5pen5a6e546w6YCQ6KGM562J5Lu377yJ77yb5q+P5Liq55uu5qCH5Y+q5bqU6LCD55So5LiA5qyhDQpjb25zdCBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlID0gKHRocmVhdGVuZWRQaWVjZSkgPT4gew0KICAgIGNvbnN0IGF0dGFja2VycyA9IHNlZUF0dGFja2VyU2NyYXRjaDsNCiAgICBjb25zdCBndWFyZHMgPSBzZWVHdWFyZFNjcmF0Y2g7DQogICAgYXR0YWNrZXJzLmxlbmd0aCA9IDA7DQogICAgZ3VhcmRzLmxlbmd0aCA9IDA7DQogICAgY29uc3QgcmF3QXR0YWNrZXJzID0gdGhyZWF0ZW5lZFBpZWNlLnRocmVhdGVuZWRCeTsNCiAgICBjb25zdCByYXdHdWFyZHMgPSB0aHJlYXRlbmVkUGllY2UuZ3VhcmRlZEJ5Ow0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF3QXR0YWNrZXJzLmxlbmd0aDsgaSsrKSBhdHRhY2tlcnMucHVzaChyYXdBdHRhY2tlcnNbaV0pOw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF3R3VhcmRzLmxlbmd0aDsgaSsrKSBndWFyZHMucHVzaChyYXdHdWFyZHNbaV0pOw0KICAgIGF0dGFja2Vycy5zb3J0KChhLCBiKSA9PiBhLm1hdGVyaWFsVmFsdWUgLSBiLm1hdGVyaWFsVmFsdWUpOw0KICAgIGd1YXJkcy5zb3J0KChhLCBiKSA9PiBhLm1hdGVyaWFsVmFsdWUgLSBiLm1hdGVyaWFsVmFsdWUpOw0KDQogICAgbGV0IGV4Y2hhbmdlU2NvcmUgPSAwOw0KICAgIGxldCBhdHRhY2tlckluZGV4ID0gMDsNCiAgICBsZXQgZ3VhcmRJbmRleCA9IDA7DQogICAgY29uc3QgdGFyZ2V0VmFsdWUgPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsNCg0KICAgIHdoaWxlIChhdHRhY2tlckluZGV4IDwgYXR0YWNrZXJzLmxlbmd0aCAmJiBndWFyZEluZGV4IDwgZ3VhcmRzLmxlbmd0aCkgew0KICAgICAgICBpZiAoZ3VhcmRJbmRleCA9PT0gMCkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSB0YXJnZXRWYWx1ZTsNCiAgICAgICAgfQ0KICAgICAgICBleGNoYW5nZVNjb3JlIC09IGF0dGFja2Vyc1thdHRhY2tlckluZGV4XS5tYXRlcmlhbFZhbHVlOw0KICAgICAgICBpZiAoYXR0YWNrZXJJbmRleCArIDEgPCBhdHRhY2tlcnMubGVuZ3RoKSB7DQogICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IGd1YXJkc1tndWFyZEluZGV4XS5tYXRlcmlhbFZhbHVlOw0KICAgICAgICB9DQogICAgICAgIGF0dGFja2VySW5kZXgrKzsNCiAgICAgICAgZ3VhcmRJbmRleCsrOw0KICAgIH0NCiAgICByZXR1cm4gZXhjaGFuZ2VTY29yZTsNCn07DQoNCi8vIG1hc2sg6Lev5b6EIFNFRe+8muaMieaji+WtkOexu+WIq+iuoeaVsO+8jOaMieadkOaWmeWAvOa2iOi0ue+8m+S4juadkOaWmeaVsOe7hOaOkuW6j+ivreS5ieS4gOiHtOOAggpjb25zdCBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlRnJvbU1hc2tzID0gKHRocmVhdGVuZWRQaWVjZSwgcGllY2VzSW5mbywgYXR0YWNrTWFzaywgZ3VhcmRNYXNrKSA9PiB7CiAgICBjb25zdCBhdHRhY2tlckNvdW50cyA9IHNlZUF0dGFja2VyVHlwZUNvdW50czsKICAgIGNvbnN0IGd1YXJkQ291bnRzID0gc2VlR3VhcmRUeXBlQ291bnRzOwogICAgYXR0YWNrZXJDb3VudHMuZmlsbCgwKTsKICAgIGd1YXJkQ291bnRzLmZpbGwoMCk7CiAgICBzZWVNYXRlcmlhbEJ5VHlwZS5maWxsKDApOwogICAgY29uc3Qgc3EgPSB0aHJlYXRlbmVkUGllY2Uuc3EgPT0gbnVsbAogICAgICAgID8gdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmMKICAgICAgICA6IHRocmVhdGVuZWRQaWVjZS5zcTsKICAgIGxldCBhbSA9IGF0dGFja01hc2tbc3FdID4+PiAwOwogICAgd2hpbGUgKGFtICE9PSAwKSB7CiAgICAgICAgY29uc3QgYml0ID0gYW0gJiAtYW07CiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9bMzEgLSBNYXRoLmNsejMyKGJpdCldOwogICAgICAgIGNvbnN0IHR5cGUgPSBpbmZvLnBpZWNlQ29kZSAmIDc7CiAgICAgICAgYXR0YWNrZXJDb3VudHNbdHlwZV0rKzsKICAgICAgICBzZWVNYXRlcmlhbEJ5VHlwZVt0eXBlXSA9IGluZm8ubWF0ZXJpYWxWYWx1ZTsKICAgICAgICBhbSBePSBiaXQ7CiAgICB9CiAgICBsZXQgZ20gPSBndWFyZE1hc2tbc3FdID4+PiAwOwogICAgd2hpbGUgKGdtICE9PSAwKSB7CiAgICAgICAgY29uc3QgYml0ID0gZ20gJiAtZ207CiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9bMzEgLSBNYXRoLmNsejMyKGJpdCldOwogICAgICAgIGNvbnN0IHR5cGUgPSBpbmZvLnBpZWNlQ29kZSAmIDc7CiAgICAgICAgZ3VhcmRDb3VudHNbdHlwZV0rKzsKICAgICAgICBzZWVNYXRlcmlhbEJ5VHlwZVt0eXBlXSA9IGluZm8ubWF0ZXJpYWxWYWx1ZTsKICAgICAgICBnbSBePSBiaXQ7CiAgICB9CgogICAgbGV0IGV4Y2hhbmdlU2NvcmUgPSAwOwogICAgbGV0IGlzRmlyc3RFeGNoYW5nZSA9IHRydWU7CiAgICBjb25zdCB0YXJnZXRWYWx1ZSA9IHRocmVhdGVuZWRQaWVjZS5tYXRlcmlhbFZhbHVlOwoKICAgIHdoaWxlICh0cnVlKSB7CiAgICAgICAgY29uc3QgYXR0YWNrZXJWYWx1ZSA9IHRha2VMb3dlc3RTZWVNYXRlcmlhbChhdHRhY2tlckNvdW50cywgc2VlTWF0ZXJpYWxCeVR5cGUpOwogICAgICAgIGNvbnN0IGd1YXJkVmFsdWUgPSB0YWtlTG93ZXN0U2VlTWF0ZXJpYWwoZ3VhcmRDb3VudHMsIHNlZU1hdGVyaWFsQnlUeXBlKTsKICAgICAgICBpZiAoYXR0YWNrZXJWYWx1ZSA9PT0gSW5maW5pdHkgfHwgZ3VhcmRWYWx1ZSA9PT0gSW5maW5pdHkpIGJyZWFrOwogICAgICAgIGlmIChpc0ZpcnN0RXhjaGFuZ2UpIHsKICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSB0YXJnZXRWYWx1ZTsKICAgICAgICAgICAgaXNGaXJzdEV4Y2hhbmdlID0gZmFsc2U7CiAgICAgICAgfQogICAgICAgIGV4Y2hhbmdlU2NvcmUgLT0gYXR0YWNrZXJWYWx1ZTsKICAgICAgICBpZiAoaGFzQW55U2VlTWF0ZXJpYWwoYXR0YWNrZXJDb3VudHMpKSB7CiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gZ3VhcmRWYWx1ZTsKICAgICAgICB9CiAgICB9CiAgICByZXR1cm4gZXhjaGFuZ2VTY29yZTsKfTsKDQovLyDorqHnrpflqIHog4HlgLzvvIjln7rkuo7lrozmlbTnmoTlqIHog4HlhbPns7vvvIkNCi8vIOaMieiiq+WogeiDgeWtkOiBmuWQiO+8muavj+S4quebruagh+acgOWkmuS4gOasoSBTRUXvvJvliIblgLzliqDnu5kgdGhyZWF0ZW5lZEJ5WzBdDQovLyDvvIjlhbPns7vmnoTlu7rmjIkgcGllY2VzSW5mbyDpobrluo8gcHVzaO+8jOaVheS4juaXp+KAnOaUu+WHu+aWueWkluWxgumBjeWOhummluasoeiuoeWIhuKAneW9kuWxnuS4gOiHtO+8iQ0KY29uc3QgY2FsY3VsYXRlVGhyZWF0VmFsdWVzID0gKHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbyA9IG51bGwsIGZvclNlYXJjaExlYWYgPSBmYWxzZSkgPT4gew0KICAgIC8vIOe7n+iuoQ0KICAgIGlmIChjdXJyZW50UGxheWVyKSB7DQogICAgICAgIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudFtjdXJyZW50UGxheWVyXSsrOw0KICAgIH0NCg0KICAgIC8vIOWIneWni+WMluWogeiDgeexu+Wei+e7n+iuoeS/oeaBrw0KICAgIGNvbnN0IGNvbGxlY3RVaSA9ICEhYm9hcmRJbmZvICYmICFmb3JTZWFyY2hMZWFmOw0KICAgIGlmIChjb2xsZWN0VWkpIHsNCiAgICAgICAgYm9hcmRJbmZvLmNoZWNrcyA9IFtdOyAgICAgIC8vIOWwhuWGm+S/oeaBrw0KICAgICAgICBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyA9IFtdOyAgLy8g6KKr5o2J55qE5qOL5a2QDQogICAgICAgIGJvYXJkSW5mby5jYW5DYXB0dXJlID0gW107ICAvLyDlj6/lkIPnmoTmo4vlrZANCiAgICB9DQoNCiAgICBjb25zdCBjaGVja0JvbnVzID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmNoZWNrLmJvbnVzOw0KICAgIGNvbnN0IGNhbkNhcHR1cmVTZWVuID0gY29sbGVjdFVpID8gbmV3IFNldCgpIDogbnVsbDsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcyk7DQogICAgY29uc3QgYXR0YWNrTWFzayA9IHVzZU1hc2tzID8gYm9hcmRJbmZvLmF0dGFja01hc2sgOiBudWxsOw0KICAgIGNvbnN0IGd1YXJkTWFzayA9IHVzZU1hc2tzID8gYm9hcmRJbmZvLmd1YXJkTWFzayA6IG51bGw7DQoNCiAgICBmb3IgKGxldCB0aSA9IDA7IHRpIDwgcGllY2VzSW5mby5sZW5ndGg7IHRpKyspIHsNCiAgICAgICAgY29uc3QgdGhyZWF0ZW5lZFBpZWNlID0gcGllY2VzSW5mb1t0aV07DQogICAgICAgIGxldCBmaXJzdEF0dGFja2VyOw0KICAgICAgICBsZXQgaGFzR3VhcmQ7DQogICAgICAgIGxldCBhdHRhY2tlckxpc3QgPSBudWxsOw0KDQogICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgY29uc3Qgc3EgPSB0aHJlYXRlbmVkUGllY2UuciAqIDkgKyB0aHJlYXRlbmVkUGllY2UuYzsNCiAgICAgICAgICAgIGNvbnN0IGFtID0gYXR0YWNrTWFza1tzcV07DQogICAgICAgICAgICBpZiAoYW0gPT09IDApIGNvbnRpbnVlOw0KICAgICAgICAgICAgLy8g5pyA5L2OIGJpdCA9IHBpZWNlc0luZm8g6aG65bqP5LiL5pyA5YWI5oyC5LiK55qE5pS75Ye75pa577yI5LiO5penIHRocmVhdGVuZWRCeVswXSDkuIDoh7TvvIkNCiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIgPSBwaWVjZXNJbmZvW2xvd2VzdFNldEJpdEluZGV4KGFtKV07DQogICAgICAgICAgICBoYXNHdWFyZCA9IGd1YXJkTWFza1tzcV0gIT09IDA7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBjb25zdCBhdHRhY2tlcnMgPSB0aHJlYXRlbmVkUGllY2UudGhyZWF0ZW5lZEJ5Ow0KICAgICAgICAgICAgaWYgKCFhdHRhY2tlcnMgfHwgYXR0YWNrZXJzLmxlbmd0aCA9PT0gMCkgY29udGludWU7DQogICAgICAgICAgICBmaXJzdEF0dGFja2VyID0gYXR0YWNrZXJzWzBdOw0KICAgICAgICAgICAgaGFzR3VhcmQgPSB0aHJlYXRlbmVkUGllY2UuZ3VhcmRlZEJ5ICYmIHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnkubGVuZ3RoID4gMDsNCiAgICAgICAgICAgIGF0dGFja2VyTGlzdCA9IGF0dGFja2VyczsNCiAgICAgICAgfQ0KDQogICAgICAgIC8vIOWwhuWGm++8muWPque7meWwj+mineWFiOaJi+WIhu+8jOe7neS4jeaMieWwhi/luIXmnZDmlpnlgLzlgZogU0VFDQogICAgICAgIGlmICh0aHJlYXRlbmVkUGllY2UucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgew0KICAgICAgICAgICAgaWYgKGNvbGxlY3RVaSkgew0KICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICBsZXQgbSA9IGF0dGFja01hc2tbdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmNdID4+PiAwOw0KICAgICAgICAgICAgICAgICAgICB3aGlsZSAobSAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYml0ID0gbSAmIC1tOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jaGVja3MucHVzaCh7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrZXI6IHBpZWNlc0luZm9bYWldLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldDogdGhyZWF0ZW5lZFBpZWNlLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQ2hlY2s6IHRydWUNCiAgICAgICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgbSBePSBiaXQ7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBhaSA9IDA7IGFpIDwgYXR0YWNrZXJMaXN0Lmxlbmd0aDsgYWkrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNoZWNrcy5wdXNoKHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tlcjogYXR0YWNrZXJMaXN0W2FpXSwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHRocmVhdGVuZWRQaWVjZSwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0NoZWNrOiB0cnVlDQogICAgICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gY2hlY2tCb251czsNCiAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICB9DQoNCiAgICAgICAgLy8g5Y+q5oqK5a+55pS75Ye75pa55pyJ5Yip55qE5aiB6IOB6K6h5YWlIHRocmVhdFZhbHVl77yI5Y2V5ZCR6K6h5YWl77yM5LiN5YGaIHNhZmV0eSDlr7nnp7DmiaPliIbvvIkNCiAgICAgICAgaWYgKCFoYXNHdWFyZCkgew0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgIGlmIChjb2xsZWN0VWkpIHsNCiAgICAgICAgICAgICAgICBpZiAoZmlyc3RBdHRhY2tlci5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGxldCBtID0gYXR0YWNrTWFza1t0aHJlYXRlbmVkUGllY2UuciAqIDkgKyB0aHJlYXRlbmVkUGllY2UuY10gPj4+IDA7DQogICAgICAgICAgICAgICAgICAgICAgICB3aGlsZSAobSAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJpdCA9IG0gJiAtbTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV07DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5DYXB0dXJlU2Vlbi5oYXMoaW5mbykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FuQ2FwdHVyZVNlZW4uYWRkKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2FuQ2FwdHVyZS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtIF49IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGFpID0gMDsgYWkgPCBhdHRhY2tlckxpc3QubGVuZ3RoOyBhaSsrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGF0dGFja2VyTGlzdFthaV07DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5DYXB0dXJlU2Vlbi5oYXMoaW5mbykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FuQ2FwdHVyZVNlZW4uYWRkKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2FuQ2FwdHVyZS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLnB1c2godGhyZWF0ZW5lZFBpZWNlKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBjb25zdCBzc2VTY29yZSA9IHVzZU1hc2tzDQogICAgICAgICAgICAgICAgPyBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlRnJvbU1hc2tzKHRocmVhdGVuZWRQaWVjZSwgcGllY2VzSW5mbywgYXR0YWNrTWFzaywgZ3VhcmRNYXNrKQ0KICAgICAgICAgICAgICAgIDogY2FsY3VsYXRlU3RhdGljRXhjaGFuZ2VTY29yZSh0aHJlYXRlbmVkUGllY2UpOw0KICAgICAgICAgICAgaWYgKHNzZVNjb3JlID4gMCkgew0KICAgICAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gc3NlU2NvcmUgKiAwLjU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQp9Ow0KDQovLyBTZWFyY2ggbGVhdmVzIG5ldmVyIGNvbnN0cnVjdCBVSSByZWxhdGlvbiBsaXN0cy4gVGhpcyBwYXRoIGNvbnN1bWVzIG9ubHkNCi8vIHBpZWNlQ29kZS9zcSBhbmQgdGhlIG1hc2tzIGVtaXR0ZWQgYnkgdGhlIG51bWVyaWMgcmVsYXRpb24gYnVpbGRlci4NCmNvbnN0IGNhbGN1bGF0ZU51bWVyaWNTZWFyY2hMZWFmVGhyZWF0VmFsdWVzID0gKHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIpID0+IHsNCiAgICBpZiAoY3VycmVudFBsYXllcikgew0KICAgICAgICBwZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnRbY3VycmVudFBsYXllcl0rKzsNCiAgICB9DQoNCiAgICBjb25zdCBjaGVja0JvbnVzID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmNoZWNrLmJvbnVzOw0KICAgIGZvciAobGV0IHRpID0gMDsgdGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgdGkrKykgew0KICAgICAgICBjb25zdCB0aHJlYXRlbmVkUGllY2UgPSBwaWVjZXNJbmZvW3RpXTsNCiAgICAgICAgY29uc3Qgc3EgPSB0aHJlYXRlbmVkUGllY2Uuc3E7DQogICAgICAgIGNvbnN0IGF0dGFja2VycyA9IHNjcmF0Y2hBdHRhY2tNYXNrW3NxXTsNCiAgICAgICAgaWYgKGF0dGFja2VycyA9PT0gMCkgY29udGludWU7DQoNCiAgICAgICAgY29uc3QgZmlyc3RBdHRhY2tlciA9IHBpZWNlc0luZm9bbG93ZXN0U2V0Qml0SW5kZXgoYXR0YWNrZXJzKV07DQogICAgICAgIGlmICgodGhyZWF0ZW5lZFBpZWNlLnBpZWNlQ29kZSAmIDcpID09PSAxKSB7DQogICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IGNoZWNrQm9udXM7DQogICAgICAgIH0gZWxzZSBpZiAoc2NyYXRjaEd1YXJkTWFza1tzcV0gPT09IDApIHsNCiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBjb25zdCBzc2VTY29yZSA9IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmVGcm9tTWFza3MoDQogICAgICAgICAgICAgICAgdGhyZWF0ZW5lZFBpZWNlLCBwaWVjZXNJbmZvLCBzY3JhdGNoQXR0YWNrTWFzaywgc2NyYXRjaEd1YXJkTWFzaw0KICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIGlmIChzc2VTY29yZSA+IDApIHsNCiAgICAgICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IHNzZVNjb3JlICogMC41Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KLy8g6K6h566X5a6J5YWo5YC877ya5bCG56m65o6n6YK75qC85piv5ZCm6KKr5pWM5o6n77yI5pegIHZpc2l0IOWbnuiwg++8iQ0KY29uc3QgY2FsY3VsYXRlU2FmZXR5VmFsdWVzID0gKHBpZWNlc0luZm8sIGJvYXJkSW5mbywgYm9hcmQgPSBudWxsLCBmb3JTZWFyY2hMZWFmID0gZmFsc2UpID0+IHsNCiAgICBpZiAoZm9yU2VhcmNoTGVhZiAmJiBib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMgJiYgYm9hcmQpIHsNCiAgICAgICAgZm9yIChsZXQgZ2kgPSAwOyBnaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBnaSsrKSB7DQogICAgICAgICAgICBjb25zdCBnZW5lcmFsID0gcGllY2VzSW5mb1tnaV07DQogICAgICAgICAgICBpZiAoZ2VuZXJhbC5waWVjZS50eXBlICE9PSBQSUVDRV9UWVBFUy5HRU5FUkFMKSBjb250aW51ZTsNCg0KICAgICAgICAgICAgY29uc3QgZ2VuZXJhbENvbG9yID0gZ2VuZXJhbC5waWVjZS5jb2xvcjsNCiAgICAgICAgICAgIGNvbnN0IGVuZW15Qml0cyA9IGdlbmVyYWxDb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8uYmxhY2tBdHRhY2sgOiBib2FyZEluZm8ucmVkQXR0YWNrOw0KICAgICAgICAgICAgY29uc3QgaXNSZWQgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnOw0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBnZW5lcmFsOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBPUlRIX0RJUlNbaV1bMF07DQogICAgICAgICAgICAgICAgY29uc3QgbmMgPSBjICsgT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAoaXNSZWQgPyAobnIgPCAwIHx8IG5yID4gMikgOiAobnIgPCA3IHx8IG5yID4gOSkpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdID09PSBudWxsICYmIGhhc0F0dGFja0JpdChlbmVteUJpdHMsIG5yICogOSArIG5jKSkgew0KICAgICAgICAgICAgICAgICAgICBnZW5lcmFsLnNhZmV0eVZhbHVlIC09IDUwOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICByZXR1cm47DQogICAgfQ0KDQogICAgY29uc3QgZ2VuZXJhbEluZm8gPSBbXTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgaWYgKHBpZWNlc0luZm9baV0ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgew0KICAgICAgICAgICAgZ2VuZXJhbEluZm8ucHVzaChwaWVjZXNJbmZvW2ldKTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGNvbnN0IHVzZUF0dGFja0JpdHMgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMpOw0KICAgIGNvbnN0IHVzZU1hc2tzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKTsNCg0KICAgIGZvciAobGV0IGdpID0gMDsgZ2kgPCBnZW5lcmFsSW5mby5sZW5ndGg7IGdpKyspIHsNCiAgICAgICAgY29uc3QgZ2VuZXJhbCA9IGdlbmVyYWxJbmZvW2dpXTsNCiAgICAgICAgY29uc3QgZ2VuZXJhbENvbG9yID0gZ2VuZXJhbC5waWVjZS5jb2xvcjsNCiAgICAgICAgY29uc3QgZW5lbXlDb2xvciA9IGdlbmVyYWxDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IGVuZW15Qml0cyA9IHVzZUF0dGFja0JpdHMNCiAgICAgICAgICAgID8gKGVuZW15Q29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZEF0dGFjayA6IGJvYXJkSW5mby5ibGFja0F0dGFjaykNCiAgICAgICAgICAgIDogbnVsbDsNCiAgICAgICAgY29uc3QgaXNSZWQgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnOw0KICAgICAgICBjb25zdCB7IHIsIGMgfSA9IGdlbmVyYWw7DQoNCiAgICAgICAgY29uc3QgcGVuYWxpemVJZkVuZW15ID0gKG5yLCBuYykgPT4gew0KICAgICAgICAgICAgbGV0IGhhc0VuZW15Q29udHJvbDsNCiAgICAgICAgICAgIGlmICh1c2VBdHRhY2tCaXRzKSB7DQogICAgICAgICAgICAgICAgaGFzRW5lbXlDb250cm9sID0gaGFzQXR0YWNrQml0KGVuZW15Qml0cywgbnIgKiA5ICsgbmMpOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwb3NpdGlvbkNvbnRyb2xsZXJzID0gYm9hcmRJbmZvW25yXVtuY107DQogICAgICAgICAgICAgICAgaGFzRW5lbXlDb250cm9sID0gZmFsc2U7DQogICAgICAgICAgICAgICAgZm9yIChsZXQgY2kgPSAwOyBjaSA8IHBvc2l0aW9uQ29udHJvbGxlcnMubGVuZ3RoOyBjaSsrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBwb3NpdGlvbkNvbnRyb2xsZXJzW2NpXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sb3IgPSBjb250cm9sbGVyLnBpZWNlID8gY29udHJvbGxlci5waWVjZS5jb2xvciA6IGNvbnRyb2xsZXIuY29sb3I7DQogICAgICAgICAgICAgICAgICAgIGlmIChjb2xvciA9PT0gZW5lbXlDb2xvcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgaGFzRW5lbXlDb250cm9sID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKGhhc0VuZW15Q29udHJvbCkgZ2VuZXJhbC5zYWZldHlWYWx1ZSAtPSA1MDsNCiAgICAgICAgfTsNCg0KICAgICAgICBpZiAoKHVzZU1hc2tzICYmIGJvYXJkKSB8fCAoKCFnZW5lcmFsLmNvbnRyb2wgfHwgZ2VuZXJhbC5jb250cm9sLmxlbmd0aCA9PT0gMCkgJiYgYm9hcmQpKSB7DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIE9SVEhfRElSU1tpXVswXTsNCiAgICAgICAgICAgICAgICBjb25zdCBuYyA9IGMgKyBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgICAgICAgICAgaWYgKG5jIDwgMyB8fCBuYyA+IDUpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICBpZiAobnIgPCAwIHx8IG5yID4gMikgY29udGludWU7DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChuciA8IDcgfHwgbnIgPiA5KSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCkgcGVuYWxpemVJZkVuZW15KG5yLCBuYyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoZ2VuZXJhbC5jb250cm9sICYmIGdlbmVyYWwuY29udHJvbC5sZW5ndGgpIHsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ2VuZXJhbC5jb250cm9sLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgcGVuYWxpemVJZkVuZW15KGdlbmVyYWwuY29udHJvbFtpXS5yLCBnZW5lcmFsLmNvbnRyb2xbaV0uYyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQp9Ow0KDQpjb25zdCBjYWxjdWxhdGVOdW1lcmljU2VhcmNoTGVhZlNhZmV0eVZhbHVlcyA9IChwaWVjZXNJbmZvLCBzcXVhcmVDb2RlcykgPT4gew0KICAgIGZvciAobGV0IGdpID0gMDsgZ2kgPCBwaWVjZXNJbmZvLmxlbmd0aDsgZ2krKykgew0KICAgICAgICBjb25zdCBnZW5lcmFsID0gcGllY2VzSW5mb1tnaV07DQogICAgICAgIGlmICgoZ2VuZXJhbC5waWVjZUNvZGUgJiA3KSAhPT0gMSkgY29udGludWU7DQoNCiAgICAgICAgY29uc3QgaXNSZWQgPSBnZW5lcmFsLnBpZWNlQ29kZSA8IDg7DQogICAgICAgIGNvbnN0IGVuZW15Qml0cyA9IGlzUmVkID8gc2NyYXRjaEJsYWNrQXR0YWNrIDogc2NyYXRjaFJlZEF0dGFjazsNCiAgICAgICAgY29uc3QgZGVzdGluYXRpb25zID0gU0VBUkNIX0dFTkVSQUxfREVTVFtpc1JlZCA/IDAgOiAxXVtnZW5lcmFsLnNxXTsNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0aW5hdGlvbnMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHNxID0gZGVzdGluYXRpb25zW2ldOw0KICAgICAgICAgICAgaWYgKHNxdWFyZUNvZGVzW3NxXSA9PT0gMCAmJiBoYXNBdHRhY2tCaXQoZW5lbXlCaXRzLCBzcSkpIHsNCiAgICAgICAgICAgICAgICBnZW5lcmFsLnNhZmV0eVZhbHVlIC09IDUwOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KLy8gLS0tIFR5cGVzIChJbmxpbmVkIHRvIGF2b2lkIGltcG9ydCBpc3N1ZXMgaW4gV29ya2VyKSAtLS0NCi8vIC8vIHR5cGUgQ29sb3IgLSBUeXBlU2NyaXB0IHR5cGUgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5ICdyZWQnIHwgJ2JsYWNrJzsNCi8vIC8vIHR5cGUgUGllY2VUeXBlIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAnZ2VuZXJhbCcgfCAnYWR2aXNvcicgfCAnZWxlcGhhbnQnIHwgJ2hvcnNlJyB8ICdjaGFyaW90JyB8ICdjYW5ub24nIHwgJ3NvbGRpZXInOw0KLy8gLy8gaW50ZXJmYWNlIFBpZWNlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQovLyAvLyBpbnRlcmZhY2UgUG9zaXRpb24gLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkNCi8vIC8vIGludGVyZmFjZSBNb3ZlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQovLyAvLyB0eXBlIEJvYXJkIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAoUGllY2UgfCBudWxsKVtdW107DQoNCi8vIC0tLSBPcGVuaW5nIEJvb2sgVHlwZXMgLS0tDQovLyBPcGVuaW5nIEJvb2sgRW50cnkgLSByZXByZXNlbnRzIHBvc3NpYmxlIG1vdmVzIGZvciBhIHBvc2l0aW9uDQovLyBpbnRlcmZhY2UgQm9va0VudHJ5IC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQoNCi8vIEluZGl2aWR1YWwgbW92ZSBpbiBvcGVuaW5nIGJvb2sgd2l0aCBtZXRhZGF0YQ0KLy8gaW50ZXJmYWNlIEJvb2tNb3ZlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQoNCi8vIC0tLSBab2JyaXN0IEhhc2hpbmcgZm9yIE9wZW5pbmcgQm9vayAtLS0NCi8vIEVhY2ggcGllY2UgdHlwZS9jb2xvci9wb3NpdGlvbiBnZXRzIGEgdW5pcXVlIHJhbmRvbSA1My1iaXQgaW50ZWdlcg0KLy8gVXNlcyBzZWVkZWQgUk5HIGZvciBkZXRlcm1pbmlzdGljIGhhc2hpbmcNCmNsYXNzIFpvYnJpc3RIYXNoZXIgew0KICAgIGhhc2hUYWJsZTsgIC8vIFtyb3ddW2NvbF1bcGllY2VJbmRleF0NCiAgICBwaWVjZVRvSW5kZXg7DQoNCiAgICBjb25zdHJ1Y3RvcigpIHsNCiAgICAgICAgdGhpcy5waWVjZVRvSW5kZXggPSBuZXcgTWFwKFsNCiAgICAgICAgICAgIFsncmVkLWdlbmVyYWwnLCAwXSwgWydyZWQtYWR2aXNvcicsIDFdLCBbJ3JlZC1lbGVwaGFudCcsIDJdLCBbJ3JlZC1ob3JzZScsIDNdLA0KICAgICAgICAgICAgWydyZWQtY2hhcmlvdCcsIDRdLCBbJ3JlZC1jYW5ub24nLCA1XSwgWydyZWQtc29sZGllcicsIDZdLA0KICAgICAgICAgICAgWydibGFjay1nZW5lcmFsJywgN10sIFsnYmxhY2stYWR2aXNvcicsIDhdLCBbJ2JsYWNrLWVsZXBoYW50JywgOV0sIFsnYmxhY2staG9yc2UnLCAxMF0sDQogICAgICAgICAgICBbJ2JsYWNrLWNoYXJpb3QnLCAxMV0sIFsnYmxhY2stY2Fubm9uJywgMTJdLCBbJ2JsYWNrLXNvbGRpZXInLCAxM10NCiAgICAgICAgXSk7DQogICAgICAgIC8vIEluaXRpYWxpemUgcmFuZG9tIGhhc2ggdmFsdWVzIHVzaW5nIHNlZWRlZCBSTkcgKDUzLWJpdCBpbnRlZ2VycyB0byBhdm9pZCBwcmVjaXNpb24gaXNzdWVzKQ0KICAgICAgICB0aGlzLmhhc2hUYWJsZSA9IFtdOw0KICAgICAgICBjb25zdCBNQVhfU0FGRSA9IDB4MUZGRkZGRkZGRkZGRkY7IC8vIDJeNTMgLSAxDQogICAgICAgIA0KICAgICAgICAvLyBTaW1wbGUgc2VlZGVkIFJORyAoTENHIC0gTGluZWFyIENvbmdydWVudGlhbCBHZW5lcmF0b3IpDQogICAgICAgIGxldCBzZWVkID0gMTIzNDU2Nzg5OyAvLyBGaXhlZCBzZWVkIGZvciBkZXRlcm1pbmlzdGljIGhhc2hpbmcNCiAgICAgICAgY29uc3Qgc2VlZGVkUmFuZG9tID0gKCkgPT4gew0KICAgICAgICAgICAgc2VlZCA9IChzZWVkICogMTEwMzUxNTI0NSArIDEyMzQ1KSAmIDB4N2ZmZmZmZmY7DQogICAgICAgICAgICByZXR1cm4gc2VlZCAvIDB4N2ZmZmZmZmY7DQogICAgICAgIH07DQoNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICB0aGlzLmhhc2hUYWJsZVtyXSA9IFtdOw0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsNCiAgICAgICAgICAgICAgICB0aGlzLmhhc2hUYWJsZVtyXVtjXSA9IFtdOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IHAgPSAwOyBwIDwgMTQ7IHArKykgew0KICAgICAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBkZXRlcm1pbmlzdGljIDUzLWJpdCBpbnRlZ2VyDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKTsNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY11bcF0gPSB2YWx1ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICAvLyDlj7bor4TkvLDnvJPlrZjplK7vvJpib2FyZEhhc2ggXiBpbml0aWF0b3JLZXkgXiBzdGFnZUtleQ0KICAgICAgICB0aGlzLmV2YWxJbml0aWF0b3JLZXlzID0gew0KICAgICAgICAgICAgcmVkOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpLA0KICAgICAgICAgICAgYmxhY2s6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSkNCiAgICAgICAgfTsNCiAgICAgICAgdGhpcy5ldmFsU3RhZ2VLZXlzID0gew0KICAgICAgICAgICAgZWFybHk6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSksDQogICAgICAgICAgICBtaWQ6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSksDQogICAgICAgICAgICBsYXRlOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpDQogICAgICAgIH07DQogICAgfQ0KDQogICAgcGllY2VJbmRleChwaWVjZU9yS2V5KSB7DQogICAgICAgIGlmIChwaWVjZU9yS2V5ID09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7DQogICAgICAgIGxldCBjb2xvcjsNCiAgICAgICAgbGV0IHR5cGU7DQogICAgICAgIGlmICh0eXBlb2YgcGllY2VPcktleSA9PT0gJ3N0cmluZycpIHsNCiAgICAgICAgICAgIGNvbnN0IHNlcGFyYXRvciA9IHBpZWNlT3JLZXkuaW5kZXhPZignLScpOw0KICAgICAgICAgICAgaWYgKHNlcGFyYXRvciA8IDApIHJldHVybiB1bmRlZmluZWQ7DQogICAgICAgICAgICBjb2xvciA9IHBpZWNlT3JLZXkuc2xpY2UoMCwgc2VwYXJhdG9yKTsNCiAgICAgICAgICAgIHR5cGUgPSBwaWVjZU9yS2V5LnNsaWNlKHNlcGFyYXRvciArIDEpOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgY29sb3IgPSBwaWVjZU9yS2V5LmNvbG9yOw0KICAgICAgICAgICAgdHlwZSA9IHBpZWNlT3JLZXkudHlwZTsNCiAgICAgICAgfQ0KICAgICAgICBsZXQgdHlwZUluZGV4Ow0KICAgICAgICBzd2l0Y2ggKHR5cGUpIHsNCiAgICAgICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuR0VORVJBTDogdHlwZUluZGV4ID0gMDsgYnJlYWs7DQogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkFEVklTT1I6IHR5cGVJbmRleCA9IDE7IGJyZWFrOw0KICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5FTEVQSEFOVDogdHlwZUluZGV4ID0gMjsgYnJlYWs7DQogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkhPUlNFOiB0eXBlSW5kZXggPSAzOyBicmVhazsNCiAgICAgICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuQ0hBUklPVDogdHlwZUluZGV4ID0gNDsgYnJlYWs7DQogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkNBTk5PTjogdHlwZUluZGV4ID0gNTsgYnJlYWs7DQogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLlNPTERJRVI6IHR5cGVJbmRleCA9IDY7IGJyZWFrOw0KICAgICAgICAgICAgZGVmYXVsdDogcmV0dXJuIHVuZGVmaW5lZDsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoY29sb3IgPT09ICdyZWQnKSByZXR1cm4gdHlwZUluZGV4Ow0KICAgICAgICByZXR1cm4gY29sb3IgPT09ICdibGFjaycgPyB0eXBlSW5kZXggKyA3IDogdW5kZWZpbmVkOw0KICAgIH0NCg0KICAgIGV2YWxDYWNoZUtleShib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpIHsNCiAgICAgICAgY29uc3Qgc3RhZ2VLZXkgPSB0aGlzLmV2YWxTdGFnZUtleXNbZ2FtZVN0YWdlXSB8fCB0aGlzLmV2YWxTdGFnZUtleXMubWlkOw0KICAgICAgICByZXR1cm4gdGhpcy5oYXNoKGJvYXJkKSBeIHRoaXMuZXZhbEluaXRpYXRvcktleXNbc2VhcmNoSW5pdGlhdG9yXSBeIHN0YWdlS2V5Ow0KICAgIH0NCg0KICAgIGV2YWxDYWNoZUtleUZyb21IYXNoKGJvYXJkSGFzaCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpIHsNCiAgICAgICAgY29uc3Qgc3RhZ2VLZXkgPSB0aGlzLmV2YWxTdGFnZUtleXNbZ2FtZVN0YWdlXSB8fCB0aGlzLmV2YWxTdGFnZUtleXMubWlkOw0KICAgICAgICByZXR1cm4gYm9hcmRIYXNoIF4gdGhpcy5ldmFsSW5pdGlhdG9yS2V5c1tzZWFyY2hJbml0aWF0b3JdIF4gc3RhZ2VLZXk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICog5pWw5YC8IFRUIGtlee+8muaKiuihjOaji+aWuee8lueggei/m+acgOS9juS9je+8jOmBv+WFjSBgaGFzaCBeIHNpZGVLZXlgIOWcqCBKUyBUb0ludDMyDQogICAgICog5LiL5Lqn55Sf6Leo57qi6buR56Kw5pKe77yI6YKj5Lya5L2/IFRUIOivr+WRveS4reW5tuaUueWPmOaQnOe0ouagkS/mo4vlipvvvInjgIINCiAgICAgKiDnrYnku7fkuo7ml6flrZfnrKbkuLIga2V5IGAke2hhc2h9OiR7c2lkZX1gIOeahOWMuuWIhuiDveWKm+OAgg0KICAgICAqLw0KICAgIHR0S2V5RnJvbUhhc2goYm9hcmRIYXNoLCBzaWRlKSB7DQogICAgICAgIGNvbnN0IGggPSBib2FyZEhhc2ggfCAwOyAvLyBePSDpk77nu5Pmnpzlt7LmmK8gSW50MzINCiAgICAgICAgcmV0dXJuIGggKiAyICsgKHNpZGUgPT09ICdyZWQnID8gMCA6IDEpOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENvbXB1dGUgaGFzaCBmb3IgYSBib2FyZCBwb3NpdGlvbg0KICAgICAqLw0KICAgIGhhc2goYm9hcmQpIHsNCiAgICAgICAgbGV0IGggPSAwOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGllY2VJZHggPSB0aGlzLnBpZWNlSW5kZXgocGllY2UpOw0KICAgICAgICAgICAgICAgICAgICBpZiAocGllY2VJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgaCBePSB0aGlzLmhhc2hUYWJsZVtyXVtjXVtwaWVjZUlkeF07DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIGg7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogTWlycm9yIGEgYm9hcmQgaG9yaXpvbnRhbGx5IChmb3Igc3ltbWV0cnkgZGV0ZWN0aW9uKQ0KICAgICAqLw0KICAgIG1pcnJvckJvYXJkKGJvYXJkKSB7DQogICAgICAgIGNvbnN0IG1pcnJvcmVkID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkpOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgbWlycm9yZWRbcl1bOCAtIGNdID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIG1pcnJvcmVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIE1pcnJvciBhIG1vdmUgaG9yaXpvbnRhbGx5DQogICAgICovDQogICAgbWlycm9yTW92ZShtb3ZlKSB7DQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiA4IC0gbW92ZS5mcm9tLmMgfSwNCiAgICAgICAgICAgIHRvOiB7IHI6IG1vdmUudG8uciwgYzogOCAtIG1vdmUudG8uYyB9DQogICAgICAgIH07DQogICAgfQ0KDQogICAgLyoqDQogICAgICogSW5jcmVtZW50YWxseSB1cGRhdGUgaGFzaCBhZnRlciBhIG1vdmUgKFhPUiDoh6rpgIbvvJrlho3osIPnlKjkuIDmrKHlj6/ov5jljp8pLg0KICAgICAqIG1vdmluZ1BpZWNlIC8gY2FwdHVyZWRQaWVjZSDlj6/kuLrmo4vlrZDlr7nosaHmiJYgJ2NvbG9yLXR5cGUnIOWtl+espuS4suOAgg0KICAgICAqIOmhu+WcqCBtYWtlTW92ZSDkuYvliY3lj5blvpcgbW92aW5nUGllY2XvvIxjYXB0dXJlZCDnlKggbWFrZU1vdmUg6L+U5Zue5YC844CCDQogICAgICovDQogICAgdXBkYXRlSGFzaChjdXJyZW50SGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgbGV0IG5ld0hhc2ggPSBjdXJyZW50SGFzaDsNCiAgICAgICAgY29uc3QgbW92aW5nSWR4ID0gdGhpcy5waWVjZUluZGV4KG1vdmluZ1BpZWNlKTsNCiAgICAgICAgaWYgKG1vdmluZ0lkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY11bbW92aW5nSWR4XTsNCiAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS50by5yXVttb3ZlLnRvLmNdW21vdmluZ0lkeF07DQogICAgICAgIH0NCiAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkSWR4ID0gdGhpcy5waWVjZUluZGV4KGNhcHR1cmVkUGllY2UpOw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUudG8ucl1bbW92ZS50by5jXVtjYXB0dXJlZElkeF07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIG5ld0hhc2g7DQogICAgfQ0KfQ0KDQovKioNCiAqIE9wZW5pbmcgQm9vayBNYW5hZ2VyDQogKi8NCmNsYXNzIE9wZW5pbmdCb29rIHsNCiAgICBib29rOyAgLy8gWm9icmlzdCBoYXNoIC0+IG1vdmVzDQogICAgaGFzaGVyOw0KICAgIGVuYWJsZWQ7DQogICAgbWF4UGx5OyAgLy8gTWF4aW11bSBwbHkgdG8gdXNlIG9wZW5pbmcgYm9vayAoZS5nLiwgMjApDQoNCiAgICBjb25zdHJ1Y3RvcihtYXhQbHkgPSAxMikgew0KICAgICAgICB0aGlzLmJvb2sgPSBuZXcgTWFwKCk7DQogICAgICAgIHRoaXMuaGFzaGVyID0gbmV3IFpvYnJpc3RIYXNoZXIoKTsNCiAgICAgICAgdGhpcy5lbmFibGVkID0gdHJ1ZTsNCiAgICAgICAgdGhpcy5tYXhQbHkgPSBtYXhQbHk7DQogICAgICAgIHRoaXMuaW5pdGlhbGl6ZUJvb2soKTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBJbml0aWFsaXplIHdpdGggY29tbW9uIENoaW5lc2UgQ2hlc3Mgb3BlbmluZ3MNCiAgICAgKi8NCiAgICBpbml0aWFsaXplQm9vaygpIHsNCiAgICAgICAgLy8gQWRkIGNsYXNzaWMgQ2hpbmVzZSBDaGVzcyBvcGVuaW5ncyBtYW51YWxseQ0KICAgICAgICANCiAgICAgICAgLyoNCiAgICAgICAgLy8gMS4g5Lit54Ku6L+H5rKz6L2m5a+55bGP6aOO6ams5bmz54Ku5a+56L2mIChDZW50cmFsIENhbm5vbiB2cyBTY3JlZW4gSG9yc2VzKQ0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lKFsNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA3LCBjOiA3IH0sIHRvOiB7IHI6IDcsIGM6IDQgfSB9LCAgLy8gMS4g54Ku5LqM5bmz5LqUDQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogNyB9LCB0bzogeyByOiAyLCBjOiA2IH0gfSwgIC8vIDEuLi4g6amsOOi/mzcNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA3IH0sIHRvOiB7IHI6IDcsIGM6IDYgfSB9LCAgLy8gMi4g6ams5LqM6L+b5LiJDQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogOCB9LCB0bzogeyByOiAwLCBjOiA3IH0gfSwgIC8vIDIuLi4g6L2mOeW5szggICAgICAgICAgIA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDggfSwgdG86IHsgcjogOSwgYzogNyB9IH0sICAvLyAzLiDovabkuIDlubPkuowNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAzLCBjOiA2IH0sIHRvOiB7IHI6IDQsIGM6IDYgfSB9LCAgLy8gMy4uLiDljZI36L+bMQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDcgfSwgdG86IHsgcjogMywgYzogNyB9IH0sICAvLyA0LiDovabkuozov5vlha0NCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiAxIH0sIHRvOiB7IHI6IDIsIGM6IDIgfSB9LCAgLy8gNC4uLiDpqawy6L+bMw0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDYsIGM6IDIgfSwgdG86IHsgcjogNSwgYzogMiB9IH0sICAvLyA1LiDlhbXkuIPov5vkuIANCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAyLCBjOiA3IH0sIHRvOiB7IHI6IDIsIGM6IDggfSB9LCAgLy8gNS4uLiDngq445bmzOQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDMsIGM6IDcgfSwgdG86IHsgcjogMywgYzogNiB9IH0sICAvLyA2LiDovabkuozlubPkuIkNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAyLCBjOiA4IH0sIHRvOiB7IHI6IDEsIGM6IDggfSB9LCAgLy8gNi4uLiDngq456YCAMSAgICAgICAgICANCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCg0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKFsNCiAgICAgICAgICAgICfngq7kuozlubPkupQnLCAn6amsOOi/mzcnLCAn6ams5LqM6L+b5LiJJywgJ+i9pjnlubM4JywgJ+i9puS4gOW5s+S6jCcsICfljZI36L+bMScsDQogICAgICAgICAgICAn6L2m5LqM6L+b5YWtJywgJ+mprDLov5szJywgJ+WFteS4g+i/m+S4gCcsICfngq445bmzOScsICfovabkuozlubPkuIknLCAn54KuOemAgDEnLA0KICAgICAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCg0KICAgICAgICAgICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKFsNCiAgICAgICAgICAgICfngq7kuozlubPkupQg6amsOOi/mzcg6ams5LqM6L+b5LiJIOi9pjnlubM4IOi9puS4gOW5s+S6jCDljZI36L+bMSDovabkuozov5vlha0g6amsMui/mzMg5YW15LiD6L+b5LiAIOeCrjjlubM5IOi9puS6jOW5s+S4iSDngq456YCAMScNCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCiAgICAgICAgKi8NCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBBZGQgYW4gb3BlbmluZyBsaW5lIHRvIHRoZSBib29rDQogICAgICogQHBhcmFtIG1vdmVzIEFycmF5IG9mIG1vdmVzIHJlcHJlc2VudGluZyBhbiBvcGVuaW5nIGxpbmUNCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCB3ZWlnaHRzIGZvciBlYWNoIG1vdmUgKGRlZmF1bHQgMTAwIGZvciBhbGwpDQogICAgICovDQogICAgYWRkT3BlbmluZ0xpbmUobW92ZXMsIHdlaWdodHMpIHsNCiAgICAgICAgLy8gU3RhcnQgd2l0aCBpbml0aWFsIGJvYXJkIHBvc2l0aW9uDQogICAgICAgIGNvbnN0IGJvYXJkID0gdGhpcy5jcmVhdGVJbml0aWFsQm9hcmQoKTsNCiAgICAgICAgbGV0IGN1cnJlbnRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChib2FyZCk7DQoNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtb3Zlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2ldOw0KICAgICAgICAgICAgY29uc3Qgd2VpZ2h0ID0gd2VpZ2h0cz8uW2ldID8/IDEwMDsNCg0KICAgICAgICAgICAgLy8gR2V0IG9yIGNyZWF0ZSBib29rIGVudHJ5IGZvciB0aGlzIHBvc2l0aW9uDQogICAgICAgICAgICBsZXQgZW50cnkgPSB0aGlzLmJvb2suZ2V0KGN1cnJlbnRIYXNoKTsNCiAgICAgICAgICAgIGlmICghZW50cnkpIHsNCiAgICAgICAgICAgICAgICBlbnRyeSA9IHsgbW92ZXM6IFtdIH07DQogICAgICAgICAgICAgICAgdGhpcy5ib29rLnNldChjdXJyZW50SGFzaCwgZW50cnkpOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBBZGQgbW92ZSBpZiBub3QgYWxyZWFkeSBwcmVzZW50DQogICAgICAgICAgICBjb25zdCBleGlzdGluZ01vdmUgPSBlbnRyeS5tb3Zlcy5maW5kKA0KICAgICAgICAgICAgICAgIG0gPT4gbS5mcm9tLnIgPT09IG1vdmUuZnJvbS5yICYmIG0uZnJvbS5jID09PSBtb3ZlLmZyb20uYyAmJg0KICAgICAgICAgICAgICAgICAgICAgbS50by5yID09PSBtb3ZlLnRvLnIgJiYgbS50by5jID09PSBtb3ZlLnRvLmMNCiAgICAgICAgICAgICk7DQoNCiAgICAgICAgICAgIGlmICghZXhpc3RpbmdNb3ZlKSB7DQogICAgICAgICAgICAgICAgZW50cnkubW92ZXMucHVzaCh7DQogICAgICAgICAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sDQogICAgICAgICAgICAgICAgICAgIHRvOiB7IHI6IG1vdmUudG8uciwgYzogbW92ZS50by5jIH0sDQogICAgICAgICAgICAgICAgICAgIHdlaWdodDogd2VpZ2h0DQogICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSB3ZWlnaHQgaWYgbW92ZSBhbHJlYWR5IGV4aXN0cyAodGFrZSBtYXhpbXVtKQ0KICAgICAgICAgICAgICAgIGV4aXN0aW5nTW92ZS53ZWlnaHQgPSBNYXRoLm1heChleGlzdGluZ01vdmUud2VpZ2h0LCB3ZWlnaHQpOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBNYWtlIHRoZSBtb3ZlIG9uIHRoZSBib2FyZA0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBib2FyZFttb3ZlLnRvLnJdW21vdmUudG8uY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghcGllY2UpIGJyZWFrOyAvLyBJbnZhbGlkIGxpbmUNCg0KICAgICAgICAgICAgY29uc3QgcGllY2VLZXkgPSBgJHtwaWVjZS5jb2xvcn0tJHtwaWVjZS50eXBlfWA7DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGNhcHR1cmVkID8gYCR7Y2FwdHVyZWQuY29sb3J9LSR7Y2FwdHVyZWQudHlwZX1gIDogdW5kZWZpbmVkOw0KDQogICAgICAgICAgICAvLyBVcGRhdGUgaGFzaCBpbmNyZW1lbnRhbGx5DQogICAgICAgICAgICBjdXJyZW50SGFzaCA9IHRoaXMuaGFzaGVyLnVwZGF0ZUhhc2goY3VycmVudEhhc2gsIG1vdmUsIHBpZWNlS2V5LCBjYXB0dXJlZEtleSk7DQoNCiAgICAgICAgICAgIC8vIEFwcGx5IG1vdmUNCiAgICAgICAgICAgIGJvYXJkW21vdmUudG8ucl1bbW92ZS50by5jXSA9IHBpZWNlOw0KICAgICAgICAgICAgYm9hcmRbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXSA9IG51bGw7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBHZXQgYmVzdCBtb3ZlIGZyb20gb3BlbmluZyBib29rIGZvciBjdXJyZW50IHBvc2l0aW9uDQogICAgICogQHBhcmFtIGJvYXJkIEN1cnJlbnQgYm9hcmQgc3RhdGUNCiAgICAgKiBAcGFyYW0gcGx5IEN1cnJlbnQgcGx5IG51bWJlciAoMCA9IHN0YXJ0IG9mIGdhbWUpDQogICAgICogQHJldHVybnMgTW92ZSBmcm9tIGJvb2ssIG9yIG51bGwgaWYgcG9zaXRpb24gbm90IGluIGJvb2sNCiAgICAgKi8NCiAgICBnZXRCb29rTW92ZShib2FyZCwgcGx5KXsNCiAgICAgICAgLy8gRG9uJ3QgdXNlIGJvb2sgaWYgZGlzYWJsZWQgb3IgcGFzdCBtYXggcGx5DQogICAgICAgIGlmICghdGhpcy5lbmFibGVkIHx8IHBseSA+PSB0aGlzLm1heFBseSkgew0KICAgICAgICAgICAgY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBkaXNhYmxlZCBvciBwYXN0IG1heCBwbHknLCB7IGVuYWJsZWQ6IHRoaXMuZW5hYmxlZCwgbWF4UGx5OiB0aGlzLm1heFBseSwgcGx5OiBwbHkgfSk7DQogICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy9jb25zb2xlLmxvZygnT3BlbmluZyBib29rIGdldEJvb2tNb3ZlIGNhbGxlZCcsIHsgcGx5IH0pOw0KICAgICAgICANCiAgICAgICAgLy8gVHJ5IHRvIGZpbmQgbW92ZSBmb3IgY3VycmVudCBwb3NpdGlvbg0KICAgICAgICBjb25zdCBoYXNoID0gdGhpcy5oYXNoZXIuaGFzaChib2FyZCk7DQogICAgICAgIC8vY29uc29sZS5sb2coJ0N1cnJlbnQgcG9zaXRpb24gaGFzaDonLCBoYXNoKTsNCiAgICAgICAgDQogICAgICAgIGxldCBlbnRyeSA9IHRoaXMuYm9vay5nZXQoaGFzaCk7DQogICAgICAgIC8vY29uc29sZS5sb2coJ0VudHJ5IGZvdW5kIGZvciBjdXJyZW50IGhhc2g6JywgZW50cnkgPyBlbnRyeS5tb3Zlcy5sZW5ndGggKyAnIG1vdmVzJyA6ICdudWxsJyk7DQogICAgICAgIGlmIChlbnRyeSAmJiBlbnRyeS5tb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnQWxsIHBvc3NpYmxlIGJvb2sgbW92ZXMgd2l0aCB3ZWlnaHRzOicsIEpTT04uc3RyaW5naWZ5KGVudHJ5Lm1vdmVzKSk7DQogICAgICAgICAgICAvLyBDYWxjdWxhdGUgdG90YWwgd2VpZ2h0DQogICAgICAgICAgICBjb25zdCB0b3RhbFdlaWdodCA9IGVudHJ5Lm1vdmVzLnJlZHVjZSgoc3VtLCBtb3ZlKSA9PiBzdW0gKyBtb3ZlLndlaWdodCwgMCk7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnVG90YWwgd2VpZ2h0OicsIHRvdGFsV2VpZ2h0KTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgbGV0IG1pcnJvcmVkTW92ZSA9IGZhbHNlOw0KDQogICAgICAgIC8vIElmIG5vdCBmb3VuZCwgdHJ5IG1pcnJvcmVkIHBvc2l0aW9uDQogICAgICAgIGlmICghZW50cnkgfHwgZW50cnkubW92ZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICBjb25zdCBtaXJyb3JlZEJvYXJkID0gdGhpcy5oYXNoZXIubWlycm9yQm9hcmQoYm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgbWlycm9yZWRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChtaXJyb3JlZEJvYXJkKTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdObyBlbnRyeSBmb3VuZCwgdHJ5aW5nIG1pcnJvcmVkIHBvc2l0aW9uOicsIG1pcnJvcmVkSGFzaCk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGVudHJ5ID0gdGhpcy5ib29rLmdldChtaXJyb3JlZEhhc2gpOw0KICAgICAgICAgICAgaWYgKGVudHJ5ICYmIGVudHJ5Lm1vdmVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdFbnRyeSBmb3VuZCBmb3IgbWlycm9yZWQgaGFzaDonLCBlbnRyeS5tb3Zlcy5sZW5ndGggKyAnIG1vdmVzJyk7DQogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnT3JpZ2luYWwgbWlycm9yIG1vdmVzOicsIEpTT04uc3RyaW5naWZ5KGVudHJ5Lm1vdmVzKSk7DQogICAgICAgICAgICAgICAgbWlycm9yZWRNb3ZlID0gdHJ1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnTm8gZW50cnkgZm91bmQgZm9yIG1pcnJvcmVkIGhhc2gnKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIGlmICghZW50cnkgfHwgZW50cnkubW92ZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgbW92ZSBub3QgZm91bmQgZm9yIGN1cnJlbnQgcG9zaXRpb24nKTsNCiAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICB9DQoNCiAgICAgICAgLy8gU2VsZWN0IG1vdmUgYmFzZWQgb24gd2VpZ2h0cw0KICAgICAgICBjb25zdCBzZWxlY3RlZE1vdmUgPSB0aGlzLnNlbGVjdFdlaWdodGVkTW92ZShlbnRyeS5tb3Zlcyk7DQogICAgICAgIGNvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgbW92ZSBzZWxlY3RlZDonLCBzZWxlY3RlZE1vdmUpOw0KICAgICAgICANCiAgICAgICAgLy8gSWYgd2UgdXNlZCBtaXJyb3JlZCBwb3NpdGlvbiwgbWlycm9yIHRoZSBtb3ZlIGJhY2sNCiAgICAgICAgaWYgKHNlbGVjdGVkTW92ZSAmJiBtaXJyb3JlZE1vdmUpIHsNCiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdTZWxlY3RlZCBtaXJyb3IgbW92ZSBiZWZvcmUgY29udmVyc2lvbjonLCBKU09OLnN0cmluZ2lmeShzZWxlY3RlZE1vdmUpKTsNCiAgICAgICAgICAgIGNvbnN0IG1pcnJvcmVkTW92ZUNvbnZlcnRlZCA9IHRoaXMuaGFzaGVyLm1pcnJvck1vdmUoc2VsZWN0ZWRNb3ZlKTsNCiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdDb252ZXJ0ZWQgbWlycm9yIG1vdmU6JywgSlNPTi5zdHJpbmdpZnkobWlycm9yZWRNb3ZlQ29udmVydGVkKSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBtaXJyb3JlZCBtb3ZlIGhhcyB2YWxpZCBzdHJ1Y3R1cmUNCiAgICAgICAgICAgIGlmIChtaXJyb3JlZE1vdmVDb252ZXJ0ZWQgJiYgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20gJiYgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50by5jID09PSAnbnVtYmVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQ7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdNaXJyb3JlZCBtb3ZlIGhhcyBpbnZhbGlkIHN0cnVjdHVyZSwgcmV0dXJuaW5nIG51bGwnKTsNCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmIChzZWxlY3RlZE1vdmUpIHsNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBzZWxlY3RlZCBtb3ZlIGhhcyB2YWxpZCBzdHJ1Y3R1cmUNCiAgICAgICAgICAgIGlmIChzZWxlY3RlZE1vdmUuZnJvbSAmJiBzZWxlY3RlZE1vdmUudG8gJiYNCiAgICAgICAgICAgICAgICB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLmZyb20uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIHNlbGVjdGVkTW92ZS5mcm9tLmMgPT09ICdudW1iZXInICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIHNlbGVjdGVkTW92ZS50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHNlbGVjdGVkTW92ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlbGVjdGVkIG1vdmUgaGFzIGludmFsaWQgc3RydWN0dXJlLCByZXR1cm5pbmcgbnVsbCcpOw0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICByZXR1cm4gbnVsbDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBTZWxlY3QgYSBtb3ZlIHJhbmRvbWx5IGJhc2VkIG9uIHdlaWdodHMNCiAgICAgKiBIaWdoZXIgd2VpZ2h0ID0gbW9yZSBsaWtlbHkgdG8gYmUgc2VsZWN0ZWQNCiAgICAgKi8NCiAgICBzZWxlY3RXZWlnaHRlZE1vdmUobW92ZXMpIHsNCiAgICAgICAgLy8gQ2FsY3VsYXRlIHRvdGFsIHdlaWdodA0KICAgICAgICBjb25zdCB0b3RhbFdlaWdodCA9IG1vdmVzLnJlZHVjZSgoc3VtLCBtb3ZlKSA9PiBzdW0gKyBtb3ZlLndlaWdodCwgMCk7DQoNCiAgICAgICAgLy8gR2VuZXJhdGUgcmFuZG9tIG51bWJlcg0KICAgICAgICBsZXQgcmFuZG9tID0gTWF0aC5yYW5kb20oKSAqIHRvdGFsV2VpZ2h0Ow0KDQogICAgICAgIC8vIFNlbGVjdCBtb3ZlDQogICAgICAgIGZvciAoY29uc3QgbW92ZSBvZiBtb3Zlcykgew0KICAgICAgICAgICAgcmFuZG9tIC09IG1vdmUud2VpZ2h0Ow0KICAgICAgICAgICAgaWYgKHJhbmRvbSA8PSAwKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogbW92ZS5mcm9tLmMgfSwgdG86IHsgcjogbW92ZS50by5yLCBjOiBtb3ZlLnRvLmMgfQ0KICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICAvLyBGYWxsYmFjayAoc2hvdWxkIG5ldmVyIHJlYWNoIGhlcmUpDQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmVzWzBdLmZyb20uciwgYzogbW92ZXNbMF0uZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmVzWzBdLnRvLnIsIGM6IG1vdmVzWzBdLnRvLmMgfQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEhlbHBlciB0byBjcmVhdGUgaW5pdGlhbCBib2FyZCAobmVlZGVkIGZvciBib29rIGluaXRpYWxpemF0aW9uKQ0KICAgICAqLw0KICAgIGNyZWF0ZUluaXRpYWxCb2FyZCgpIHsNCiAgICAgICAgY29uc3QgYm9hcmQgPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKSk7DQogICAgICAgIA0KICAgICAgICAvLyBSZWQgcGllY2VzIChib3R0b20gLSByPTAtMikNCiAgICAgICAgYm9hcmRbMF1bMF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzFdID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bMl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVszXSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bNF0gPSB7IHR5cGU6ICdnZW5lcmFsJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzVdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs2XSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzddID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bOF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzJdWzFdID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzJdWzddID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzBdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVsyXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bNF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzZdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVs4XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCg0KICAgICAgICAvLyBCbGFjayBwaWVjZXMgKHRvcCAtIHI9Ny05KQ0KICAgICAgICBib2FyZFs5XVswXSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVsxXSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bMl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzNdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzRdID0geyB0eXBlOiAnZ2VuZXJhbCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzVdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzZdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs3XSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bOF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbN11bMV0gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs3XVs3XSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzBdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzJdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzRdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzZdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzhdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQoNCiAgICAgICAgcmV0dXJuIGJvYXJkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEVuYWJsZSBvciBkaXNhYmxlIG9wZW5pbmcgYm9vaw0KICAgICAqLw0KICAgIHNldEVuYWJsZWQoZW5hYmxlZCkgew0KICAgICAgICB0aGlzLmVuYWJsZWQgPSBlbmFibGVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENoZWNrIGlmIG9wZW5pbmcgYm9vayBpcyBlbmFibGVkDQogICAgICovDQogICAgaXNFbmFibGVkKCkgew0KICAgICAgICByZXR1cm4gdGhpcy5lbmFibGVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEdldCBzdGF0aXN0aWNzIGFib3V0IHRoZSBvcGVuaW5nIGJvb2sNCiAgICAgKi8NCiAgICBnZXRTdGF0cygpIHsNCiAgICAgICAgbGV0IHRvdGFsTW92ZXMgPSAwOw0KICAgICAgICB0aGlzLmJvb2suZm9yRWFjaChlbnRyeSA9PiB7DQogICAgICAgICAgICB0b3RhbE1vdmVzICs9IGVudHJ5Lm1vdmVzLmxlbmd0aDsNCiAgICAgICAgfSk7DQoNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIHBvc2l0aW9uczogdGhpcy5ib29rLnNpemUsDQogICAgICAgICAgICB0b3RhbE1vdmVzDQogICAgICAgIH07DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQWRkIG9wZW5pbmcgbGluZSBmcm9tIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24NCiAgICAgKiBAcGFyYW0gbm90YXRpb24gQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uIChlLmcuLCBbJ+eCruS6jOW5s+S6lCcsICfpqaw46L+bNyddKQ0KICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIGFycmF5IG9mIHdlaWdodHMgZm9yIGVhY2ggbW92ZQ0KICAgICAqLw0KICAgIGFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKG5vdGF0aW9uLCB3ZWlnaHRzKSB7DQogICAgICAgIC8vIENvbnZlcnQgdHJhZGl0aW9uYWwgbm90YXRpb24gdG8gY29vcmRpbmF0ZSBmb3JtYXQNCiAgICAgICAgY29uc3QgbW92ZXMgPSB0aGlzLm5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvbik7DQogICAgICAgIC8vIEFkZCB0aGUgbW92ZXMgdG8gdGhlIG9wZW5pbmcgYm9vaw0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lKG1vdmVzLCB3ZWlnaHRzKTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBBZGQgb3BlbmluZyBsaW5lIGZyb20gc3RyaW5nIHdpdGggc3BhY2Utc2VwYXJhdGVkIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24NCiAgICAgKiBAcGFyYW0gbm90YXRpb25BcnJheSBBcnJheSBvZiBzdHJpbmdzLCBlYWNoIGNvbnRhaW5pbmcgc3BhY2Utc2VwYXJhdGVkIG1vdmVzIChlLmcuLCBbJ+eCruS6jOW5s+S6lCDpqaw46L+bNyDovabkuIDlubPkuownXSkNCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCBhcnJheSBvZiB3ZWlnaHRzIGZvciBlYWNoIG1vdmUNCiAgICAgKi8NCiAgICBhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcobm90YXRpb25BcnJheSwgd2VpZ2h0cykgew0KICAgICAgICAvLyBQcm9jZXNzIGVhY2ggc3RyaW5nIGluIHRoZSBhcnJheQ0KICAgICAgICBpZiAoIW5vdGF0aW9uQXJyYXkgfHwgIUFycmF5LmlzQXJyYXkobm90YXRpb25BcnJheSkgfHwgbm90YXRpb25BcnJheS5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgfQ0KICAgICAgICBub3RhdGlvbkFycmF5LmZvckVhY2gobm90YXRpb25TdHJpbmcgPT4gew0KICAgICAgICAgICAgLy8gU3BsaXQgdGhlIHN0cmluZyBieSBzcGFjZXMgdG8gZ2V0IGluZGl2aWR1YWwgbW92ZXMNCiAgICAgICAgICAgIGNvbnN0IG5vdGF0aW9uID0gbm90YXRpb25TdHJpbmcuc3BsaXQoJyAnKS5maWx0ZXIobW92ZSA9PiBtb3ZlLnRyaW0oKSAhPT0gJycpOw0KICAgICAgICAgICAgLy8gQ2FsbCBleGlzdGluZyBmdW5jdGlvbiB0byBhZGQgdGhlIGxpbmUNCiAgICAgICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tTm90YXRpb24obm90YXRpb24sIHdlaWdodHMpOw0KICAgICAgICB9KTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDb252ZXJ0IGNvb3JkaW5hdGUtYmFzZWQgbW92ZXMgdG8gdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbg0KICAgICAqIEBwYXJhbSBib2FyZEhpc3RvcnkgQXJyYXkgb2YgYm9hcmQgc3RhdGVzIHJlcHJlc2VudGluZyB0aGUgZ2FtZSBoaXN0b3J5DQogICAgICogQHBhcmFtIG1vdmVIaXN0b3J5IEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0DQogICAgICogQHJldHVybnMgQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uDQogICAgICovDQogICAgbW92ZXNUb05vdGF0aW9uKGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkpIHsNCiAgICAgICAgY29uc3Qgbm90YXRpb24gPSBbXTsNCiAgICAgICAgbGV0IGN1cnJlbnRDb2xvciA9ICdyZWQnOyAvLyBSZWQgbW92ZXMgZmlyc3QNCg0KICAgICAgICAvLyBUeXBlIHRvIHBpZWNlIGNoYXJhY3RlciBtYXBwaW5nDQogICAgICAgIGNvbnN0IHR5cGVUb1BpZWNlID0gew0KICAgICAgICAgICAgJ2dlbmVyYWwnOiB7ICdyZWQnOiAn5biFJywgJ2JsYWNrJzogJ+WwhicgfSwNCiAgICAgICAgICAgICdhZHZpc29yJzogeyAncmVkJzogJ+S7lScsICdibGFjayc6ICflo6snIH0sDQogICAgICAgICAgICAnZWxlcGhhbnQnOiB7ICdyZWQnOiAn55u4JywgJ2JsYWNrJzogJ+ixoScgfSwNCiAgICAgICAgICAgICdob3JzZSc6IHsgJ3JlZCc6ICfpqawnLCAnYmxhY2snOiAn6amsJyB9LA0KICAgICAgICAgICAgJ2NoYXJpb3QnOiB7ICdyZWQnOiAn6L2mJywgJ2JsYWNrJzogJ+i9picgfSwNCiAgICAgICAgICAgICdjYW5ub24nOiB7ICdyZWQnOiAn54KuJywgJ2JsYWNrJzogJ+eCricgfSwNCiAgICAgICAgICAgICdzb2xkaWVyJzogeyAncmVkJzogJ+WFtScsICdibGFjayc6ICfljZInIH0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDb2x1bW4gbWFwcGluZyAoY29vcmRpbmF0ZSAwLTggdG8gdHJhZGl0aW9uYWwg5LmdLeS4gCBmb3IgcmVkLCA5LTEgZm9yIGJsYWNrKQ0KICAgICAgICBjb25zdCBjb2xUb0NoaW5lc2UgPSBbJ+S5nScsICflhasnLCAn5LiDJywgJ+WFrScsICfkupQnLCAn5ZubJywgJ+S4iScsICfkuownLCAn5LiAJ107DQogICAgICAgIGNvbnN0IGNvbFRvQXJhYmljID0gWyc5JywgJzgnLCAnNycsICc2JywgJzUnLCAnNCcsICczJywgJzInLCAnMSddOw0KDQogICAgICAgIC8vIERpZ2l0IHRvIENoaW5lc2UgbnVtYmVyIG1hcHBpbmcgZm9yIHN0ZXBzDQogICAgICAgIGNvbnN0IGRpZ2l0VG9DaGluZXNlID0gWycnLCAn5LiAJywgJ+S6jCcsICfkuIknLCAn5ZubJywgJ+S6lCcsICflha0nLCAn5LiDJywgJ+WFqycsICfkuZ0nXTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY2hlY2sgaWYgdGhlcmUgYXJlIG11bHRpcGxlIHNhbWUtdHlwZSBwaWVjZXMgaW4gdGhlIHNhbWUgY29sdW1uDQogICAgICAgIGNvbnN0IGhhc1NhbWVUeXBlSW5Db2x1bW4gPSAoYm9hcmQsIHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgZXhjbHVkZVJvdykgPT4gew0KICAgICAgICAgICAgbGV0IGNvdW50ID0gMDsNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY29sXTsNCiAgICAgICAgICAgICAgICBpZiAociA9PT0gZXhjbHVkZVJvdykgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09IHBpZWNlVHlwZSAmJiBwaWVjZS5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgY291bnQrKzsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICByZXR1cm4gY291bnQgPiAwOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBkZXRlcm1pbmUgZnJvbnQvYmFjayBtYXJrZXINCiAgICAgICAgY29uc3QgZ2V0RnJvbnRCYWNrTWFya2VyID0gKGJvYXJkLCBwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGN1cnJlbnRSb3cpID0+IHsNCiAgICAgICAgICAgIGNvbnN0IHNhbWVUeXBlUGllY2VzID0gW107DQogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NvbF07DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09IHBpZWNlVHlwZSAmJiBwaWVjZS5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgc2FtZVR5cGVQaWVjZXMucHVzaChyKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAoc2FtZVR5cGVQaWVjZXMubGVuZ3RoIDw9IDEpIHJldHVybiAnJzsNCiAgICAgICAgICAgIGlmIChjb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIhyPTctOe+8ie+8jHLlgLzotorlpKfotorpnaDov5HmlYzmlrnvvIzmmK8i5YmNIg0KICAgICAgICAgICAgICAgIGNvbnN0IHNvcnRlZFJvd3MgPSBbLi4uc2FtZVR5cGVQaWVjZXNdLnNvcnQoKGEsIGIpID0+IGIgLSBhKTsgLy8gSGlnaGVyIHJvd3MgZmlyc3QgPSBjbG9zZXIgdG8gb3Bwb25lbnQNCiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkUm93c1swXSA9PT0gY3VycmVudFJvdyA/ICfliY0nIDogJ+WQjic7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8iHI9MC0y77yJ77yMcuWAvOi2iuWwj+i2iumdoOi/keaVjOaWue+8jOaYryLliY0iDQogICAgICAgICAgICAgICAgY29uc3Qgc29ydGVkUm93cyA9IFsuLi5zYW1lVHlwZVBpZWNlc10uc29ydCgoYSwgYikgPT4gYSAtIGIpOyAvLyBMb3dlciByb3dzIGZpcnN0ID0gY2xvc2VyIHRvIG9wcG9uZW50DQogICAgICAgICAgICAgICAgcmV0dXJuIHNvcnRlZFJvd3NbMF0gPT09IGN1cnJlbnRSb3cgPyAn5YmNJyA6ICflkI4nOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIFByb2Nlc3MgZWFjaCBtb3ZlDQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW92ZUhpc3RvcnkubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IG1vdmUgPSBtb3ZlSGlzdG9yeVtpXTsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkQmVmb3JlID0gYm9hcmRIaXN0b3J5W2ldOw0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZEJlZm9yZVttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoIXBpZWNlKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gcGllY2UgZm91bmQgYXQgZnJvbSBwb3NpdGlvbjonLCBtb3ZlLmZyb20pOw0KICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZS50eXBlOw0KICAgICAgICAgICAgY29uc3QgcGllY2VDaGFyID0gdHlwZVRvUGllY2VbcGllY2VUeXBlXVtwaWVjZS5jb2xvcl07DQogICAgICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUgYXJlIG11bHRpcGxlIHNhbWUtdHlwZSBwaWVjZXMgaW4gdGhlIHNhbWUgY29sdW1uDQogICAgICAgICAgICBjb25zdCBoYXNEdXBsaWNhdGUgPSBoYXNTYW1lVHlwZUluQ29sdW1uKGJvYXJkQmVmb3JlLCBwaWVjZVR5cGUsIHBpZWNlLmNvbG9yLCBtb3ZlLmZyb20uYywgbW92ZS5mcm9tLnIpOw0KICAgICAgICAgICAgLy8gR2V0IGZyb250L2JhY2sgbWFya2VyIGlmIG5lZWRlZA0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25NYXJrZXIgPSBoYXNEdXBsaWNhdGUgPyBnZXRGcm9udEJhY2tNYXJrZXIoYm9hcmRCZWZvcmUsIHBpZWNlVHlwZSwgcGllY2UuY29sb3IsIG1vdmUuZnJvbS5jLCBtb3ZlLmZyb20ucikgOiAnJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gRGV0ZXJtaW5lIG5vdGF0aW9uIGJhc2VkIG9uIHBpZWNlIHR5cGUgYW5kIG1vdmUgZGlyZWN0aW9uDQogICAgICAgICAgICBsZXQgbm90YXRpb25TdHI7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdob3JzZScgfHwgcGllY2VUeXBlID09PSAnYWR2aXNvcicgfHwgcGllY2VUeXBlID09PSAnZWxlcGhhbnQnKSB7DQogICAgICAgICAgICAgICAgLy8gRGlhZ29uYWwgbW92aW5nIHBpZWNlcyAtIG9ubHkgdXNlIOi/my/pgIAsIHJlY29yZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6L+b77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSBtb3ZlLnRvLnIgPiBtb3ZlLmZyb20uciA/ICfov5snIDogJ+mAgCc7DQogICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnku47lj7PlvoDlt6bmmK8xLTnvvIzpnIDopoHlj43ovazliJfmmKDlsIQNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8iHI9MO+8ie+8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/ov5vvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IG1vdmUudG8uciA8IG1vdmUuZnJvbS5yID8gJ+i/mycgOiAn6YCAJzsNCiAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcgfHwgcGllY2VUeXBlID09PSAnY2hhcmlvdCcgfHwgcGllY2VUeXBlID09PSAnY2Fubm9uJyB8fCBwaWVjZVR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIC8vIFN0cmFpZ2h0IG1vdmluZyBwaWVjZXMgLSDov5sv6YCAL+W5sw0KICAgICAgICAgICAgICAgIGlmIChtb3ZlLmZyb20uYyA9PT0gbW92ZS50by5jKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIG1vdmUgLSDov5sv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXBzID0gTWF0aC5hYnMobW92ZS50by5yIC0gbW92ZS5mcm9tLnIpOw0KICAgICAgICAgICAgICAgICAgICAvLyDov5vmmK/pnaDov5HmlYzmlrnnmoTmlrnlkJHvvIzpgIDmmK/ov5znprvmlYzmlrnnmoTmlrnlkJENCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+i/m++8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+i/m++8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gKGlzUmVkID8gbW92ZS50by5yID4gbW92ZS5mcm9tLnIgOiBtb3ZlLnRvLnIgPCBtb3ZlLmZyb20ucikgPyAn6L+bJyA6ICfpgIAnOw0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBzdGVwcyBpcyBhIHZhbGlkIG51bWJlciBiZXR3ZWVuIDEtOQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsaWRTdGVwcyA9IE1hdGgubWF4KDEsIE1hdGgubWluKDksIE1hdGgucm91bmQoc3RlcHMgfHwgMSkpKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7ZGlnaXRUb0NoaW5lc2VbdmFsaWRTdGVwc10gfHwgJyd9YDsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhA0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY107DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgc3RlcHMgaXMgYSB2YWxpZCBudW1iZXINCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkU3RlcHMgPSBNYXRoLnJvdW5kKHN0ZXBzIHx8IDEpOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt2YWxpZFN0ZXBzfWA7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIG1vdmUgLSDlubMNCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9DaGluZXNlW21vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH3lubMke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnku47lj7PlvoDlt6bmmK8xLTnvvIzpnIDopoHlj43ovazliJfmmKDlsIQNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfeW5syR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignVW5rbm93biBwaWVjZSB0eXBlOicsIHBpZWNlVHlwZSk7DQogICAgICAgICAgICAgICAgY29udGludWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIG5vdGF0aW9uLnB1c2gobm90YXRpb25TdHIpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBTd2l0Y2ggY29sb3IgZm9yIG5leHQgbW92ZQ0KICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgcmV0dXJuIG5vdGF0aW9uOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENvbnZlcnQgdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbiB0byBjb29yZGluYXRlIG1vdmVzDQogICAgICogQHBhcmFtIG5vdGF0aW9uIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbg0KICAgICAqIEByZXR1cm5zIEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0DQogICAgICovDQogICAgbm90YXRpb25Ub01vdmVzKG5vdGF0aW9uLCBpbml0aWFsQm9hcmQgPSBudWxsKSB7DQogICAgICAgIC8vIOehruS/nW5vdGF0aW9u5piv5pWw57uE5LiU5LiN5Li656m6DQogICAgICAgIGlmICghbm90YXRpb24gfHwgIUFycmF5LmlzQXJyYXkobm90YXRpb24pIHx8IG5vdGF0aW9uLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgcmV0dXJuIFtdOw0KICAgICAgICB9DQogICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgIGxldCBjdXJyZW50Q29sb3IgPSAncmVkJzsgLy8gUmVkIG1vdmVzIGZpcnN0DQoNCiAgICAgICAgLy8gUGllY2UgY2hhcmFjdGVyIHRvIHR5cGUgbWFwcGluZw0KICAgICAgICBjb25zdCBwaWVjZU1hcCA9IHsNCiAgICAgICAgICAgICflsIYnOiAnZ2VuZXJhbCcsICfluIUnOiAnZ2VuZXJhbCcsDQogICAgICAgICAgICAn5aOrJzogJ2Fkdmlzb3InLCAn5LuVJzogJ2Fkdmlzb3InLA0KICAgICAgICAgICAgJ+ixoSc6ICdlbGVwaGFudCcsICfnm7gnOiAnZWxlcGhhbnQnLA0KICAgICAgICAgICAgJ+mprCc6ICdob3JzZScsDQogICAgICAgICAgICAn6L2mJzogJ2NoYXJpb3QnLA0KICAgICAgICAgICAgJ+eCric6ICdjYW5ub24nLA0KICAgICAgICAgICAgJ+WNkic6ICdzb2xkaWVyJywgJ+WFtSc6ICdzb2xkaWVyJw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENvbHVtbiBtYXBwaW5nICh0cmFkaXRpb25hbCBub3RhdGlvbiB1c2VzIDEtOSBmcm9tIHJpZ2h0IHRvIGxlZnQpDQogICAgICAgIGNvbnN0IGNvbE1hcCA9IHsNCiAgICAgICAgICAgICfkuIAnOiA4LCAnMSc6IDgsDQogICAgICAgICAgICAn5LqMJzogNywgJzInOiA3LA0KICAgICAgICAgICAgJ+S4iSc6IDYsICczJzogNiwNCiAgICAgICAgICAgICflm5snOiA1LCAnNCc6IDUsDQogICAgICAgICAgICAn5LqUJzogNCwgJzUnOiA0LA0KICAgICAgICAgICAgJ+WFrSc6IDMsICc2JzogMywNCiAgICAgICAgICAgICfkuIMnOiAyLCAnNyc6IDIsDQogICAgICAgICAgICAn5YWrJzogMSwgJzgnOiAxLA0KICAgICAgICAgICAgJ+S5nSc6IDAsICc5JzogMA0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENoaW5lc2UgbnVtYmVyIHRvIGRpZ2l0IG1hcHBpbmcNCiAgICAgICAgY29uc3QgY2hpbmVzZU51bWJlck1hcCA9IHsNCiAgICAgICAgICAgICfkuIAnOiAxLCAnMSc6IDEsDQogICAgICAgICAgICAn5LqMJzogMiwgJzInOiAyLA0KICAgICAgICAgICAgJ+S4iSc6IDMsICczJzogMywNCiAgICAgICAgICAgICflm5snOiA0LCAnNCc6IDQsDQogICAgICAgICAgICAn5LqUJzogNSwgJzUnOiA1LA0KICAgICAgICAgICAgJ+WFrSc6IDYsICc2JzogNiwNCiAgICAgICAgICAgICfkuIMnOiA3LCAnNyc6IDcsDQogICAgICAgICAgICAn5YWrJzogOCwgJzgnOiA4LA0KICAgICAgICAgICAgJ+S5nSc6IDksICc5JzogOQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEluaXRpYWwgcG9zaXRpb25zIG9mIHBpZWNlcyAocmVkIGFuZCBibGFjaykNCiAgICAgICAgLy8g5L+u5aSN77ya5LiO5paw5Z2Q5qCH57O757uf5L+d5oyB5LiA6Ie077yM57qi5pa55Zyo5bqV6YOo77yIcj0wLTLvvInvvIzpu5HmlrnlnKjpobbpg6jvvIhyPTctOe+8iQ0KICAgICAgICBjb25zdCBkZWZhdWx0SW5pdGlhbFBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICdyZWQtZ2VuZXJhbCc6IHsgcjogMCwgYzogNCB9LA0KICAgICAgICAgICAgJ3JlZC1hZHZpc29yJzogW3sgcjogMCwgYzogMyB9LCB7IHI6IDAsIGM6IDUgfV0sDQogICAgICAgICAgICAncmVkLWVsZXBoYW50JzogW3sgcjogMCwgYzogMiB9LCB7IHI6IDAsIGM6IDYgfV0sDQogICAgICAgICAgICAncmVkLWhvcnNlJzogW3sgcjogMCwgYzogMSB9LCB7IHI6IDAsIGM6IDcgfV0sDQogICAgICAgICAgICAncmVkLWNoYXJpb3QnOiBbeyByOiAwLCBjOiAwIH0sIHsgcjogMCwgYzogOCB9XSwNCiAgICAgICAgICAgICdyZWQtY2Fubm9uJzogW3sgcjogMiwgYzogMSB9LCB7IHI6IDIsIGM6IDcgfV0sDQogICAgICAgICAgICAncmVkLXNvbGRpZXInOiBbeyByOiAzLCBjOiAwIH0sIHsgcjogMywgYzogMiB9LCB7IHI6IDMsIGM6IDQgfSwgeyByOiAzLCBjOiA2IH0sIHsgcjogMywgYzogOCB9XSwNCiAgICAgICAgICAgICdibGFjay1nZW5lcmFsJzogeyByOiA5LCBjOiA0IH0sDQogICAgICAgICAgICAnYmxhY2stYWR2aXNvcic6IFt7IHI6IDksIGM6IDMgfSwgeyByOiA5LCBjOiA1IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWVsZXBoYW50JzogW3sgcjogOSwgYzogMiB9LCB7IHI6IDksIGM6IDYgfV0sDQogICAgICAgICAgICAnYmxhY2staG9yc2UnOiBbeyByOiA5LCBjOiAxIH0sIHsgcjogOSwgYzogNyB9XSwNCiAgICAgICAgICAgICdibGFjay1jaGFyaW90JzogW3sgcjogOSwgYzogMCB9LCB7IHI6IDksIGM6IDggfV0sDQogICAgICAgICAgICAnYmxhY2stY2Fubm9uJzogW3sgcjogNywgYzogMSB9LCB7IHI6IDcsIGM6IDcgfV0sDQogICAgICAgICAgICAnYmxhY2stc29sZGllcic6IFt7IHI6IDYsIGM6IDAgfSwgeyByOiA2LCBjOiAyIH0sIHsgcjogNiwgYzogNCB9LCB7IHI6IDYsIGM6IDYgfSwgeyByOiA2LCBjOiA4IH1dDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gVHJhY2sgcGllY2UgcG9zaXRpb25zIGFzIG1vdmVzIGFyZSBtYWRlDQogICAgICAgIGxldCBwaWVjZVBvc2l0aW9ucyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoZGVmYXVsdEluaXRpYWxQb3NpdGlvbnMpKTsNCiAgICAgICAgDQogICAgICAgIC8vIElmIGluaXRpYWwgYm9hcmQgaXMgcHJvdmlkZWQsIGluaXRpYWxpemUgcGllY2UgcG9zaXRpb25zIGZyb20gaXQNCiAgICAgICAgaWYgKGluaXRpYWxCb2FyZCkgew0KICAgICAgICAgICAgLy8gUmVzZXQgcGllY2UgcG9zaXRpb25zIGJhc2VkIG9uIGluaXRpYWwgYm9hcmQNCiAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgICdyZWQtZ2VuZXJhbCc6IHsgcjogLTEsIGM6IC0xIH0sDQogICAgICAgICAgICAgICAgJ3JlZC1hZHZpc29yJzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1lbGVwaGFudCc6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtaG9yc2UnOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWNoYXJpb3QnOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWNhbm5vbic6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtc29sZGllcic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1nZW5lcmFsJzogeyByOiAtMSwgYzogLTEgfSwNCiAgICAgICAgICAgICAgICAnYmxhY2stYWR2aXNvcic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1lbGVwaGFudCc6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1ob3JzZSc6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1jaGFyaW90JzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWNhbm5vbic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1zb2xkaWVyJzogW10NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFBvcHVsYXRlIHBpZWNlIHBvc2l0aW9ucyBmcm9tIGluaXRpYWwgYm9hcmQNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gaW5pdGlhbEJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke3BpZWNlLmNvbG9yfS0ke3BpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1trZXldID0geyByLCBjIH07DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2tleV0ucHVzaCh7IHIsIGMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZmluZCBwaWVjZSBwb3NpdGlvbg0KICAgICAgICBjb25zdCBmaW5kUGllY2VQb3NpdGlvbiA9IChwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGRpcmVjdGlvbiwgZnJvbnRCYWNrTWFya2VyID0gbnVsbCkgPT4gew0KICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7Y29sb3J9LSR7cGllY2VUeXBlfWA7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1trZXldOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiBwb3NpdGlvbnMgZXhpc3QgYW5kIGFyZSB2YWxpZA0KICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBwb3NpdGlvbnMgZm91bmQgZm9yIHBpZWNlOicsIGtleSk7DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgIHJldHVybiBwb3NpdGlvbnM7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEZpbmQgcGllY2VzIG9uIHRoZSBzcGVjaWZpZWQgY29sdW1uDQogICAgICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gcG9zaXRpb25zLmZpbHRlcihwb3MgPT4gcG9zLmMgPT09IGNvbCk7DQoNCiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIGNhbmRpZGF0ZXMgZm91bmQgZm9yIHBpZWNlOicsIGtleSwgJ29uIGNvbHVtbjonLCBjb2wpOw0KICAgICAgICAgICAgICAgIC8vIEFkZGl0aW9uYWwgZGVidWcgaW5mbyBmb3IgY2Fubm9uDQogICAgICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2Nhbm5vbicgJiYgY29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0RFQlVHOiBDYW5kaWRhdGVzIGFmdGVyIGZpbHRlcjonLCBjYW5kaWRhdGVzKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMSkgew0KICAgICAgICAgICAgICAgIHJldHVybiBjYW5kaWRhdGVzWzBdOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBJZiBmcm9udC9iYWNrIG1hcmtlciBpcyBwcm92aWRlZCwgdXNlIGl0IHRvIGRldGVybWluZSB0aGUgcGllY2UNCiAgICAgICAgICAgIGlmIChmcm9udEJhY2tNYXJrZXIgPT09ICfliY0nKSB7DQogICAgICAgICAgICAgICAgLy8g5YmN54Ku77ya6Z2g6L+R5pWM5pa555qE5qOL5a2QDQogICAgICAgICAgICAgICAgLy8g57qi5pa577yacuWAvOi+g+Wkp+eahOabtOmdoOi/keaVjOaWue+8iOWJje+8iQ0KICAgICAgICAgICAgICAgIC8vIOm7keaWue+8mnLlgLzovoPlsI/nmoTmm7TpnaDov5HmlYzmlrnvvIjliY3vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfSBlbHNlIGlmIChmcm9udEJhY2tNYXJrZXIgPT09ICflkI4nKSB7DQogICAgICAgICAgICAgICAgLy8g5ZCO54Ku77ya6Z2g6L+R5bex5pa555qE5qOL5a2QDQogICAgICAgICAgICAgICAgLy8g57qi5pa577yacuWAvOi+g+Wwj+eahOabtOmdoOi/keW3seaWue+8iOWQju+8iQ0KICAgICAgICAgICAgICAgIC8vIOm7keaWue+8mnLlgLzovoPlpKfnmoTmm7TpnaDov5Hlt7HmlrnvvIjlkI7vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBJZiBtdWx0aXBsZSBwaWVjZXMgb24gdGhlIHNhbWUgY29sdW1uIGFuZCBubyBtYXJrZXIsIGRldGVybWluZSBiYXNlZCBvbiBkaXJlY3Rpb24NCiAgICAgICAgICAgIC8vIOWvueS6juWQjOS4gOWIl+eahOaji+WtkO+8jOmAmui/h+avlOi+g3LlgLzmnaXljLrliIYNCiAgICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT09ICfov5snKSB7DQogICAgICAgICAgICAgICAgLy8g6L+b5piv5ZCR5pWM5pa55pa55ZCR56e75Yqo77yM5omA5Lul6YCJ5oup5pu06Z2g6L+R5bex5pa555qE5qOL5a2Q77yI5ZCO77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoZGlyZWN0aW9uID09PSAn6YCAJykgew0KICAgICAgICAgICAgICAgIC8vIOmAgOaYr+WQkeW3seaWueaWueWQkeenu+WKqO+8jOaJgOS7pemAieaLqeabtOmdoOi/keaVjOaWueeahOaji+WtkO+8iOWJje+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIHJldHVybiBjYW5kaWRhdGVzWzBdOyAvLyBEZWZhdWx0IHRvIGZpcnN0IGlmIGRpcmVjdGlvbiBpcyAn5bmzJyBhbmQgbm8gbWFya2VyDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIHVwZGF0ZSBwaWVjZSBwb3NpdGlvbg0KICAgICAgICBjb25zdCB1cGRhdGVQaWVjZVBvc2l0aW9uID0gKHBpZWNlVHlwZSwgY29sb3IsIG9sZFBvcywgbmV3UG9zKSA9PiB7DQogICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtjb2xvcn0tJHtwaWVjZVR5cGV9YDsNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2tleV07DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHBvc2l0aW9ucyBleGlzdCBhbmQgYXJlIHZhbGlkDQogICAgICAgICAgICBpZiAoIXBvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogTm8gcG9zaXRpb25zIGZvdW5kIGZvciBwaWVjZTonLCBrZXkpOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zLnIgPSBuZXdQb3MucjsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnMuYyA9IG5ld1Bvcy5jOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgY29uc3QgaW5kZXggPSBwb3NpdGlvbnMuZmluZEluZGV4KHBvcyA9PiBwb3MuciA9PT0gb2xkUG9zLnIgJiYgcG9zLmMgPT09IG9sZFBvcy5jKTsNCiAgICAgICAgICAgIGlmIChpbmRleCAhPT0gLTEpIHsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnNbaW5kZXhdLnIgPSBuZXdQb3MucjsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnNbaW5kZXhdLmMgPSBuZXdQb3MuYzsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBDb3VsZCBub3QgZmluZCBwaWVjZSBwb3NpdGlvbiB0byB1cGRhdGU6Jywgb2xkUG9zLCAnaW4nLCBwb3NpdGlvbnMpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiBwb3NpdGlvbiBpcyB2YWxpZA0KICAgICAgICBjb25zdCBpc1ZhbGlkUG9zID0gKHIsIGMpID0+IHIgPj0gMCAmJiByIDwgMTAgJiYgYyA+PSAwICYmIGMgPCA5Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgaG9yc2UgbW92ZXMNCiAgICAgICAgY29uc3QgZ2V0SG9yc2VNb3ZlcyA9IChwb3MpID0+IHsNCiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107DQogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgZHI6IC0yLCBkYzogLTEgfSwgeyBkcjogLTIsIGRjOiAxIH0sDQogICAgICAgICAgICAgICAgeyBkcjogLTEsIGRjOiAtMiB9LCB7IGRyOiAtMSwgZGM6IDIgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAxLCBkYzogLTIgfSwgeyBkcjogMSwgZGM6IDIgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAyLCBkYzogLTEgfSwgeyBkcjogMiwgZGM6IDEgfQ0KICAgICAgICAgICAgXTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGhvcnNlIGNhbiBtb3ZlIGluIHRoZSBkaXJlY3Rpb24NCiAgICAgICAgICAgIGNvbnN0IGNhbk1vdmUgPSAoYmxvY2tlZFIsIGJsb2NrZWRDKSA9PiB7DQogICAgICAgICAgICAgICAgaWYgKCFpc1ZhbGlkUG9zKHIgKyBibG9ja2VkUiwgYyArIGJsb2NrZWRDKSkgcmV0dXJuIGZhbHNlOw0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfTsNCg0KICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9LCBpbmRleCkgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IGJsb2NrZWRSID0gZHIgPiAwID8gMSA6IGRyIDwgMCA/IC0xIDogMDsNCiAgICAgICAgICAgICAgICBjb25zdCBibG9ja2VkQyA9IGRjID4gMCA/IDEgOiBkYyA8IDAgPyAtMSA6IDA7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHBhdGggaXMgYmxvY2tlZA0KICAgICAgICAgICAgICAgIGlmICgoaW5kZXggPCAyIHx8IGluZGV4ID49IDYpICYmIGJsb2NrZWRSICE9PSAwKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIGJsb2NrZWQNCiAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5Nb3ZlKGJsb2NrZWRSLCAwKSkgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoYmxvY2tlZEMgIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBibG9ja2VkDQogICAgICAgICAgICAgICAgICAgIGlmICghY2FuTW92ZSgwLCBibG9ja2VkQykpIHJldHVybjsNCiAgICAgICAgICAgICAgICB9DQoNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7DQogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobmV3UiwgbmV3QykpIHsNCiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSk7DQoNCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGVsZXBoYW50IG1vdmVzDQogICAgICAgIGNvbnN0IGdldEVsZXBoYW50TW92ZXMgPSAocG9zLCBjb2xvcikgPT4gew0KICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyBkcjogLTIsIGRjOiAtMiB9LCB7IGRyOiAtMiwgZGM6IDIgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAyLCBkYzogLTIgfSwgeyBkcjogMiwgZGM6IDIgfQ0KICAgICAgICAgICAgXTsNCg0KICAgICAgICAgICAgLy8gRWxlcGhhbnQncyB0ZXJyaXRvcnkgLSByZWQgZWxlcGhhbnRzIGNhbiBvbmx5IGJlIGluIHI8PTQsIGJsYWNrIGVsZXBoYW50cyBpbiByPj01DQogICAgICAgICAgICBjb25zdCBpc0luVGVycml0b3J5ID0gKHIpID0+IHsNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gciA8PSA0IDogciA+PSA1Ow0KICAgICAgICAgICAgfTsNCg0KICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9KSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgbWlkUiA9IHIgKyBkciAvIDI7DQogICAgICAgICAgICAgICAgY29uc3QgbWlkQyA9IGMgKyBkYyAvIDI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOw0KDQogICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgbWlkIHBvc2l0aW9uIGlzIGVtcHR5IGFuZCBuZXcgcG9zaXRpb24gaXMgdmFsaWQNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhtaWRSLCBtaWRDKSAmJiBpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpICYmIGlzSW5UZXJyaXRvcnkobmV3UikpIHsNCiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSk7DQoNCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGFkdmlzb3IgbW92ZXMNCiAgICAgICAgY29uc3QgZ2V0QWR2aXNvck1vdmVzID0gKHBvcywgY29sb3IpID0+IHsNCiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107DQogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgZHI6IC0xLCBkYzogLTEgfSwgeyBkcjogLTEsIGRjOiAxIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMSwgZGM6IC0xIH0sIHsgZHI6IDEsIGRjOiAxIH0NCiAgICAgICAgICAgIF07DQoNCiAgICAgICAgICAgIC8vIEFkdmlzb3IncyB0ZXJyaXRvcnkgKHBhbGFjZSkgLSByZWQgYWR2aXNvcnMgaW4gcj0wLTIsYz0zLTUsIGJsYWNrIGFkdmlzb3JzIGluIHI9Ny05LGM9My01DQogICAgICAgICAgICBjb25zdCBpc0luUGFsYWNlID0gKHIsIGMpID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCByUmFuZ2UgPSBjb2xvciA9PT0gJ3JlZCcgPyBbMCwgMl0gOiBbNywgOV07DQogICAgICAgICAgICAgICAgcmV0dXJuIHIgPj0gclJhbmdlWzBdICYmIHIgPD0gclJhbmdlWzFdICYmIGMgPj0gMyAmJiBjIDw9IDU7DQogICAgICAgICAgICB9Ow0KDQogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0pID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7DQogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobmV3UiwgbmV3QykgJiYgaXNJblBhbGFjZShuZXdSLCBuZXdDKSkgew0KICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCg0KICAgICAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBib2FyZCB0byB0cmFjayBtb3Zlcw0KICAgICAgICBsZXQgdGVtcEJvYXJkID0gdGhpcy5jcmVhdGVJbml0aWFsQm9hcmQoKTsNCiAgICAgICAgDQogICAgICAgIC8vIEVuc3VyZSB0ZW1wQm9hcmQgaXMgcHJvcGVybHkgaW5pdGlhbGl6ZWQNCiAgICAgICAgaWYgKCF0ZW1wQm9hcmQgfHwgdGVtcEJvYXJkLmxlbmd0aCAhPT0gMTApIHsNCiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgYm9hcmQgaW5pdGlhbGl6YXRpb24nKTsNCiAgICAgICAgICAgIHJldHVybiBbXTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy8gVmVyaWZ5IGFsbCByb3dzIGhhdmUgOSBjb2x1bW5zDQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTA7IGkrKykgew0KICAgICAgICAgICAgaWYgKCF0ZW1wQm9hcmRbaV0gfHwgdGVtcEJvYXJkW2ldLmxlbmd0aCAhPT0gOSkgew0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtpXSA9IEFycmF5KDkpLmZpbGwobnVsbCk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICBjb25zb2xlLmxvZygnVG90YWwgbW92ZXM6Jywgbm90YXRpb24ubGVuZ3RoKTsNCiAgICAgICAgbm90YXRpb24uZm9yRWFjaChtb3ZlTm90YXRpb24gPT4gew0KDQoNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gUGFyc2UgdGhlIG1vdmUgbm90YXRpb24gLSBrZWVwIGxhc3QgZ3JvdXAgb3B0aW9uYWwNCiAgICAgICAgICAgIGNvbnN0IHJlZ2V4ID0gLyhb5YmN5ZCOXSk/KFvlsIbluIXlo6vku5XosaHnm7jpqazovabngq7lhbXljZJdKShb5LiA5LqM5LiJ5Zub5LqU5YWt5LiD5YWr5LmdMTIzNDU2Nzg5XSkoW+i/m+mAgOW5s10pKFvkuIDkuozkuInlm5vkupTlha3kuIPlhavkuZ0xMjM0NTY3ODldKT8vOw0KICAgICAgICAgICAgY29uc3QgbWF0Y2ggPSBtb3ZlTm90YXRpb24ubWF0Y2gocmVnZXgpOw0KDQogICAgICAgICAgICBpZiAoIW1hdGNoKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBtb3ZlIG5vdGF0aW9uOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCBbLCBmcm9udEJhY2tNYXJrZXIsIHBpZWNlQ2hhciwgZnJvbUNvbE5vdGF0aW9uLCBkaXJlY3Rpb24sIHRvQ29sT3JTdGVwTm90YXRpb25dID0gbWF0Y2g7DQogICAgICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZU1hcFtwaWVjZUNoYXJdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBHZXQgY29sdW1uIG1hcHBpbmcgYmFzZWQgb24gY3VycmVudCBjb2xvciAoYmxhY2sgc2VlcyBjb2x1bW5zIG1pcnJvcmVkKQ0KICAgICAgICAgICAgbGV0IGZyb21Db2wgPSBjb2xNYXBbZnJvbUNvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sgKGZyb20gYmxhY2sncyBwZXJzcGVjdGl2ZSkNCiAgICAgICAgICAgICAgICBmcm9tQ29sID0gOCAtIGZyb21Db2w7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEZpbmQgdGhlIGN1cnJlbnQgcG9zaXRpb24gb2YgdGhlIHBpZWNlDQogICAgICAgICAgICBjb25zdCBmcm9tUG9zID0gZmluZFBpZWNlUG9zaXRpb24ocGllY2VUeXBlLCBjdXJyZW50Q29sb3IsIGZyb21Db2wsIGRpcmVjdGlvbiwgZnJvbnRCYWNrTWFya2VyKTsNCg0KICAgICAgICAgICAgaWYgKCFmcm9tUG9zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignQ291bGQgbm90IGZpbmQgcGllY2UgcG9zaXRpb24gZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGxldCB0b1BvczsNCg0KICAgICAgICAgICAgaWYgKGRpcmVjdGlvbiA9PT0gJ+W5sycpIHsNCiAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIG1vdmVtZW50DQogICAgICAgICAgICAgICAgbGV0IHRvQ29sID0gY29sTWFwW3RvQ29sT3JTdGVwTm90YXRpb25dOw0KICAgICAgICAgICAgICAgIGlmICh0b0NvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbjonLCB0b0NvbE9yU3RlcE5vdGF0aW9uLCAnZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sgd2hlbiBtb3ZpbmcgaG9yaXpvbnRhbGx5DQogICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICB0b0NvbCA9IDggLSB0b0NvbDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgdG9Qb3MgPSB7IHI6IGZyb21Qb3MuciwgYzogdG9Db2wgfTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8gVmVydGljYWwgb3IgZGlhZ29uYWwgbW92ZW1lbnQNCiAgICAgICAgICAgICAgICBjb25zdCBzdGVwcyA9IGNoaW5lc2VOdW1iZXJNYXBbdG9Db2xPclN0ZXBOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoc3RlcHMgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHN0ZXAgY291bnQ6JywgdG9Db2xPclN0ZXBOb3RhdGlvbiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICB9DQoNCiAgICAgICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnaG9yc2UnKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEhvcnNlIG1vdmVzIGluIEwtc2hhcGUNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEhvcnNlTW92ZXMoZnJvbVBvcyk7DQogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247DQogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgaG9yc2U6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjaw0KICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdlbGVwaGFudCcpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gRWxlcGhhbnQgbW92ZXMgZGlhZ29uYWxseSAyIHN0ZXBzDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRFbGVwaGFudE1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7DQogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247DQogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgZWxlcGhhbnQ6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjaw0KICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdhZHZpc29yJykgew0KICAgICAgICAgICAgICAgICAgICAvLyBBZHZpc29yIG1vdmVzIGRpYWdvbmFsbHkgMSBzdGVwDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRBZHZpc29yTW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsNCiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvbE5vdGF0aW9uID0gdG9Db2xPclN0ZXBOb3RhdGlvbjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uIGZvciBhZHZpc29yOicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sNCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIFN0cmFpZ2h0IGxpbmUgbW92ZW1lbnQgKGNoYXJpb3QsIGNhbm5vbiwgc29sZGllcikNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RlcCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyAoY3VycmVudENvbG9yID09PSAncmVkJyA/IDEgOiAtMSkgKiBzdGVwcyA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IC0xIDogMSkgKiBzdGVwczsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IGZyb21Qb3MuciArIHN0ZXA7DQogICAgICAgICAgICAgICAgICAgIGlmIChuZXdSIDwgMCB8fCBuZXdSID49IDEwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHJvdyBwb3NpdGlvbiBhZnRlciBtb3ZlOicsIG5ld1IsICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0geyByOiBuZXdSLCBjOiBmcm9tUG9zLmMgfTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmICghdG9Qb3MpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZGV0ZXJtaW5lIHRhcmdldCBwb3NpdGlvbiBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gQWRkIHRoZSBtb3ZlIHRvIHRoZSBsaXN0DQogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgZnJvbTogeyByOiBmcm9tUG9zLnIsIGM6IGZyb21Qb3MuYyB9LCB0bzogeyByOiB0b1Bvcy5yLCBjOiB0b1Bvcy5jIH0gfSk7DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlJ3MgYSBjYXB0dXJlZCBwaWVjZQ0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRQaWVjZSA9IHRlbXBCb2FyZFt0b1Bvcy5yXVt0b1Bvcy5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gSWYgdGhlcmUncyBhIGNhcHR1cmVkIHBpZWNlLCByZW1vdmUgaXQgZnJvbSBwaWVjZVBvc2l0aW9ucw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGAke2NhcHR1cmVkUGllY2UuY29sb3J9LSR7Y2FwdHVyZWRQaWVjZS50eXBlfWA7DQogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGNhcHR1cmVkUG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWwhi/luIXkuI3kvJrooqvlkIPmjonvvIzmiYDku6Xlj6rlpITnkIblhbbku5bmo4vlrZANCiAgICAgICAgICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBSZW1vdmUgdGhlIGNhcHR1cmVkIHBvc2l0aW9uIGZyb20gdGhlIGFycmF5DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjYXB0dXJlZFBvc2l0aW9ucykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB1cGRhdGVkUG9zaXRpb25zID0gY2FwdHVyZWRQb3NpdGlvbnMuZmlsdGVyKHBvcyA9PiANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zICYmIChwb3MuciAhPT0gdG9Qb3MuciB8fCBwb3MuYyAhPT0gdG9Qb3MuYykNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XSA9IHVwZGF0ZWRQb3NpdGlvbnM7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVmVyaWZ5IHJlbW92YWwgd2FzIHN1Y2Nlc3NmdWwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGlsbEV4aXN0cyA9IHVwZGF0ZWRQb3NpdGlvbnMuc29tZShwb3MgPT4gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiBwb3MuciA9PT0gdG9Qb3MuciAmJiBwb3MuYyA9PT0gdG9Qb3MuYw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHN0aWxsRXhpc3RzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogQ2FwdHVyZWQgcGllY2Ugc3RpbGwgZXhpc3RzIGluIHBpZWNlUG9zaXRpb25zIScpOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCfinIUgU1VDQ0VTUzogQ2FwdHVyZWQgcGllY2UgcmVtb3ZlZCBmcm9tIHBpZWNlUG9zaXRpb25zJyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IFVuZXhwZWN0ZWQgbm9uLWFycmF5IHBvc2l0aW9ucyBmb3IgcGllY2U6JywgY2FwdHVyZWRLZXkpOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBObyBwb3NpdGlvbnMgZm91bmQgZm9yIGNhcHR1cmVkIHBpZWNlOicsIGNhcHR1cmVkS2V5KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFZlcmlmeSB0aGUgY2FwdHVyZWQgcGllY2UgaGFzIGJlZW4gcmVtb3ZlZA0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGAke2NhcHR1cmVkUGllY2UuY29sb3J9LSR7Y2FwdHVyZWRQaWVjZS50eXBlfWA7DQogICAgICAgICAgICAgICAgY29uc3QgZmluYWxQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07DQogICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmluYWxQb3NpdGlvbnMpKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0aWxsRXhpc3RzID0gZmluYWxQb3NpdGlvbnMuc29tZShwb3MgPT4gDQogICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgcG9zLnIgPT09IHRvUG9zLnIgJiYgcG9zLmMgPT09IHRvUG9zLmMNCiAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHN0aWxsRXhpc3RzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFUlJPUjogQ2FwdHVyZWQgcGllY2Ugc3RpbGwgZXhpc3RzIGluIHBpZWNlUG9zaXRpb25zOicsIGNhcHR1cmVkUGllY2UsICdhdCcsIHRvUG9zKTsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTVUNDRVNTOiBDYXB0dXJlZCBwaWVjZSByZW1vdmVkIGZyb20gcGllY2VQb3NpdGlvbnMnKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gTWFrZSB0aGUgbW92ZSBvbiB0aGUgdGVtcG9yYXJ5IGJvYXJkIGZpcnN0IGJlZm9yZSB1cGRhdGluZyBwaWVjZSBwb3NpdGlvbnMNCiAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKGZyb21Qb3MuciwgZnJvbVBvcy5jKSAmJiBpc1ZhbGlkUG9zKHRvUG9zLnIsIHRvUG9zLmMpICYmIA0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtmcm9tUG9zLnJdICYmIHRlbXBCb2FyZFt0b1Bvcy5yXSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gdGVtcEJvYXJkW2Zyb21Qb3Mucl1bZnJvbVBvcy5jXTsNCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbdG9Qb3Mucl1bdG9Qb3MuY10gPSBwaWVjZTsNCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbZnJvbVBvcy5yXVtmcm9tUG9zLmNdID0gbnVsbDsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBJbnZhbGlkIHBvc2l0aW9ucyBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24sIGZyb21Qb3MsIHRvUG9zKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBwaWVjZSBwb3NpdGlvbiBpbiBwaWVjZVBvc2l0aW9ucw0KICAgICAgICAgICAgdXBkYXRlUGllY2VQb3NpdGlvbihwaWVjZVR5cGUsIGN1cnJlbnRDb2xvciwgZnJvbVBvcywgdG9Qb3MpOw0KICAgICAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBTd2l0Y2ggY29sb3IgZm9yIG5leHQgbW92ZQ0KICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgfSk7DQoNCiAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgIH0NCn0NCg0KLy8gLS0tIENvbnN0YW50cyAtLS0NCg0KLy8gSW5pdGlhbGl6ZSBPcGVuaW5nIEJvb2sNCmNvbnN0IG9wZW5pbmdCb29rID0gbmV3IE9wZW5pbmdCb29rKDEyKTsNCg0KY29uc3QgaXNWYWxpZFBvcyA9IChyLCBjKSA9PiByID49IDAgJiYgciA8IFJPV1MgJiYgYyA+PSAwICYmIGMgPCBDT0xTOw0KDQovLyDmqKHlnZfnuqfkvKrlkIjms5XokL3ngrnvvIjpgb/lhY0gZ2V0UGllY2VNb3ZlcyDmr4/osIPnlKjmlrDlu7rpl63ljIXvvIkNCmNvbnN0IHB1c2hQc2V1ZG9EZXN0ID0gKGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCB0ciwgdGMpID0+IHsNCiAgaWYgKHRyIDwgMCB8fCB0ciA+PSBST1dTIHx8IHRjIDwgMCB8fCB0YyA+PSBDT0xTKSByZXR1cm47DQogIGNvbnN0IHRhcmdldCA9IGJvYXJkW3RyXVt0Y107DQogIGlmICghdGFyZ2V0IHx8IHRhcmdldC5jb2xvciAhPT0gcGllY2VDb2xvcikgew0KICAgIG1vdmVzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogIH0gZWxzZSBpZiAoYWxsaWVzT3V0ICYmIHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICBhbGxpZXNPdXQucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgfQ0KfTsNCg0KLy8gYWxsaWVzT3V0OiDlj6/pgInvvIzmlLbpm4blj6/kv53miqTnmoTlt7HmlrnokL3ngrnvvIjkuI3lkKvlsIbluIXvvInvvIzkvpvlhbPns7vorqHnrpflpI3nlKjvvIzpgb/lhY3kuozmrKHlsITnur8NCmNvbnN0IGdldFBpZWNlTW92ZXMgPSAoYm9hcmQsIHBvcywgcGllY2UsIGFsbGllc091dCA9IG51bGwpID0+IHsNCiAgY29uc3QgbW92ZXMgPSBbXTsNCiAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICBjb25zdCBwaWVjZUNvbG9yID0gcGllY2UuY29sb3I7DQogIGNvbnN0IGNvbG9ySWR4ID0gaXNSZWQgPyAwIDogMTsNCiAgY29uc3QgZnJvbVNxID0gciAqIDkgKyBjOw0KDQogIHN3aXRjaCAocGllY2UudHlwZSkgew0KICAgIGNhc2UgJ2dlbmVyYWwnOiB7DQogICAgICBjb25zdCBkZXN0cyA9IEdFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOw0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICAgIGNhc2UgJ2Fkdmlzb3InOiB7DQogICAgICBjb25zdCBkZXN0cyA9IEFEVklTT1JfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOw0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICAgIGNhc2UgJ2VsZXBoYW50Jzogew0KICAgICAgY29uc3QgZGVzdHMgPSBFTEVQSEFOVF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgIGlmIChib2FyZFtkLmJyXVtkLmJjXSA9PT0gbnVsbCkgew0KICAgICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7DQogICAgICAgIH0NCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBjYXNlICdob3JzZSc6IHsNCiAgICAgIGNvbnN0IGRlc3RzID0gSE9SU0VfREVTVFtmcm9tU3FdOw0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgIGlmIChib2FyZFtkLmJyXVtkLmJjXSA9PT0gbnVsbCkgew0KICAgICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7DQogICAgICAgIH0NCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBjYXNlICdjaGFyaW90JzoNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTKSB7DQogICAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICBpZiAodGFyZ2V0ID09PSBudWxsKSB7DQogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAodGFyZ2V0LmNvbG9yICE9PSBwaWVjZUNvbG9yKSBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgZWxzZSBpZiAoYWxsaWVzT3V0ICYmIHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIGFsbGllc091dC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgfQ0KICAgICAgICAgIG5yICs9IGRyOyBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnY2Fubm9uJzoNCiAgICAgIC8vIOedgOazleS7jeWPquWQq+aVjOaWuemalOaJk++8m+W3seaWuemalOaJk+S/neaKpOeUsSBmaWxsQ2Fubm9uUmVsYXRpb25zIOe7n+S4gOWkhOeQhg0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBsZXQgc2NyZWVuRm91bmQgPSBmYWxzZTsNCiAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTKSB7DQogICAgICAgICAgaWYgKCFzY3JlZW5Gb3VuZCkgew0KICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgIHNjcmVlbkZvdW5kID0gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gIT09IG51bGwpIHsNCiAgICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10uY29sb3IgIT09IHBpZWNlQ29sb3IpIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgIH0NCiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ3NvbGRpZXInOiB7DQogICAgICBjb25zdCBkZXN0cyA9IFNPTERJRVJfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOw0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICB9DQogIHJldHVybiBtb3ZlczsNCn07DQoNCmNvbnN0IGlzRmx5aW5nR2VuZXJhbCA9IChib2FyZCkgPT4gew0KICBjb25zdCByZWRHID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgJ3JlZCcpOw0KICBjb25zdCBibGFja0cgPSBnZXRHZW5lcmFsUG9zKGJvYXJkLCAnYmxhY2snKTsNCiAgaWYgKCFyZWRHIHx8ICFibGFja0cgfHwgcmVkRy5jICE9PSBibGFja0cuYykgcmV0dXJuIGZhbHNlOw0KICANCiAgLy8g56Gu5L+d5b6q546v5pa55ZCR5q2j56Gu77yM5LuO6L6D5bCP55qEcuWIsOi+g+Wkp+eahHINCiAgY29uc3Qgc3RhcnRSID0gTWF0aC5taW4oYmxhY2tHLnIsIHJlZEcucikgKyAxOw0KICBjb25zdCBlbmRSID0gTWF0aC5tYXgoYmxhY2tHLnIsIHJlZEcucikgLSAxOw0KICANCiAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsNCiAgICBpZiAoYm9hcmRbcl1bcmVkRy5jXSAhPT0gbnVsbCkgcmV0dXJuIGZhbHNlOw0KICB9DQogIHJldHVybiB0cnVlOw0KfTsNCg0KLy8g5pegIGJvYXJkSW5mbyDml7bnmoTlv6vpgJ/lsIblhpvmo4DmtYvvvJrlsIbkvY3nvJPlrZggKyDku47lsIbkvY3lm5vlkJHlsITnur/vvIjovaYv5bCGL+eCruWQiOW5tu+8iQ0KY29uc3QgaXNDaGVja1Jhd0Zyb21QaWVjZVN0YXRlID0gKHN0YXRlLCBjb2xvcikgPT4gew0KICAgIGNvbnN0IG93bklzUmVkID0gY29sb3IgPT09ICdyZWQnOw0KICAgIGNvbnN0IGdlbmVyYWxTcSA9IG93bklzUmVkID8gc3RhdGUucmVkR2VuZXJhbFNxIDogc3RhdGUuYmxhY2tHZW5lcmFsU3E7DQogICAgaWYgKGdlbmVyYWxTcSA8IDApIHJldHVybiB0cnVlOw0KDQogICAgY29uc3Qgc3F1YXJlQ29kZXMgPSBzdGF0ZS5zcXVhcmVDb2RlczsNCiAgICBjb25zdCBlbmVteUlzUmVkID0gIW93bklzUmVkOw0KICAgIGNvbnN0IGdyID0gU0VBUkNIX1NRX1JPV1NbZ2VuZXJhbFNxXTsNCiAgICBjb25zdCBnYyA9IFNFQVJDSF9TUV9DT0xTW2dlbmVyYWxTcV07DQoNCiAgICBmb3IgKGxldCBkaXIgPSAwLCByYXlJbmRleCA9IGdlbmVyYWxTcSA8PCAyOyBkaXIgPCBTRUFSQ0hfUkFZX0RJUlM7IGRpcisrLCByYXlJbmRleCsrKSB7DQogICAgICAgIGxldCBzZWVuID0gMDsNCiAgICAgICAgY29uc3QgcmF5RW5kID0gU0VBUkNIX1JBWV9PRkZTRVRTW3JheUluZGV4ICsgMV07DQogICAgICAgIGZvciAobGV0IHJheVBvcyA9IFNFQVJDSF9SQVlfT0ZGU0VUU1tyYXlJbmRleF07IHJheVBvcyA8IHJheUVuZDsgcmF5UG9zKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW1NFQVJDSF9SQVlfU1FVQVJFU1tyYXlQb3NdXTsNCiAgICAgICAgICAgIGlmIChwaWVjZUNvZGUgPT09IDApIGNvbnRpbnVlOw0KICAgICAgICAgICAgc2VlbisrOw0KICAgICAgICAgICAgY29uc3QgaXNFbmVteSA9IChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlQ29kZSAmIDc7DQogICAgICAgICAgICBpZiAoc2VlbiA9PT0gMSkgew0KICAgICAgICAgICAgICAgIGlmIChpc0VuZW15ICYmIChwaWVjZVR5cGUgPT09IDIgfHwgcGllY2VUeXBlID09PSAxKSkgcmV0dXJuIHRydWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGlmIChpc0VuZW15ICYmIHBpZWNlVHlwZSA9PT0gNikgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBjb25zdCBob3JzZUNoZWNrZXJzID0gU0VBUkNIX0hPUlNFX0NIRUNLRVJTW2dlbmVyYWxTcV07DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBob3JzZUNoZWNrZXJzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGVudHJ5ID0gaG9yc2VDaGVja2Vyc1tpXTsNCiAgICAgICAgaWYgKHNxdWFyZUNvZGVzW2VudHJ5ID4+PiA3XSAhPT0gMCkgY29udGludWU7DQogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW2VudHJ5ICYgMTI3XTsNCiAgICAgICAgaWYgKHBpZWNlQ29kZSAhPT0gMCAmJiAocGllY2VDb2RlIDwgOCkgPT09IGVuZW15SXNSZWQgJiYgKHBpZWNlQ29kZSAmIDcpID09PSAzKSByZXR1cm4gdHJ1ZTsNCiAgICB9DQoNCiAgICBjb25zdCBhZHZpc29yU3F1YXJlcyA9IFNFQVJDSF9BRFZJU09SX0RFU1Rbb3duSXNSZWQgPyAwIDogMV1bZ2VuZXJhbFNxXTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFkdmlzb3JTcXVhcmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW2Fkdmlzb3JTcXVhcmVzW2ldXTsNCiAgICAgICAgaWYgKHBpZWNlQ29kZSAhPT0gMCAmJiAocGllY2VDb2RlIDwgOCkgPT09IGVuZW15SXNSZWQgJiYgKHBpZWNlQ29kZSAmIDcpID09PSA1KSByZXR1cm4gdHJ1ZTsNCiAgICB9DQoNCiAgICBjb25zdCBlbmVteUZvcndhcmQgPSBlbmVteUlzUmVkID8gMSA6IC0xOw0KICAgIGNvbnN0IGZvcndhcmRSID0gZ3IgLSBlbmVteUZvcndhcmQ7DQogICAgaWYgKGZvcndhcmRSID49IDAgJiYgZm9yd2FyZFIgPCBST1dTKSB7DQogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW2ZvcndhcmRSICogOSArIGdjXTsNCiAgICAgICAgaWYgKHBpZWNlQ29kZSAhPT0gMCAmJiAocGllY2VDb2RlIDwgOCkgPT09IGVuZW15SXNSZWQgJiYgKHBpZWNlQ29kZSAmIDcpID09PSA3KSByZXR1cm4gdHJ1ZTsNCiAgICB9DQogICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gZW5lbXlJc1JlZCA/IGdyID49IDUgOiBnciA8PSA0Ow0KICAgIGlmIChjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgaWYgKGdjIDwgQ09MUyAtIDEpIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW2dlbmVyYWxTcSArIDFdOw0KICAgICAgICAgICAgaWYgKHBpZWNlQ29kZSAhPT0gMCAmJiAocGllY2VDb2RlIDwgOCkgPT09IGVuZW15SXNSZWQgJiYgKHBpZWNlQ29kZSAmIDcpID09PSA3KSByZXR1cm4gdHJ1ZTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoZ2MgPiAwKSB7DQogICAgICAgICAgICBjb25zdCBwaWVjZUNvZGUgPSBzcXVhcmVDb2Rlc1tnZW5lcmFsU3EgLSAxXTsNCiAgICAgICAgICAgIGlmIChwaWVjZUNvZGUgIT09IDAgJiYgKHBpZWNlQ29kZSA8IDgpID09PSBlbmVteUlzUmVkICYmIChwaWVjZUNvZGUgJiA3KSA9PT0gNykgcmV0dXJuIHRydWU7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICByZXR1cm4gZmFsc2U7DQp9Ow0KDQpjb25zdCBpc0NoZWNrUmF3ID0gKGJvYXJkLCBjb2xvcikgPT4gew0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCiAgICBpZiAocGllY2VTdGF0ZSkgcmV0dXJuIGlzQ2hlY2tSYXdGcm9tUGllY2VTdGF0ZShwaWVjZVN0YXRlLCBjb2xvcik7DQogICAgY29uc3QgZ2VuZXJhbFBvcyA9IGdldEdlbmVyYWxQb3MoYm9hcmQsIGNvbG9yKTsNCiAgICBpZiAoIWdlbmVyYWxQb3MpIHJldHVybiB0cnVlOw0KDQogICAgY29uc3QgZW5lbXlDb2xvciA9IGNvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICBjb25zdCB7IHI6IGdyLCBjOiBnYyB9ID0gZ2VuZXJhbFBvczsNCg0KICAgIC8vIOebtOe6v++8muesrOS4gOWtkOS4uuaVjOi9pi/lsIbliJnlsIblhpvvvJvotorov4fngq7mnrblkI7nrKzkuozlrZDkuLrmlYzngq7liJnlsIblhpsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgIGxldCBuciA9IGdyICsgZHI7DQogICAgICAgIGxldCBuYyA9IGdjICsgZGM7DQogICAgICAgIGxldCBzZWVuID0gMDsNCg0KICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgIGlmIChwKSB7DQogICAgICAgICAgICAgICAgc2VlbisrOw0KICAgICAgICAgICAgICAgIGlmIChzZWVuID09PSAxKSB7DQogICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIChwLnR5cGUgPT09ICdjaGFyaW90JyB8fCBwLnR5cGUgPT09ICdnZW5lcmFsJykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnY2Fubm9uJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOmprO+8muS7juWwhuS9jeWPjeaOqO+8jOmprOiFv+WcqOmprOS4gOS+p++8iOS4jiBnZXRQaWVjZU1vdmVzIC8gSE9SU0VfRElSUyDkuIDoh7TvvIkNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IEhPUlNFX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZCA9IEhPUlNFX0RJUlNbaV07DQogICAgICAgIGNvbnN0IG5yID0gZ3IgKyBkLmRyOw0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZC5kYzsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MobnIsIG5jKSkgew0KICAgICAgICAgICAgY29uc3QgbGVnUiA9IG5yIC0gZC5sZWdEcjsNCiAgICAgICAgICAgIGNvbnN0IGxlZ0MgPSBuYyAtIGQubGVnRGM7DQogICAgICAgICAgICBpZiAoYm9hcmRbbGVnUl1bbGVnQ10gPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ2hvcnNlJykgew0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDlo6vvvIjkuZ3lrqvlhoXvvIkNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IERJQUdfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkciA9IERJQUdfRElSU1tpXVswXSwgZGMgPSBESUFHX0RJUlNbaV1bMV07DQogICAgICAgIGNvbnN0IG5yID0gZ3IgKyBkcjsNCiAgICAgICAgY29uc3QgbmMgPSBnYyArIGRjOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhuciwgbmMpICYmDQogICAgICAgICAgICAoKGNvbG9yID09PSAncmVkJyAmJiBuciA+PSAwICYmIG5yIDw9IDIpIHx8IChjb2xvciA9PT0gJ2JsYWNrJyAmJiBuciA+PSA3ICYmIG5yIDw9IDkpKSAmJg0KICAgICAgICAgICAgbmMgPj0gMyAmJiBuYyA8PSA1KSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnYWR2aXNvcicpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOWFte+8muato+WJjeaWueWni+e7iOWPr+aUu++8m+W3puWPs+S7hei/h+ays+WFtQ0KICAgIGNvbnN0IGVuZW15Rm9yd2FyZCA9IGVuZW15Q29sb3IgPT09ICdyZWQnID8gMSA6IC0xOw0KICAgIGNvbnN0IGZvcndhcmRGcm9tUiA9IGdyIC0gZW5lbXlGb3J3YXJkOw0KICAgIGlmIChpc1ZhbGlkUG9zKGZvcndhcmRGcm9tUiwgZ2MpKSB7DQogICAgICAgIGNvbnN0IHAgPSBib2FyZFtmb3J3YXJkRnJvbVJdW2djXTsNCiAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgIH0NCiAgICB9DQogICAgZm9yIChjb25zdCBkYyBvZiBbMSwgLTFdKSB7DQogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkYzsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MoZ3IsIG5jKSkgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW2dyXVtuY107DQogICAgICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7DQogICAgICAgICAgICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyBnciA+PSA1IDogZ3IgPD0gNDsNCiAgICAgICAgICAgICAgICBpZiAoY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIHJldHVybiBmYWxzZTsNCn07DQoNCmNvbnN0IGlzQ2hlY2sgPSAoYm9hcmQsIGNvbG9yLCBwaWVjZXNJbmZvID0gbnVsbCwgYm9hcmRJbmZvID0gbnVsbCkgPT4gew0KICAgIC8vIOS8mOWFiOS9v+eUqOmihOiuoeeul+eahOWwhuWGm+eKtuaAgQ0KICAgIGlmIChib2FyZEluZm8pIHsNCiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRJc0luQ2hlY2sgOiBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2s7DQogICAgfQ0KDQogICAgLy8g5aaC5p6c5pyJcGllY2VzSW5mb++8jOS5n+WPr+S7peS7juS4reiOt+WPluWwhuWGm+eKtuaAgQ0KICAgIGlmIChwaWVjZXNJbmZvICYmIHBpZWNlc0luZm8ubGVuZ3RoID4gMCkgew0KICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gcGllY2VzSW5mb1swXS5yZWRJc0luQ2hlY2sgOiBwaWVjZXNJbmZvWzBdLmJsYWNrSXNJbkNoZWNrOw0KICAgIH0NCg0KICAgIHJldHVybiBpc0NoZWNrUmF3KGJvYXJkLCBjb2xvcik7DQp9Ow0KDQovLyDlkIjms5XnnYDms5XvvJrkvKrlkIjms5UgKyDkuI3pgIHlsIYv5LiN6aOe5bCG77yIbWFrZS91bm1ha2XvvIkNCmNvbnN0IGdldFZhbGlkTW92ZXMgPSAoYm9hcmQsIHBvcykgPT4gew0KICBjb25zdCBwaWVjZSA9IGJvYXJkW3Bvcy5yXVtwb3MuY107DQogIGlmICghcGllY2UpIHJldHVybiBbXTsNCiAgY29uc3QgcHNldWRvTW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCBwb3MsIHBpZWNlKTsNCiAgcmV0dXJuIGZpbHRlckxlZ2FsTW92ZXMoYm9hcmQsIHBvcywgcGllY2UsIHBzZXVkb01vdmVzKTsNCn07DQoNCmNvbnN0IGlzVmFsaWRQbGFjZW1lbnQgPSAodHlwZSwgY29sb3IsIHIsIGMpID0+IHsNCiAgICBjb25zdCBpc1JlZCA9IGNvbG9yID09PSAncmVkJzsNCiAgICBzd2l0Y2godHlwZSkgew0KICAgICAgICBjYXNlICdnZW5lcmFsJzoNCiAgICAgICAgICAgIC8vIOW4heWwhuWPquiDveWcqOS5neWuq+S4reW/g+eahOS4gOadoee6v+S4ig0KICAgICAgICAgICAgaWYgKGMgPCAzIHx8IGMgPiA1KSByZXR1cm4gZmFsc2U7DQogICAgICAgICAgICBpZiAoaXNSZWQpIHJldHVybiByID49IDAgJiYgciA8PSAyOw0KICAgICAgICAgICAgZWxzZSByZXR1cm4gciA+PSA3ICYmIHIgPD0gOTsNCiAgICAgICAgY2FzZSAnYWR2aXNvcic6DQogICAgICAgICAgICAvLyDlo6vlj6rog73lnKjkuZ3lrqvnmoQ15Liq54K55LmL5LiADQogICAgICAgICAgICBjb25zdCB2YWxpZEFkdmlzb3JQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgcmVkOiBbWzAsIDNdLCBbMCwgNV0sIFsxLCA0XSwgWzIsIDNdLCBbMiwgNV1dLA0KICAgICAgICAgICAgICAgIGJsYWNrOiBbWzcsIDNdLCBbNywgNV0sIFs4LCA0XSwgWzksIDNdLCBbOSwgNV1dDQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgcmV0dXJuIHZhbGlkQWR2aXNvclBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ10uc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgIGNhc2UgJ2VsZXBoYW50JzoNCiAgICAgICAgICAgIC8vIOebuOWPquiDveWcqOW3seaWueWNiuWcuueahDfkuKrngrnkuYvkuIANCiAgICAgICAgICAgIGNvbnN0IHZhbGlkRWxlcGhhbnRQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgcmVkOiBbWzAsIDJdLCBbMCwgNl0sIFsyLCAwXSwgWzIsIDRdLCBbMiwgOF0sIFs0LCAyXSwgWzQsIDZdXSwNCiAgICAgICAgICAgICAgICBibGFjazogW1s1LCAyXSwgWzUsIDZdLCBbNywgMF0sIFs3LCA0XSwgWzcsIDhdLCBbOSwgMl0sIFs5LCA2XV0NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICByZXR1cm4gdmFsaWRFbGVwaGFudFBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ10uc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgIGNhc2UgJ3NvbGRpZXInOg0KICAgICAgICAgICAgLy8g5YW155qE5L2N572u6ZmQ5Yi277ya6L+H5rKz5YmN5Y+q6IO95Zyo5YG25pWw5YiX77yM6L+H5rKz5ZCO5Y+v5Lul5Zyo5Lu75L2V5YiXDQogICAgICAgICAgICAvLyDnuqLmlrnlhbXov4fmsrPmnaHku7bmmK9yID49IDXvvIzpu5HmlrnlhbXov4fmsrPmnaHku7bmmK9yIDw9IDQNCiAgICAgICAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGlzUmVkID8gciA+PSA1IDogciA8PSA0Ow0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoIWNyb3NzZWRSaXZlcikgew0KICAgICAgICAgICAgICAgIC8vIOi/h+ays+WJjeWPquiDveWcqOWBtuaVsOWIl++8iGM9MCwyLDQsNiw477yJDQogICAgICAgICAgICAgICAgaWYgKCFbMCwgMiwgNCwgNiwgOF0uaW5jbHVkZXMoYykpIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5YW155qE5L2N572u6ZmQ5Yi277ya6L+H5rKz5YmN5Y+q6IO95Zyo5YW15L2N5ZKM5YW15L2N5YmN5pa577yM6L+H5rKz5ZCO5pWM5pa55Y2K5Zy66YO95ZCI5rOVDQogICAgICAgICAgICBjb25zdCB2YWxpZFNvbGRpZXJQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgcmVkOiB7DQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWueWIneWni+WFteS9je+8mnI9MywgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbDogW1szLCAwXSwgWzMsIDJdLCBbMywgNF0sIFszLCA2XSwgWzMsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa55YW15L2N5YmN5pa577yacj00LCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBmb3J3YXJkOiBbWzQsIDBdLCBbNCwgMl0sIFs0LCA0XSwgWzQsIDZdLCBbNCwgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov4fmsrPnur/vvJpyPj01DQogICAgICAgICAgICAgICAgICAgIGNyb3NzZWRSaXZlcjogciA+PSA1DQogICAgICAgICAgICAgICAgfSwNCiAgICAgICAgICAgICAgICBibGFjazogew0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnliJ3lp4vlhbXkvY3vvJpyPTYsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGluaXRpYWw6IFtbNiwgMF0sIFs2LCAyXSwgWzYsIDRdLCBbNiwgNl0sIFs2LCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueWFteS9jeWJjeaWue+8mnI9NSwgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgZm9yd2FyZDogW1s1LCAwXSwgWzUsIDJdLCBbNSwgNF0sIFs1LCA2XSwgWzUsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+H5rKz57q/77yacjw9NA0KICAgICAgICAgICAgICAgICAgICBjcm9zc2VkUml2ZXI6IHIgPD0gNA0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICANCiAgICAgICAgICAgIGNvbnN0IHNvbGRpZXJJbmZvID0gdmFsaWRTb2xkaWVyUG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXTsNCiAgICAgICAgICAgIGNvbnN0IGlzSW5pdGlhbFBvcyA9IHNvbGRpZXJJbmZvLmluaXRpYWwuc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgICAgICBjb25zdCBpc0ZvcndhcmRQb3MgPSBzb2xkaWVySW5mby5mb3J3YXJkLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoc29sZGllckluZm8uY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgICAgICAgICAgLy8g6L+H5rKz5ZCO5pWM5pa55Y2K5Zy66YO95ZCI5rOVDQogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIOi/h+ays+WJjeWPquiDveWcqOWFteS9jeWSjOWFteS9jeWJjeaWuQ0KICAgICAgICAgICAgICAgIHJldHVybiBpc0luaXRpYWxQb3MgfHwgaXNGb3J3YXJkUG9zOw0KICAgICAgICAgICAgfQ0KICAgICAgICBkZWZhdWx0Og0KICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgfQ0KfTsNCg0KY29uc3QgY2hlY2tHYW1lU3RhdGUgPSAoYm9hcmQsIHR1cm4sIHBpZWNlc0luZm8gPSBudWxsLCBib2FyZEluZm8gPSBudWxsKSA9PiB7DQogICAgLy8g5LyY5YWI5L2/55So6aKE6K6h566X55qEZ2FtZVN0YXRlDQogICAgaWYgKGJvYXJkSW5mbyAmJiBib2FyZEluZm8uZ2FtZVN0YXRlKSB7DQogICAgICAgIHJldHVybiBib2FyZEluZm8uZ2FtZVN0YXRlOw0KICAgIH0NCiAgICANCiAgICAvLyDmsqHmnInpooTorqHnrpfnu5Pmnpzml7bvvIzmiafooYzljp/lp4vorqHnrpcNCiAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsNCiAgICBmb3IobGV0IHI9MDsgcjxST1dTOyByKyspIHsNCiAgICAgICAgZm9yKGxldCBjPTA7IGM8Q09MUzsgYysrKSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbcl1bY10/LmNvbG9yID09PSB0dXJuKSB7DQogICAgICAgICAgICAgICAgaWYgKGdldFZhbGlkTW92ZXMoYm9hcmQsIHtyLGN9KS5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmIChoYXNNb3ZlcykgYnJlYWs7DQogICAgfQ0KDQogICAgaWYgKGhhc01vdmVzKSByZXR1cm4geyBzdGF0dXM6ICdwbGF5aW5nJyB9Ow0KDQogICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2soYm9hcmQsIHR1cm4sIHBpZWNlc0luZm8sIGJvYXJkSW5mbyk7DQogICAgY29uc3Qgb3Bwb25lbnQgPSB0dXJuID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICANCiAgICBpZiAoaW5DaGVjaykgew0KICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfSBlbHNlIHsNCiAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgIH0NCn07DQoNCg0KDQpjb25zdCBnZXRHYW1lUGhhc2UgPSAoKSA9PiB7DQogIHJldHVybiAnb3BlbmluZyc7DQp9Ow0KDQovLyDlrp7kvovljJZab2JyaXN0SGFzaGVyDQpjb25zdCB6b2JyaXN0SGFzaGVyID0gbmV3IFpvYnJpc3RIYXNoZXIoKTsNCg0KLy8gS2VlcCB0aGUgZGVwdGgtOCBpdGVyYXRpdmUtZGVlcGVuaW5nIHRyZWUgcmVzaWRlbnQuIFJlcGxhY2VtZW50IG9ubHkgcnVucw0KLy8gZm9yIGRlZXBlciBzZWFyY2hlcyB0aGF0IGV4Y2VlZCB0aGlzIGNhcGFjaXR5Lg0KY29uc3QgVFRfREVGQVVMVF9TSVpFID0gTWF0aC5wb3coMiwgMjEpOw0KY29uc3QgVFRfREVGQVVMVF9FVklDVElPTl9CQVRDSCA9IDUxMjsNCmNvbnN0IFRUX0VWSUNUSU9OX1NDQU4gPSBUVF9ERUZBVUxUX0VWSUNUSU9OX0JBVENIICogNDsNCg0KY2xhc3MgVHJhbnNwb3NpdGlvblRhYmxlIHsNCiAgICBjb25zdHJ1Y3RvcihzaXplID0gVFRfREVGQVVMVF9TSVpFLCBldmljdGlvbkJhdGNoID0gVFRfREVGQVVMVF9FVklDVElPTl9CQVRDSCkgew0KICAgICAgICB0aGlzLnRhYmxlID0gbmV3IE1hcCgpOw0KICAgICAgICB0aGlzLnNpemUgPSBzaXplOw0KICAgICAgICB0aGlzLmV2aWN0aW9uQmF0Y2ggPSBldmljdGlvbkJhdGNoOw0KICAgICAgICB0aGlzLmV2aWN0aW9uQ2FuZGlkYXRlcyA9IFtdOw0KICAgICAgICB0aGlzLmhhc2hlciA9IHpvYnJpc3RIYXNoZXI7DQogICAgICAgIC8vIOe7n+iuoeS/oeaBrw0KICAgICAgICB0aGlzLnN0YXRzID0gew0KICAgICAgICAgICAgaGl0czogMCwNCiAgICAgICAgICAgIG1pc3NlczogMCwNCiAgICAgICAgICAgIGV4YWN0SGl0czogMCwNCiAgICAgICAgICAgIGxvd2VyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgdXBwZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICBzdG9yZXM6IDAsDQogICAgICAgICAgICBscnVFdmljdGlvbnM6IDAsDQogICAgICAgICAgICBkZXB0aFByZWZlcnJlZEV2aWN0aW9uczogMCwNCiAgICAgICAgICAgIGZhbGxiYWNrRXZpY3Rpb25zOiAwLA0KICAgICAgICAgICAgdXBkYXRlZFN0b3JlczogMCwNCiAgICAgICAgICAgIHJldGFpbmVkVXBkYXRlczogMCwNCiAgICAgICAgICAgIGV2aWN0aW9uQmF0Y2hlczogMCwNCiAgICAgICAgICAgIGNsZWFyczogMA0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIHNldEV2aWN0aW9uQmF0Y2goYmF0Y2gpIHsNCiAgICAgICAgdGhpcy5ldmljdGlvbkJhdGNoID0gTWF0aC5tYXgoMSwgYmF0Y2ggfCAwKTsNCiAgICB9DQogICAgDQogICAgc3RvcmUoa2V5LCBkZXB0aCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlID0gbnVsbCwgbW92ZVNlcXVlbmNlID0gbnVsbCkgew0KICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMudGFibGUuZ2V0KGtleSk7DQogICAgICAgIGlmIChleGlzdGluZykgew0KICAgICAgICAgICAgdGhpcy5zdGF0cy51cGRhdGVkU3RvcmVzKys7DQogICAgICAgICAgICAvLyBBIGRlZXBlciBleGFjdCBlbnRyeSBkb21pbmF0ZXMgYSBzaGFsbG93IGJvdW5kIGZvciByZXBsYWNlbWVudC4NCiAgICAgICAgICAgIGlmIChleGlzdGluZy5kZXB0aCA+IGRlcHRoICYmIGV4aXN0aW5nLmZsYWcgPT09ICdleGFjdCcgJiYgZmxhZyAhPT0gJ2V4YWN0Jykgew0KICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMucmV0YWluZWRVcGRhdGVzKys7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgdGhpcy50YWJsZS5zZXQoa2V5LCB7IGRlcHRoLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUsIG1vdmVTZXF1ZW5jZSB9KTsNCiAgICAgICAgICAgIHRoaXMuc3RhdHMuc3RvcmVzKys7DQogICAgICAgICAgICByZXR1cm47DQogICAgICAgIH0NCg0KICAgICAgICBpZiAodGhpcy50YWJsZS5zaXplID49IHRoaXMuc2l6ZSkgew0KICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IHRoaXMuZXZpY3Rpb25DYW5kaWRhdGVzOw0KICAgICAgICAgICAgY2FuZGlkYXRlcy5sZW5ndGggPSAwOw0KICAgICAgICAgICAgbGV0IHNjYW5uZWQgPSAwOw0KICAgICAgICAgICAgZm9yIChjb25zdCBjYW5kaWRhdGVLZXkgb2YgdGhpcy50YWJsZS5rZXlzKCkpIHsNCiAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnB1c2goY2FuZGlkYXRlS2V5KTsNCiAgICAgICAgICAgICAgICBpZiAoKytzY2FubmVkID49IFRUX0VWSUNUSU9OX1NDQU4pIGJyZWFrOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCBkcm9wQ291bnQgPSBNYXRoLm1pbih0aGlzLmV2aWN0aW9uQmF0Y2gsIGNhbmRpZGF0ZXMubGVuZ3RoKTsNCiAgICAgICAgICAgIGxldCBkcm9wcGVkID0gMDsNCiAgICAgICAgICAgIC8vIFByZWZlciBwcmVzZXJ2aW5nIGVudHJpZXMgdGhhdCBzZWFyY2hlZCBkZWVwZXIgdGhhbiB0aGUgaW5jb21pbmcgbm9kZS4NCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY2FuZGlkYXRlcy5sZW5ndGggJiYgZHJvcHBlZCA8IGRyb3BDb3VudDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlS2V5ID0gY2FuZGlkYXRlc1tpXTsNCiAgICAgICAgICAgICAgICBjb25zdCBjYW5kaWRhdGUgPSB0aGlzLnRhYmxlLmdldChjYW5kaWRhdGVLZXkpOw0KICAgICAgICAgICAgICAgIGlmIChjYW5kaWRhdGUgJiYgY2FuZGlkYXRlLmRlcHRoIDw9IGRlcHRoKSB7DQogICAgICAgICAgICAgICAgICAgIHRoaXMudGFibGUuZGVsZXRlKGNhbmRpZGF0ZUtleSk7DQogICAgICAgICAgICAgICAgICAgIGRyb3BwZWQrKzsNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0cy5kZXB0aFByZWZlcnJlZEV2aWN0aW9ucysrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIC8vIFRoZSB0YWJsZSBtYXkgY29udGFpbiBvbmx5IGRlZXBlciBlbnRyaWVzIGluIHRoZSBzY2FuIHdpbmRvdy4NCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY2FuZGlkYXRlcy5sZW5ndGggJiYgZHJvcHBlZCA8IGRyb3BDb3VudDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlS2V5ID0gY2FuZGlkYXRlc1tpXTsNCiAgICAgICAgICAgICAgICBpZiAodGhpcy50YWJsZS5kZWxldGUoY2FuZGlkYXRlS2V5KSkgew0KICAgICAgICAgICAgICAgICAgICBkcm9wcGVkKys7DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMuZmFsbGJhY2tFdmljdGlvbnMrKzsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICB0aGlzLnN0YXRzLmxydUV2aWN0aW9ucyArPSBkcm9wcGVkOw0KICAgICAgICAgICAgdGhpcy5zdGF0cy5ldmljdGlvbkJhdGNoZXMrKzsNCiAgICAgICAgfQ0KICAgICAgICB0aGlzLnRhYmxlLnNldChrZXksIHsgZGVwdGgsIHZhbHVlLCBmbGFnLCBiZXN0TW92ZSwgbW92ZVNlcXVlbmNlIH0pOw0KICAgICAgICB0aGlzLnN0YXRzLnN0b3JlcysrOw0KICAgIH0NCiAgICANCiAgICByZXRyaWV2ZShrZXkpIHsNCiAgICAgICAgY29uc3QgZW50cnkgPSB0aGlzLnRhYmxlLmdldChrZXkpIHx8IG51bGw7DQogICAgICAgIGlmIChlbnRyeSkgew0KICAgICAgICAgICAgdGhpcy5zdGF0cy5oaXRzKys7DQogICAgICAgICAgICAvLyDnu5/orqHkuI3lkIznsbvlnovnmoTlkb3kuK0NCiAgICAgICAgICAgIHN3aXRjaCAoZW50cnkuZmxhZykgew0KICAgICAgICAgICAgICAgIGNhc2UgJ2V4YWN0JzoNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0cy5leGFjdEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgY2FzZSAnbG93ZXJib3VuZCc6DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMubG93ZXJib3VuZEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgY2FzZSAndXBwZXJib3VuZCc6DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMudXBwZXJib3VuZEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICB0aGlzLnN0YXRzLm1pc3NlcysrOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBlbnRyeTsNCiAgICB9DQogICAgDQogICAgY2xlYXIoKSB7DQogICAgICAgIHRoaXMudGFibGUuY2xlYXIoKTsNCiAgICAgICAgdGhpcy5zdGF0cy5jbGVhcnMrKzsNCiAgICB9DQogICAgDQogICAgLy8g6I635Y+W57uf6K6h5L+h5oGv5bm26K6h566X5ZG95Lit546HDQogICAgZ2V0U3RhdHMoKSB7DQogICAgICAgIGNvbnN0IHRvdGFsQWNjZXNzZXMgPSB0aGlzLnN0YXRzLmhpdHMgKyB0aGlzLnN0YXRzLm1pc3NlczsNCiAgICAgICAgY29uc3QgaGl0UmF0ZSA9IHRvdGFsQWNjZXNzZXMgPiAwID8gKHRoaXMuc3RhdHMuaGl0cyAvIHRvdGFsQWNjZXNzZXMgKiAxMDApLnRvRml4ZWQoMikgOiAwOw0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgLi4udGhpcy5zdGF0cywNCiAgICAgICAgICAgIGV2aWN0aW9uQmF0Y2g6IHRoaXMuZXZpY3Rpb25CYXRjaCwNCiAgICAgICAgICAgIHRvdGFsQWNjZXNzZXMsDQogICAgICAgICAgICBoaXRSYXRlLA0KICAgICAgICAgICAgY3VycmVudFNpemU6IHRoaXMudGFibGUuc2l6ZSwNCiAgICAgICAgICAgIG1heFNpemU6IHRoaXMuc2l6ZSwNCiAgICAgICAgICAgIGZpbGxQZXJjZW50YWdlOiAodGhpcy50YWJsZS5zaXplIC8gdGhpcy5zaXplICogMTAwKS50b0ZpeGVkKDIpDQogICAgICAgIH07DQogICAgfQ0KICAgIA0KICAgIC8vIOmHjee9rue7n+iuoeS/oeaBrw0KICAgIHJlc2V0U3RhdHMoKSB7DQogICAgICAgIHRoaXMuc3RhdHMgPSB7DQogICAgICAgICAgICBoaXRzOiAwLA0KICAgICAgICAgICAgbWlzc2VzOiAwLA0KICAgICAgICAgICAgZXhhY3RIaXRzOiAwLA0KICAgICAgICAgICAgbG93ZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICB1cHBlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHN0b3JlczogMCwNCiAgICAgICAgICAgIGxydUV2aWN0aW9uczogMCwNCiAgICAgICAgICAgIGRlcHRoUHJlZmVycmVkRXZpY3Rpb25zOiAwLA0KICAgICAgICAgICAgZmFsbGJhY2tFdmljdGlvbnM6IDAsDQogICAgICAgICAgICB1cGRhdGVkU3RvcmVzOiAwLA0KICAgICAgICAgICAgcmV0YWluZWRVcGRhdGVzOiAwLA0KICAgICAgICAgICAgZXZpY3Rpb25CYXRjaGVzOiAwLA0KICAgICAgICAgICAgY2xlYXJzOiAwDQogICAgICAgIH07DQogICAgfQ0KfQ0KDQovLyDmgKfog73nu5/orqENCmxldCBwZXJmU3RhdHMgPSB7DQogICAgZXZhbHVhdGVCb2FyZENvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwNCiAgICBwcmVwYXJlU2VhcmNoSW5mb0NvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwNCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sDQogICAgYWxwaGFCZXRhQ2FsbHM6IDAsICAvLyDmgLvosIPnlKjmrKHmlbAKICAgIG5vZGVzU2VhcmNoZWQ6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHmkJzntKLnmoToioLngrnmlbANCiAgICBtb3Zlc0dlbmVyYXRlZDoge30sIC8vIOaMiea3seW6pue7n+iuoeeUn+aIkOeahOi1sOazleaVsA0KICAgIGN1dG9mZnM6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHliarmnp3mrKHmlbANCiAgICAvLyDlkIjms5XmgKfot6/lvoTvvJrkvKrlkIjms5XnlJ/miJDph4/jgIHor5XotbDlkIjms5XmgKfmo4DmtYvjgIHpnZ7ms5Xot7Pov4fjgIHlrp7pmYXov5vlhaXmkJzntKLnmoTlkIjms5XnnYANCiAgICBwc2V1ZG9Nb3Zlc0dlbmVyYXRlZDogMCwNCiAgICBsZWdhbGl0eUNoZWNrczogMCwNCiAgICBpbGxlZ2FsTW92ZXNTa2lwcGVkOiAwLA0KICAgIGxlZ2FsTW92ZXNTZWFyY2hlZDogMCwNCiAgICAvLyBab2JyaXN077ya5YWo55uY6YeN566X5qyh5pWwIC8g5aKe6YeP5pu05paw5qyh5pWwIC8g5qCh6aqM5LiN5LiA6Ie077yI5LuFIHZlcmlmeSDmqKHlvI/vvIkNCiAgICBmdWxsSGFzaENvdW50OiAwLA0KICAgIGluY3JlbWVudGFsSGFzaFVwZGF0ZXM6IDAsDQogICAgaGFzaE1pc21hdGNoZXM6IDAsDQogICAgZmFzdExlYWZFdmFsQ291bnQ6IDAsDQogICAgZmFzdExlYWZFdmFsTXM6IDAsDQogICAgcHJlcGFyZUNoZWNrTXM6IDAsDQogICAgcHJlcGFyZU1vdmVHZW5NczogMCwNCiAgICBzb3J0TW92ZXNDb3VudDogMCwNCiAgICBzb3J0TW92ZXNNczogMCwNCiAgICBsZWdhbGl0eUNoZWNrTXM6IDAsDQogICAgY2FwdHVyZUdlbkNvdW50OiAwLA0KICAgIGNhcHR1cmVHZW5NczogMCwNCiAgICBxdWllc2NlbmNlQ2FsbHM6IDAsDQogICAgcXVpZXNjZW5jZUNhcHR1cmVNb3ZlczogMCwNCiAgICBzdGF0aWNFdmFsQ2FjaGVIaXRzOiAwLA0KICAgIHN0YXRpY0V2YWxDYWNoZU1pc3NlczogMCwNCiAgICBldmFsdWF0ZUJvYXJkTXM6IDAsDQogICAgcHJlcGFyZVNlYXJjaEluZm9NczogMCwNCiAgICBzdGFydFRpbWU6IERhdGUubm93KCkNCn07DQoNCi8vIOmHjee9rue7n+iuoe+8iOavj+asoeaQnOe0ouW8gOWni+aXtuiwg+eUqO+8iQ0KY29uc3QgcmVzZXRQZXJmU3RhdHMgPSAoKSA9PiB7DQogICAgYWN0aXZlU2VhcmNoUGllY2VTdGF0ZSA9IG51bGw7DQogICAgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRDb3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50ID0geyByZWQ6IDAsIGJsYWNrOiAwIH07DQogICAgcGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50ID0geyByZWQ6IDAsIGJsYWNrOiAwIH07DQogICAgcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzID0gMDsKICAgIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkID0ge307DQogICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkID0ge307DQogICAgcGVyZlN0YXRzLmN1dG9mZnMgPSB7fTsNCiAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgPSAwOw0KICAgIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcyA9IDA7DQogICAgcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQgPSAwOw0KICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQgPSAwOw0KICAgIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50ID0gMDsNCiAgICBwZXJmU3RhdHMuaW5jcmVtZW50YWxIYXNoVXBkYXRlcyA9IDA7DQogICAgcGVyZlN0YXRzLmhhc2hNaXNtYXRjaGVzID0gMDsNCiAgICBwZXJmU3RhdHMuZmFzdExlYWZFdmFsQ291bnQgPSAwOw0KICAgIHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxNcyA9IDA7DQogICAgcGVyZlN0YXRzLnByZXBhcmVDaGVja01zID0gMDsNCiAgICBwZXJmU3RhdHMucHJlcGFyZU1vdmVHZW5NcyA9IDA7DQogICAgcGVyZlN0YXRzLnNvcnRNb3Zlc0NvdW50ID0gMDsNCiAgICBwZXJmU3RhdHMuc29ydE1vdmVzTXMgPSAwOw0KICAgIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrTXMgPSAwOw0KICAgIHBlcmZTdGF0cy5jYXB0dXJlR2VuQ291bnQgPSAwOw0KICAgIHBlcmZTdGF0cy5jYXB0dXJlR2VuTXMgPSAwOw0KICAgIHBlcmZTdGF0cy5xdWllc2NlbmNlQ2FsbHMgPSAwOw0KICAgIHBlcmZTdGF0cy5xdWllc2NlbmNlQ2FwdHVyZU1vdmVzID0gMDsNCiAgICBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlSGl0cyA9IDA7DQogICAgcGVyZlN0YXRzLnN0YXRpY0V2YWxDYWNoZU1pc3NlcyA9IDA7DQogICAgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcyA9IDA7DQogICAgcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvTXMgPSAwOw0KICAgIHBlcmZTdGF0cy5zdGFydFRpbWUgPSBEYXRlLm5vdygpOw0KfTsNCg0KY29uc3Qgc25hcHNob3RQZXJmU3RhdHMgPSAoKSA9PiB7DQogICAgY29uc3QgZWxhcHNlZCA9IERhdGUubm93KCkgLSBwZXJmU3RhdHMuc3RhcnRUaW1lOw0KICAgIGNvbnN0IHR0U3RhdHMgPSB0cmFuc3Bvc2l0aW9uVGFibGUuZ2V0U3RhdHMoKTsNCiAgICBjb25zdCBkZXB0aHMgPSBPYmplY3Qua2V5cyhwZXJmU3RhdHMubm9kZXNTZWFyY2hlZCkuc29ydCgoYSwgYikgPT4gTnVtYmVyKGEpIC0gTnVtYmVyKGIpKTsNCiAgICBjb25zdCBieURlcHRoID0ge307DQogICAgZm9yIChjb25zdCBkIG9mIGRlcHRocykgew0KICAgICAgICBieURlcHRoW2RdID0gew0KICAgICAgICAgICAgbm9kZXM6IHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdIHx8IDAsDQogICAgICAgICAgICBtb3ZlczogcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdIHx8IDAsDQogICAgICAgICAgICBjdXRvZmZzOiBwZXJmU3RhdHMuY3V0b2Zmc1tkXSB8fCAwDQogICAgICAgIH07DQogICAgfQ0KICAgIHJldHVybiB7DQogICAgICAgIGVsYXBzZWRNczogZWxhcHNlZCwNCiAgICAgICAgcHJvZmlsZTogU0VBUkNIX1BST0ZJTEUsDQogICAgICAgIGV2YWx1YXRlQm9hcmQ6IHsgLi4ucGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRDb3VudCB9LA0KICAgICAgICBwcmVwYXJlU2VhcmNoSW5mbzogeyAuLi5wZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudCB9LA0KICAgICAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXM6IHsgLi4ucGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50IH0sDQogICAgICAgIGFscGhhQmV0YUNhbGxzOiBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMsCiAgICAgICAgcHNldWRvTW92ZXNHZW5lcmF0ZWQ6IHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCwNCiAgICAgICAgbGVnYWxpdHlDaGVja3M6IHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcywNCiAgICAgICAgaWxsZWdhbE1vdmVzU2tpcHBlZDogcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQsDQogICAgICAgIGxlZ2FsTW92ZXNTZWFyY2hlZDogcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCwNCiAgICAgICAgZnVsbEhhc2hDb3VudDogcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQsDQogICAgICAgIGluY3JlbWVudGFsSGFzaFVwZGF0ZXM6IHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzLA0KICAgICAgICBoYXNoTWlzbWF0Y2hlczogcGVyZlN0YXRzLmhhc2hNaXNtYXRjaGVzLA0KICAgICAgICBmYXN0TGVhZkV2YWxDb3VudDogcGVyZlN0YXRzLmZhc3RMZWFmRXZhbENvdW50LA0KICAgICAgICBmYXN0TGVhZkV2YWxNczogcGVyZlN0YXRzLmZhc3RMZWFmRXZhbE1zLA0KICAgICAgICBwcmVwYXJlQ2hlY2tNczogcGVyZlN0YXRzLnByZXBhcmVDaGVja01zLA0KICAgICAgICBwcmVwYXJlTW92ZUdlbk1zOiBwZXJmU3RhdHMucHJlcGFyZU1vdmVHZW5NcywNCiAgICAgICAgc29ydE1vdmVzQ291bnQ6IHBlcmZTdGF0cy5zb3J0TW92ZXNDb3VudCwNCiAgICAgICAgc29ydE1vdmVzTXM6IHBlcmZTdGF0cy5zb3J0TW92ZXNNcywNCiAgICAgICAgbGVnYWxpdHlDaGVja01zOiBwZXJmU3RhdHMubGVnYWxpdHlDaGVja01zLA0KICAgICAgICBjYXB0dXJlR2VuQ291bnQ6IHBlcmZTdGF0cy5jYXB0dXJlR2VuQ291bnQsDQogICAgICAgIGNhcHR1cmVHZW5NczogcGVyZlN0YXRzLmNhcHR1cmVHZW5NcywNCiAgICAgICAgcXVpZXNjZW5jZUNhbGxzOiBwZXJmU3RhdHMucXVpZXNjZW5jZUNhbGxzLA0KICAgICAgICBxdWllc2NlbmNlQ2FwdHVyZU1vdmVzOiBwZXJmU3RhdHMucXVpZXNjZW5jZUNhcHR1cmVNb3ZlcywNCiAgICAgICAgc3RhdGljRXZhbENhY2hlSGl0czogcGVyZlN0YXRzLnN0YXRpY0V2YWxDYWNoZUhpdHMsDQogICAgICAgIHN0YXRpY0V2YWxDYWNoZU1pc3NlczogcGVyZlN0YXRzLnN0YXRpY0V2YWxDYWNoZU1pc3NlcywNCiAgICAgICAgZXZhbHVhdGVCb2FyZE1zOiBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zLA0KICAgICAgICBwcmVwYXJlU2VhcmNoSW5mb01zOiBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcywNCiAgICAgICAgdHQ6IHR0U3RhdHMsDQogICAgICAgIGJ5RGVwdGgNCiAgICB9Ow0KfTsNCg0KLy8g5omT5Y2w57uf6K6h5L+h5oGvDQpjb25zdCBsb2dQZXJmU3RhdHMgPSAoY3VycmVudFBsYXllcikgPT4gewogICAgY29uc3Qgc25hcCA9IHNuYXBzaG90UGVyZlN0YXRzKCk7CiAgICBjb25zb2xlLmxvZyhgU2VhcmNoIHN0YXRzICgke2N1cnJlbnRQbGF5ZXJ9KTogJHtzbmFwLmVsYXBzZWRNc31tcywgbm9kZXM9JHtzbmFwLmFscGhhQmV0YUNhbGxzfSwgbGVnYWw9JHtzbmFwLmxlZ2FsTW92ZXNTZWFyY2hlZH0sIGxlYXZlcz0ke3NuYXAuZmFzdExlYWZFdmFsQ291bnR9YCk7CiAgICBjb25zb2xlLmxvZyhgVFQ6ICR7c25hcC50dC5oaXRzfS8ke3NuYXAudHQubWlzc2VzfSAoJHtzbmFwLnR0LmhpdFJhdGV9JSksIHN0b3Jlcz0ke3NuYXAudHQuc3RvcmVzfSwgc2l6ZT0ke3NuYXAudHQuY3VycmVudFNpemV9YCk7Cn07DQoNCmNvbnN0IHRyYW5zcG9zaXRpb25UYWJsZSA9IG5ldyBUcmFuc3Bvc2l0aW9uVGFibGUoKTsNCg0KLy8g5Y+26K+E5Lyw57yT5a2Y77yI5a6M5pW05b2i5Yq/5YiG77yJ77yb5q+P5qyhIGdldEJlc3RNb3ZlIOa4heepug0KY29uc3QgRVZBTF9DQUNIRV9NQVggPSBNYXRoLnBvdygyLCAxOCk7DQpjb25zdCBldmFsQ2FjaGUgPSBuZXcgTWFwKCk7DQpjb25zdCBjbGVhckV2YWxDYWNoZSA9ICgpID0+IHsNCiAgICBldmFsQ2FjaGUuY2xlYXIoKTsNCn07DQoNCi8vIOWJquaeneW8gOWFs++8muWujOaVtOivhOS8sOS4i+iLpeW8gOWxgOWHuuW6n+aji+WImeWFiOWFs++8jOS/neaji+WKm+WGjemHjeagh+Wumgpjb25zdCBTRUFSQ0hfUVVJRVNDRU5DRV9ERVBUSCA9IDI7CgovLyDnnYDms5XlkIjms5XmgKfvvJp0cnVlPeaQnOe0ouWGheivlei1sOaXtuajgOa1i++8iOWPr+i3s+i/h+WJquaeneacquinpuWPiuedgOazle+8ie+8m2ZhbHNlPXByZXBhcmUg5pe25YWo6YePIGZpbHRlckxlZ2FsTW92ZXPvvIjml6fot6/lvoTvvIkKbGV0IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPSB0cnVlOw0KDQovLyBab2JyaXN0L1RU77yadHJ1ZT3mkJzntKLlhoXlop7ph4/nu7TmiqTlsYDpnaLlk4jluIwgKyDmlbDlgLwgVFQga2V577ybZmFsc2U95q+P6IqC54K55YWo55uYIGhhc2ggKyDlrZfnrKbkuLIga2V577yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQ0KLy8g6LCD6K+V77ya5aKe6YeP5ZCO5LiO5YWo55uYIGhhc2gg5q+U5a+577yI5LuF5qCh6aqM6ISa5pys5byA5ZCv77yM5q2j5byP5pCc57Si5YWz6Zet77yJDQoNCi8vIOaQnOe0ouWQr+WPke+8muadgOaji+ihqCArIOWOhuWPsuWQr+WPke+8iOavj+asoSBnZXRCZXN0TW92ZSDph43nva7vvIkNCmxldCBraWxsZXJNb3ZlcyA9IFtdOw0KbGV0IGhpc3RvcnlUYWJsZSA9IG51bGw7DQoNCmNvbnN0IHJlc2V0U2VhcmNoSGV1cmlzdGljcyA9IChtYXhEZXB0aCkgPT4gew0KICAgIGtpbGxlck1vdmVzID0gQXJyYXkobWF4RGVwdGggKyAyKS5maWxsKG51bGwpLm1hcCgoKSA9PiBbbnVsbCwgbnVsbF0pOw0KICAgIGhpc3RvcnlUYWJsZSA9IG5ldyBJbnQzMkFycmF5KFJFTF9TUVVBUkVTIDw8IDcpOw0KfTsNCg0KY29uc3QgaXNTYW1lTW92ZSA9IChhLCBiKSA9Pg0KICAgIGEgIT0gbnVsbCAmJiBiICE9IG51bGwgJiYNCiAgICBtb3ZlRnJvbVNxKGEpID09PSBtb3ZlRnJvbVNxKGIpICYmDQogICAgbW92ZVRvU3EoYSkgPT09IG1vdmVUb1NxKGIpOw0KDQpjb25zdCBzdG9yZUtpbGxlck1vdmUgPSAoZGVwdGgsIG1vdmUpID0+IHsNCiAgICBpZiAoZGVwdGggPCAwIHx8IGRlcHRoID49IGtpbGxlck1vdmVzLmxlbmd0aCB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGNvbnN0IHNsb3QgPSBraWxsZXJNb3Zlc1tkZXB0aF07DQogICAgaWYgKGlzU2FtZU1vdmUoc2xvdFswXSwgbW92ZSkpIHJldHVybjsNCiAgICBzbG90WzFdID0gc2xvdFswXTsNCiAgICBzbG90WzBdID0gaXNFbmNvZGVkTW92ZShtb3ZlKSA/IG1vdmUgOiBlbmNvZGVNb3ZlKG1vdmUuZnJvbSwgbW92ZS50byk7DQp9Ow0KDQpjb25zdCBhZGRIaXN0b3J5U2NvcmUgPSAobW92ZSwgZGVwdGgpID0+IHsNCiAgICBpZiAoIWhpc3RvcnlUYWJsZSB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGNvbnN0IGtleSA9IChtb3ZlRnJvbVNxKG1vdmUpIDw8IDcpIHwgbW92ZVRvU3EobW92ZSk7DQogICAgaGlzdG9yeVRhYmxlW2tleV0gKz0gZGVwdGggKiBkZXB0aDsNCn07DQoNCmNvbnN0IGdldEhpc3RvcnlTY29yZSA9IChtb3ZlKSA9PiB7DQogICAgaWYgKCFoaXN0b3J5VGFibGUgfHwgIW1vdmUpIHJldHVybiAwOw0KICAgIHJldHVybiBoaXN0b3J5VGFibGVbKG1vdmVGcm9tU3EobW92ZSkgPDwgNykgfCBtb3ZlVG9TcShtb3ZlKV07DQp9Ow0KDQovLyBXb3JrZXIgbWVzc2FnZSBoYW5kbGluZw0KaWYgKHR5cGVvZiBzZWxmICE9PSAndW5kZWZpbmVkJykgew0KICAgIHNlbGYub25tZXNzYWdlID0gZnVuY3Rpb24oZSkgew0KICAgIGNvbnN0IHsgdHlwZSwgcGF5bG9hZCB9ID0gZS5kYXRhOw0KICAgIA0KICAgIHN3aXRjaCAodHlwZSkgeyAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdTRUFSQ0gnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBzZWFyY2hCb2FyZCwgdHVybjogc2VhcmNoVHVybiwgZGVwdGg6IHNlYXJjaERlcHRoLCBnYW1lSWQsIG9wZW5pbmdCb29rRW5hYmxlZDogc2VhcmNoT3BlbmluZ0Jvb2tFbmFibGVkID0gdHJ1ZSwgcGx5OiBzZWFyY2hQbHkgPSAwLCBlbmFibGVUaW1lTGltaXQ6IHNlYXJjaEVuYWJsZVRpbWVMaW1pdCA9IGZhbHNlLCBleGFjdFJvb3RTY29yZXM6IHNlYXJjaEV4YWN0Um9vdFNjb3JlcyA9IGZhbHNlLCBwcm9maWxlOiBzZWFyY2hQcm9maWxlLCBjb2xsZWN0TW92ZVNlcXVlbmNlOiBzZWFyY2hDb2xsZWN0TW92ZVNlcXVlbmNlIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgU0VBUkNIX1BST0ZJTEUgPSAhIXNlYXJjaFByb2ZpbGU7DQogICAgICAgICAgICAvLyBTZXQgb3BlbmluZyBib29rIGVuYWJsZWQgc3RhdHVzDQogICAgICAgICAgICBvcGVuaW5nQm9vay5zZXRFbmFibGVkKHNlYXJjaE9wZW5pbmdCb29rRW5hYmxlZCk7DQogICAgICAgICAgICAvLyDorrDlvZXmkJzntKLlvIDlp4vml7bpl7QNCiAgICAgICAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgICAgICAgICAgLy8g5omn6KGM5pCc57SiDQogICAgICAgICAgICBjb25zdCBiZXN0U2VhcmNoTW92ZSA9IGdldEJlc3RNb3ZlKHNlYXJjaEJvYXJkLCBzZWFyY2hUdXJuLCBzZWFyY2hEZXB0aCwgc2VhcmNoUGx5LCBzZWFyY2hFbmFibGVUaW1lTGltaXQsIHNlYXJjaEV4YWN0Um9vdFNjb3Jlcywgc2VhcmNoQ29sbGVjdE1vdmVTZXF1ZW5jZSk7DQogICAgICAgICAgICAvLyDorrDlvZXmkJzntKLnu5PmnZ/ml7bpl7TlubborqHnrpfmgJ3ogIPml7bpl7QNCiAgICAgICAgICAgIGNvbnN0IGVuZFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKTsNCiAgICAgICAgICAgIGNvbnN0IHRoaW5raW5nVGltZSA9IGVuZFRpbWUgLSBzdGFydFRpbWU7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOajgOafpeaYr+WQpuadpeiHquW8gOWxgOW6kw0KICAgICAgICAgICAgY29uc3QgYm9va01vdmVTZWFyY2ggPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShzZWFyY2hCb2FyZCwgc2VhcmNoUGx5KTsNCiAgICAgICAgICAgIGNvbnN0IGZyb21Cb29rU2VhcmNoID0gISFib29rTW92ZVNlYXJjaCAmJiBKU09OLnN0cmluZ2lmeShib29rTW92ZVNlYXJjaCkgPT09IEpTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5re75Yqg5oCn6IO957uf6K6h5pel5b+XDQogICAgICAgICAgICBsb2dQZXJmU3RhdHMoc2VhcmNoVHVybik7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOa3u+WKoOaAneiAg+aXtumXtOaXpeW/lw0KICAgICAgICAgICAgY29uc3QgZm9ybWF0TW92ZSA9IChtb3ZlKSA9PiBtb3ZlPy5mcm9tICYmIG1vdmU/LnRvCiAgICAgICAgICAgICAgICA/IGAoJHttb3ZlLmZyb20ucn0sJHttb3ZlLmZyb20uY30pLT4oJHttb3ZlLnRvLnJ9LCR7bW92ZS50by5jfSlgCiAgICAgICAgICAgICAgICA6ICdub25lJzsKICAgICAgICAgICAgY29uc29sZS5sb2coYFNlYXJjaCBjb21wbGV0ZTogZ2FtZT0ke2dhbWVJZH0sIHRpbWU9JHtNYXRoLnJvdW5kKHRoaW5raW5nVGltZSl9bXMsIGJlc3Q9JHtmb3JtYXRNb3ZlKGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlKX0gc2NvcmU9JHtiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZVNjb3JlfSwgc2Vjb25kPSR7Zm9ybWF0TW92ZShiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZSl9LCBib29rPSR7ZnJvbUJvb2tTZWFyY2h9YCk7CiAgICAgICAgICAgIC8vIOWPkemAgeaQnOe0oue7k+aenOWSjOaAneiAg+aXtumXtA0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7IA0KICAgICAgICAgICAgICAgIHR5cGU6ICdTRUFSQ0hfQ09NUExFVEUnLCANCiAgICAgICAgICAgICAgICBwYXlsb2FkOiB7IA0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZTogYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmUsIA0KICAgICAgICAgICAgICAgICAgICBzZWNvbmRCZXN0TW92ZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kQmVzdE1vdmUsIA0KICAgICAgICAgICAgICAgICAgICBnYW1lSWQsIA0KICAgICAgICAgICAgICAgICAgICBmcm9tQm9vazogZnJvbUJvb2tTZWFyY2gsIA0KICAgICAgICAgICAgICAgICAgICB0aGlua2luZ1RpbWU6IE1hdGgucm91bmQodGhpbmtpbmdUaW1lKSwgLy8g5Zub6IiN5LqU5YWl5Yiw5q+r56eSDQogICAgICAgICAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogYmVzdFNlYXJjaE1vdmUubW92ZVNlcXVlbmNlLA0KICAgICAgICAgICAgICAgICAgICBzZWNvbmRNb3ZlU2VxdWVuY2U6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZE1vdmVTZXF1ZW5jZSwNCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTY29yZTogYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmVTY29yZSwNCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kQmVzdE1vdmVTY29yZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kQmVzdE1vdmVTY29yZSwNCiAgICAgICAgICAgICAgICAgICAgYWxsTW92ZXNXaXRoU2NvcmVzOiBiZXN0U2VhcmNoTW92ZS5hbGxNb3Zlc1dpdGhTY29yZXMgfHwgW10sDQogICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlZERlcHRoOiBiZXN0U2VhcmNoTW92ZS5jb21wbGV0ZWREZXB0aCwNCiAgICAgICAgICAgICAgICAgICAgcGVyZjogc25hcHNob3RQZXJmU3RhdHMoKQ0KICAgICAgICAgICAgICAgIH0gDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGNhc2UgJ2dldFZhbGlkTW92ZXMnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiB2bUJvYXJkLCBwb3M6IHZtUG9zIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgc3luY0dlbmVyYWxQb3NDYWNoZSh2bUJvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IHZhbGlkTW92ZXMgPSBnZXRWYWxpZE1vdmVzKHZtQm9hcmQsIHZtUG9zKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICd2YWxpZE1vdmVzJywNCiAgICAgICAgICAgICAgICBtb3ZlczogdmFsaWRNb3Zlcw0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2dldFBpZWNlUmVsYXRpb25zJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogcHJCb2FyZCwgcG9zOiBwclBvcyB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gcHJCb2FyZFtwclBvcy5yXVtwclBvcy5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g6LCD55SoZXZhbHVhdGVCb2FyZOiOt+WPluWujOaVtOeahOaji+WtkOS/oeaBr+WSjGJvYXJkSW5mbw0KICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoKTsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRFdmFsdWF0aW9uID0gZXZhbHVhdGVCb2FyZChwckJvYXJkLCBudWxsLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgY29uc3QgcGllY2VzSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5waWVjZXNJbmZvOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRJbmZvID0gYm9hcmRFdmFsdWF0aW9uLmJvYXJkSW5mbzsNCg0KICAgICAgICAgICAgaWYgKGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKSB7DQogICAgICAgICAgICAgICAgaHlkcmF0ZVJlbGF0aW9uc0Zyb21NYXNrcyhwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBib2FyZEluZm8g5qC85YaF5Y+v6IO95pivIHBpZWNlc0luZm8g5byV55So77yM57uf5LiA5pig5bCE5Li6IHtyLGN9IOS+myBVSSDkvb/nlKgNCiAgICAgICAgICAgIGNvbnN0IHJhd0NvbnRyb2xsZXJzID0gYm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkDQogICAgICAgICAgICAgICAgPyAoYm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkW3ByUG9zLnJdW3ByUG9zLmNdIHx8IFtdKQ0KICAgICAgICAgICAgICAgIDogKGJvYXJkSW5mb1twclBvcy5yXSAmJiBib2FyZEluZm9bcHJQb3Mucl1bcHJQb3MuY10pIHx8IFtdOw0KICAgICAgICAgICAgY29uc3QgY29udHJvbGxlcnMgPSByYXdDb250cm9sbGVycy5tYXAoKGN0cmwpID0+ICh7IHI6IGN0cmwuciwgYzogY3RybC5jIH0pKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgbGV0IHJlbGF0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLCANCiAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnk6IFtdLCANCiAgICAgICAgICAgICAgICBndWFyZDogW10sIA0KICAgICAgICAgICAgICAgIGd1YXJkZWRCeTogW10sIA0KICAgICAgICAgICAgICAgIGNvbnRyb2w6IFtdLA0KICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJzDQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDlpoLmnpzngrnlh7vnmoTmmK/mo4vlrZDvvIzov5Tlm57or6Xmo4vlrZDnmoTlhbPns7vkv6Hmga8NCiAgICAgICAgICAgIGlmIChwaWVjZSkgew0KICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIGN1cnJlbnQgcGllY2UgaW5mbw0KICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRQaWVjZUluZm8gPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHByUG9zLnIgJiYgcC5jID09PSBwclBvcy5jKTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoY3VycmVudFBpZWNlSW5mbykgew0KICAgICAgICAgICAgICAgICAgICAvLyBFeHRyYWN0IHJlbGF0aW9ucw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0aHJlYXQgPSBjdXJyZW50UGllY2VJbmZvLnRocmVhdC5tYXAodGhyZWF0UGllY2UgPT4gKHsgcjogdGhyZWF0UGllY2UuciwgYzogdGhyZWF0UGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRocmVhdGVuZWRCeSA9IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0ZW5lZEJ5Lm1hcCh0aHJlYXRlbmVkQnlQaWVjZSA9PiAoeyByOiB0aHJlYXRlbmVkQnlQaWVjZS5yLCBjOiB0aHJlYXRlbmVkQnlQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZ3VhcmQgPSBjdXJyZW50UGllY2VJbmZvLmd1YXJkLm1hcChndWFyZFBpZWNlID0+ICh7IHI6IGd1YXJkUGllY2UuciwgYzogZ3VhcmRQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZ3VhcmRlZEJ5ID0gY3VycmVudFBpZWNlSW5mby5ndWFyZGVkQnkubWFwKGd1YXJkZWRCeVBpZWNlID0+ICh7IHI6IGd1YXJkZWRCeVBpZWNlLnIsIGM6IGd1YXJkZWRCeVBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sID0gKGN1cnJlbnRQaWVjZUluZm8uY29udHJvbCB8fCBbXSkubWFwKGNvbnRyb2xQb3MgPT4gKHsgcjogY29udHJvbFBvcy5yLCBjOiBjb250cm9sUG9zLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25zID0gew0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0LCANCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeSwgDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZCwgDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZGVkQnksIA0KICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbCwNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJzDQogICAgICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VSZWxhdGlvbnMnLA0KICAgICAgICAgICAgICAgIHJlbGF0aW9uczogcmVsYXRpb25zDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnY2hlY2tHYW1lU3RhdGUnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBjZ3NCb2FyZCwgdHVybjogY2dzVHVybiwgcmVxdWVzdElkIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgZ2FtZVN0YXRlID0gY2hlY2tHYW1lU3RhdGUoY2dzQm9hcmQsIGNnc1R1cm4pOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2dhbWVTdGF0ZScsDQogICAgICAgICAgICAgICAgc3RhdGU6IGdhbWVTdGF0ZSwNCiAgICAgICAgICAgICAgICByZXF1ZXN0SWQNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdldmFsdWF0ZUJvYXJkJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogZXZhbEJvYXJkLCB0dXJuOiBldmFsVHVybiB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIC8vIOaJk+WNsOaOpeaUtueahOWPguaVsA0KICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoKTsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgY29uc3QgZGV0YWlsZWRFdmFsID0gZXZhbHVhdGVCb2FyZChldmFsQm9hcmQsIGV2YWxUdXJuLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2RldGFpbGVkRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZGV0YWlsZWRFdmFsDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQoNCiAgICAgICAgY2FzZSAnZXZhbHVhdGVQaWVjZSc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHBpZWNlRXZhbEJvYXJkLCBwb3M6IHBpZWNlRXZhbFBvcywgdHVybiB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gcGllY2VFdmFsQm9hcmRbcGllY2VFdmFsUG9zLnJdW3BpZWNlRXZhbFBvcy5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFwaWVjZSkgew0KICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogew0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiAwDQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQogICAgICAgICAgICBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDkuLvliqjosIPnlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE6K+E5Lyw5L+h5oGvDQogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5ri45oiP6Zi25q61DQogICAgICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoKTsNCiAgICAgICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkRXZhbHVhdGlvbiA9IGV2YWx1YXRlQm9hcmQocGllY2VFdmFsQm9hcmQsIHR1cm4sIGdhbWVTdGFnZSk7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgLy8g5LuOZXZhbHVhdGVCb2FyZOeahOi/lOWbnuWAvOS4reaJvuWIsOW9k+WJjeaji+WtkOeahOS/oeaBrw0KICAgICAgICAgICAgICAgIGN1cnJlbnRQaWVjZUluZm8gPSBib2FyZEV2YWx1YXRpb24ucGllY2VzSW5mby5maW5kKA0KICAgICAgICAgICAgICAgICAgICBwID0+IHAuciA9PT0gcGllY2VFdmFsUG9zLnIgJiYgcC5jID09PSBwaWVjZUV2YWxQb3MuYw0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRQaWVjZUluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5bqU55So5p2D6YeN5bm26L+U5Zue5Y2V5Liq5qOL5a2Q55qE6K+E5Lyw5YC8DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGV2YWx1YXRpb24gPSB7DQogICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogY3VycmVudFBpZWNlSW5mby5tYXRlcmlhbFZhbHVlICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiBjdXJyZW50UGllY2VJbmZvLnBvc2l0aW9uVmFsdWUgKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLA0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHk6IGN1cnJlbnRQaWVjZUluZm8ubW9iaWxpdHlWYWx1ZSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0VmFsdWUgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogY3VycmVudFBpZWNlSW5mby5zYWZldHlWYWx1ZSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiBjdXJyZW50UGllY2VJbmZvLnRhY3RpY1ZhbHVlICogVkFMVUVfV0VJR0hUUy50YWN0aWMNCiAgICAgICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgICAgICAgICBldmFsdWF0aW9uOiBldmFsdWF0aW9uDQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWmguaenOS7jeeEtuaJvuS4jeWIsOaji+WtkOS/oeaBr++8jOi/lOWbnum7mOiupOWAvA0KICAgICAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiAwDQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdpc0NoZWNrJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogY0JvYXJkLCBjb2xvcjogY0NvbG9yLCByZXF1ZXN0SWQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBzeW5jR2VuZXJhbFBvc0NhY2hlKGNCb2FyZCk7DQogICAgICAgICAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVjayhjQm9hcmQsIGNDb2xvcik7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAnY2hlY2snLA0KICAgICAgICAgICAgICAgIGlzQ2hlY2s6IGluQ2hlY2ssDQogICAgICAgICAgICAgICAgcmVxdWVzdElkDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnaXNWYWxpZFBsYWNlbWVudCc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgdHlwZTogaXBUeXBlLCBjb2xvcjogaXBDb2xvciwgciwgYyB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IHZhbGlkUGxhY2VtZW50ID0gaXNWYWxpZFBsYWNlbWVudChpcFR5cGUsIGlwQ29sb3IsIHIsIGMpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ3ZhbGlkUGxhY2VtZW50JywNCiAgICAgICAgICAgICAgICBpc1ZhbGlkOiB2YWxpZFBsYWNlbWVudA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2FkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgbW92ZXMsIHdlaWdodHMgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICAvLyBBZGQgdGhlIG9wZW5pbmcgbGluZSB0byB0aGUgb3BlbmluZyBib29rDQogICAgICAgICAgICBvcGVuaW5nQm9vay5hZGRPcGVuaW5nTGluZUZyb21TdHJpbmcoW21vdmVzXSwgd2VpZ2h0cyk7DQogICAgICAgICAgICAvLyBTZW5kIGNvbmZpcm1hdGlvbg0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7IA0KICAgICAgICAgICAgICAgIHR5cGU6ICdvcGVuaW5nTGluZUFkZGVkJywgDQogICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSANCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdtb3Zlc1RvTm90YXRpb24nOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBub3RhdGlvbiA9IG9wZW5pbmdCb29rLm1vdmVzVG9Ob3RhdGlvbihib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5KTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnbm90YXRpb24nLCANCiAgICAgICAgICAgICAgICBub3RhdGlvbjogbm90YXRpb24gDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnbm90YXRpb25Ub01vdmVzJzogew0KICAgICAgICAgICAgY29uc3QgeyBub3RhdGlvbjogbm90YXRpb25TdHJpbmcsIGluaXRpYWxCb2FyZCB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzRnJvbU5vdGF0aW9uID0gb3BlbmluZ0Jvb2subm90YXRpb25Ub01vdmVzKG5vdGF0aW9uU3RyaW5nLCBpbml0aWFsQm9hcmQpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7IA0KICAgICAgICAgICAgICAgIHR5cGU6ICdtb3ZlcycsIA0KICAgICAgICAgICAgICAgIG1vdmVzOiBtb3Zlc0Zyb21Ob3RhdGlvbiANCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdzZXRWYWx1ZVdlaWdodHMnOiB7DQogICAgICAgICAgICBWQUxVRV9XRUlHSFRTID0geyAuLi5WQUxVRV9XRUlHSFRTLCAuLi5wYXlsb2FkIH07DQogICAgICAgICAgICBjb25zb2xlLmxvZygnVXBkYXRlZCBWQUxVRV9XRUlHSFRTOicsIFZBTFVFX1dFSUdIVFMpOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQp9Ow0KDQogICAgLy8gT3ZlcnJpZGUgY29uc29sZS5sb2cgdG8gc2VuZCBtZXNzYWdlcyBiYWNrIHRvIG1haW4gdGhyZWFkDQogICAgY29uc3Qgb3JpZ2luYWxDb25zb2xlTG9nID0gY29uc29sZS5sb2c7DQogICAgY29uc29sZS5sb2cgPSBmdW5jdGlvbiguLi5hcmdzKSB7DQogICAgICAgIC8vIFNlbmQgdG8gbWFpbiB0aHJlYWQNCiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICB0eXBlOiAnbG9nJywNCiAgICAgICAgICAgIGRhdGE6IGFyZ3Muam9pbignICcpDQogICAgICAgIH0pOw0KICAgICAgICANCiAgICAgICAgLy8gQWxzbyBsb2cgdG8gd29ya2VyIGNvbnNvbGUNCiAgICAgICAgb3JpZ2luYWxDb25zb2xlTG9nLmFwcGx5KGNvbnNvbGUsIGFyZ3MpOw0KICAgIH07DQp9DQoNCi8vIOepuuedgOWJquaene+8muaciei/m+aUu+WtkOWKm+aXtuaJjeWFgeiuuO+8iOmBv+WFjeWwhi/lo6sv6LGh5q6L5bGA6YC8552A6K+v5Ymq77yJDQpjb25zdCBjYW5Eb051bGxNb3ZlID0gKGJvYXJkLCBjb2xvcikgPT4gew0KICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAoIXAgfHwgcC5jb2xvciAhPT0gY29sb3IpIGNvbnRpbnVlOw0KICAgICAgICAgICAgaWYgKHAudHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHAudHlwZSA9PT0gJ2hvcnNlJyB8fCBwLnR5cGUgPT09ICdjYW5ub24nIHx8IHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgcmV0dXJuIGZhbHNlOw0KfTsNCg0KLy8g5pCc57Si55SoIFRUIGtlee+8muWinumHj+aooeW8j+S4uiBudW1iZXLvvIzml6fmqKHlvI/kuLogYCR7aGFzaH06JHtzaWRlfWAg5a2X56ym5LiyDQpjb25zdCBtYWtlU2VhcmNoVFRLZXkgPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSGFzaCkgPT4gew0KICAgIHJldHVybiB6b2JyaXN0SGFzaGVyLnR0S2V5RnJvbUhhc2goYm9hcmRIYXNoLCBjdXJyZW50UGxheWVyKTsNCn07DQoNCi8vIOi1sOWtkOWQjueahOWtkOiKgueCueWxgOmdouWTiOW4jO+8iOS7heWinumHj+aooeW8j+acieaEj+S5ie+8m+mhu+WcqCBtYWtlIOWJjeS/neWtmCBtb3ZpbmdQaWVjZe+8iQ0KY29uc3QgY2hpbGRCb2FyZEhhc2ggPSAoYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpID0+IHsNCiAgICBwZXJmU3RhdHMuaW5jcmVtZW50YWxIYXNoVXBkYXRlcysrOw0KICAgIGlmIChpc0VuY29kZWRNb3ZlKG1vdmUpKSB7DQogICAgICAgIGxldCBuZXdIYXNoID0gYm9hcmRIYXNoOw0KICAgICAgICBjb25zdCBtb3ZpbmdJZHggPSB6b2JyaXN0SGFzaGVyLnBpZWNlSW5kZXgobW92aW5nUGllY2UpOw0KICAgICAgICBjb25zdCBmcm9tID0gbW92ZSA+Pj4gNzsNCiAgICAgICAgY29uc3QgdG8gPSBtb3ZlICYgTU9WRV9UT19NQVNLOw0KICAgICAgICBpZiAobW92aW5nSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgIG5ld0hhc2ggXj0gem9icmlzdEhhc2hlci5oYXNoVGFibGVbKGZyb20gLyA5KSB8IDBdW2Zyb20gJSA5XVttb3ZpbmdJZHhdOw0KICAgICAgICAgICAgbmV3SGFzaCBePSB6b2JyaXN0SGFzaGVyLmhhc2hUYWJsZVsodG8gLyA5KSB8IDBdW3RvICUgOV1bbW92aW5nSWR4XTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoY2FwdHVyZWQpIHsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkSWR4ID0gem9icmlzdEhhc2hlci5waWVjZUluZGV4KGNhcHR1cmVkKTsNCiAgICAgICAgICAgIGlmIChjYXB0dXJlZElkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgbmV3SGFzaCBePSB6b2JyaXN0SGFzaGVyLmhhc2hUYWJsZVsodG8gLyA5KSB8IDBdW3RvICUgOV1bY2FwdHVyZWRJZHhdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBuZXdIYXNoOw0KICAgIH0NCiAgICByZXR1cm4gem9icmlzdEhhc2hlci51cGRhdGVIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCn07DQoNCi8vIOaQnOe0oueUqOWHgOWIhu+8muWujOaVtOW9ouWKv+ivhOS8sO+8iOWFs+ezuy/lqIHog4Ev5a6J5YWoL+acuuWKqO+8ie+8jOS7hei3s+i/h+e7iOWxgOedgOazleaemuS4vu+8m+W4piBab2JyaXN0IOe8k+WtmA0KY29uc3Qgc3RhdGljU2VhcmNoRXZhbCA9IChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGJvYXJkSGFzaCA9IDApID0+IHsNCiAgICBjb25zdCBjYWNoZUtleSA9IHpvYnJpc3RIYXNoZXIuZXZhbENhY2hlS2V5RnJvbUhhc2goYm9hcmRIYXNoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSk7DQogICAgaWYgKGV2YWxDYWNoZS5oYXMoY2FjaGVLZXkpKSB7DQogICAgICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnN0YXRpY0V2YWxDYWNoZUhpdHMrKzsNCiAgICAgICAgcmV0dXJuIGV2YWxDYWNoZS5nZXQoY2FjaGVLZXkpOw0KICAgIH0NCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5zdGF0aWNFdmFsQ2FjaGVNaXNzZXMrKzsNCiAgICBsZXQgbmV0Ow0KICAgIGlmICghU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICBuZXQgPSBldmFsdWF0ZVNlYXJjaExlYWZGYXN0KGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSk7DQogICAgfSBlbHNlIHsNCiAgICAgICAgY29uc3QgZXZhbFJlc3VsdCA9IGV2YWx1YXRlQm9hcmQoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB7IGZvclNlYXJjaExlYWY6IHRydWUgfSk7DQogICAgICAgIGNvbnN0IG9wcG9uZW50ID0gc2VhcmNoSW5pdGlhdG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgbmV0ID0gZXZhbFJlc3VsdFtzZWFyY2hJbml0aWF0b3JdLnRvdGFsIC0gZXZhbFJlc3VsdFtvcHBvbmVudF0udG90YWw7DQogICAgfQ0KICAgIGlmIChldmFsQ2FjaGUuc2l6ZSA+PSBFVkFMX0NBQ0hFX01BWCkgew0KICAgICAgICAvLyDnroDljZXmt5jmsbDmnIDml6nlhpnlhaXnmoTkuIDmibnvvIzpgb/lhY0gTWFwIOaXoOmZkOa2qA0KICAgICAgICBsZXQgZHJvcCA9IDA7DQogICAgICAgIGZvciAoY29uc3QgayBvZiBldmFsQ2FjaGUua2V5cygpKSB7DQogICAgICAgICAgICBldmFsQ2FjaGUuZGVsZXRlKGspOw0KICAgICAgICAgICAgaWYgKCsrZHJvcCA+PSA0MDk2KSBicmVhazsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBldmFsQ2FjaGUuc2V0KGNhY2hlS2V5LCBuZXQpOw0KICAgIHJldHVybiBuZXQ7DQp9Ow0KDQovLyDnlJ/miJDlvZPliY3mlrnlkIPlrZDnnYDvvIjkvpvpnZnpu5jmkJzntKLvvIkNCmNvbnN0IGdlbmVyYXRlQ2FwdHVyZXNGb3JTZWFyY2ggPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIpID0+IHsNCiAgICBjb25zdCBfX3QwID0gU0VBUkNIX1BST0ZJTEUgPyBwZXJmb3JtYW5jZS5ub3coKSA6IDA7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuY2FwdHVyZUdlbkNvdW50Kys7DQogICAgY29uc3QgY2FwdHVyZXMgPSBbXTsNCiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgaWYgKHBpZWNlU3RhdGUpIHsNCiAgICAgICAgY29uc3QgcmVjb3JkcyA9IHBpZWNlU3RhdGUucmVjb3JkczsNCiAgICAgICAgY29uc3Qgc3F1YXJlVG9TbG90ID0gcGllY2VTdGF0ZS5zcXVhcmVUb1Nsb3Q7DQogICAgICAgIGNvbnN0IHNxdWFyZUNvZGVzID0gcGllY2VTdGF0ZS5zcXVhcmVDb2RlczsNCiAgICAgICAgY29uc3QgcGllY2VDb2RlcyA9IHBpZWNlU3RhdGUucGllY2VDb2RlczsNCiAgICAgICAgZm9yIChsZXQgc3EgPSAwOyBzcSA8IFJFTF9TUVVBUkVTOyBzcSsrKSB7DQogICAgICAgICAgICBjb25zdCBzbG90ID0gc3F1YXJlVG9TbG90W3NxXTsNCiAgICAgICAgICAgIGlmIChzbG90IDwgMCkgY29udGludWU7DQogICAgICAgICAgICBjb25zdCByZWNvcmQgPSByZWNvcmRzW3Nsb3RdOw0KICAgICAgICAgICAgaWYgKCFyZWNvcmQuYWxpdmUgfHwgcmVjb3JkLnBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSBjb250aW51ZTsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCArPSBhcHBlbmRTZWFyY2hQc2V1ZG9Nb3Zlc0ZvclBpZWNlKA0KICAgICAgICAgICAgICAgIGNhcHR1cmVzLCBzcSwgcGllY2VDb2Rlc1tzbG90XSwgc3F1YXJlQ29kZXMsIHRydWUNCiAgICAgICAgICAgICk7DQogICAgICAgIH0NCiAgICAgICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuY2FwdHVyZUdlbk1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsNCiAgICAgICAgcmV0dXJuIGNhcHR1cmVzOw0KICAgIH0NCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcGllY2UgfHwgcGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIGNvbnRpbnVlOw0KICAgICAgICAgICAgY29uc3QgZnJvbSA9IHsgciwgYyB9Ow0KICAgICAgICAgICAgY29uc3QgcHNldWRvID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UpOw0KICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IHBzZXVkby5sZW5ndGg7DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBzZXVkby5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHRvID0gcHNldWRvW2ldOw0KICAgICAgICAgICAgICAgIGlmIChib2FyZFt0by5yXVt0by5jXSkgY2FwdHVyZXMucHVzaChlbmNvZGVNb3ZlRnJvbUNvb3JkcyhyLCBjLCB0by5yLCB0by5jKSk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuY2FwdHVyZUdlbk1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsNCiAgICByZXR1cm4gY2FwdHVyZXM7DQp9Ow0KDQovLyDpnZnpu5jmkJzntKLvvJpzdGFuZC1wYXQg55So5a6M5pW05b2i5Yq/6K+E5Lyw77yb5LuF5a+55ZCD5a2Q5bu25Ly477yIUVPiiaQz77yJDQovLyBQbGF5IHNlYXJjaCBoYXMgbm8gUFYgdG8gcmV0YWluLCBzbyBrZWVwIGl0cyByZWN1cnNpdmUgaG90IHBhdGggcHJpbWl0aXZlLW9ubHkuDQovLyBBbmFseXNpcyBjb250aW51ZXMgdG8gdXNlIHRoZSBvYmplY3QtcmV0dXJuaW5nIGZ1bmN0aW9ucyBiZWxvdy4NCmNvbnN0IHNvcnRDYXB0dXJlc1BsYXkgPSAoY2FwdHVyZXMsIGJvYXJkLCBnYW1lU3RhZ2UpID0+IHsNCiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgY29uc3Qgc3F1YXJlVG9TbG90ID0gcGllY2VTdGF0ZSAmJiBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsNCiAgICBjb25zdCBwaWVjZUNvZGVzID0gcGllY2VTdGF0ZSAmJiBwaWVjZVN0YXRlLnBpZWNlQ29kZXM7DQogICAgY29uc3QgbWF0ZXJpYWxWYWx1ZXMgPSBwaWVjZVN0YXRlID8gcGllY2VTdGF0ZS5tYXRlcmlhbFZhbHVlcyA6IHNlYXJjaE1hdGVyaWFsVGFibGUoZ2FtZVN0YWdlKTsNCg0KICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBjYXB0dXJlcy5sZW5ndGg7IGluZGV4KyspIHsNCiAgICAgICAgY29uc3QgbW92ZSA9IGNhcHR1cmVzW2luZGV4XTsNCiAgICAgICAgY29uc3QgZnJvbVNxID0gbW92ZSA+Pj4gNzsNCiAgICAgICAgY29uc3QgdG9TcSA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7DQogICAgICAgIGxldCBzY29yZTsNCiAgICAgICAgaWYgKHBpZWNlU3RhdGUpIHsNCiAgICAgICAgICAgIHNjb3JlID0gbWF0ZXJpYWxWYWx1ZXNbcGllY2VDb2Rlc1tzcXVhcmVUb1Nsb3RbdG9TcV1dICYgN10gKiAxNiAtDQogICAgICAgICAgICAgICAgbWF0ZXJpYWxWYWx1ZXNbcGllY2VDb2Rlc1tzcXVhcmVUb1Nsb3RbZnJvbVNxXV0gJiA3XTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIHNjb3JlID0NCiAgICAgICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJvYXJkW21vdmVUb1IobW92ZSldW21vdmVUb0MobW92ZSldLCBnYW1lU3RhZ2UpICogMTYgLQ0KICAgICAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYm9hcmRbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldLCBnYW1lU3RhZ2UpOw0KICAgICAgICB9DQogICAgICAgIGNhcHR1cmVTb3J0U2NvcmVTY3JhdGNoW2luZGV4XSA9IHNjb3JlOw0KICAgIH0NCg0KICAgIC8vIFN0YWJsZSBpbnNlcnRpb24gb3JkZXJpbmcgZXhhY3RseSBtYXRjaGVzIHRoZSBwcmV2aW91cyBudW1lcmljIGNvbXBhcmF0b3IuDQogICAgZm9yIChsZXQgaSA9IDE7IGkgPCBjYXB0dXJlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gY2FwdHVyZXNbaV07DQogICAgICAgIGNvbnN0IHNjb3JlID0gY2FwdHVyZVNvcnRTY29yZVNjcmF0Y2hbaV07DQogICAgICAgIGxldCBqID0gaSAtIDE7DQogICAgICAgIHdoaWxlIChqID49IDAgJiYgY2FwdHVyZVNvcnRTY29yZVNjcmF0Y2hbal0gPCBzY29yZSkgew0KICAgICAgICAgICAgY2FwdHVyZXNbaiArIDFdID0gY2FwdHVyZXNbal07DQogICAgICAgICAgICBjYXB0dXJlU29ydFNjb3JlU2NyYXRjaFtqICsgMV0gPSBjYXB0dXJlU29ydFNjb3JlU2NyYXRjaFtqXTsNCiAgICAgICAgICAgIGotLTsNCiAgICAgICAgfQ0KICAgICAgICBjYXB0dXJlc1tqICsgMV0gPSBtb3ZlOw0KICAgICAgICBjYXB0dXJlU29ydFNjb3JlU2NyYXRjaFtqICsgMV0gPSBzY29yZTsNCiAgICB9DQogICAgcmV0dXJuIGNhcHR1cmVzOw0KfTsNCg0KY29uc3QgcXVpZXNjZW5jZVBsYXkgPSAoDQogICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGgsIGJvYXJkSGFzaCA9IDANCikgPT4gew0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnF1aWVzY2VuY2VDYWxscysrOw0KICAgIGNvbnN0IHN0YW5kUGF0ID0gc3RhdGljU2VhcmNoRXZhbChiLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRIYXNoKTsNCg0KICAgIGlmIChxc0RlcHRoIDw9IDApIHJldHVybiBzdGFuZFBhdDsNCg0KICAgIGlmIChtYXhpbWl6aW5nKSB7DQogICAgICAgIGlmIChzdGFuZFBhdCA+PSBiZXRhKSByZXR1cm4gc3RhbmRQYXQ7DQogICAgICAgIGlmIChzdGFuZFBhdCA+IGFscGhhKSBhbHBoYSA9IHN0YW5kUGF0Ow0KICAgIH0gZWxzZSB7DQogICAgICAgIGlmIChzdGFuZFBhdCA8PSBhbHBoYSkgcmV0dXJuIHN0YW5kUGF0Ow0KICAgICAgICBpZiAoc3RhbmRQYXQgPCBiZXRhKSBiZXRhID0gc3RhbmRQYXQ7DQogICAgfQ0KDQogICAgY29uc3QgY2FwdHVyZXMgPSBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoKGIsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnF1aWVzY2VuY2VDYXB0dXJlTW92ZXMgKz0gY2FwdHVyZXMubGVuZ3RoOw0KICAgIGlmIChjYXB0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBzdGFuZFBhdDsNCg0KICAgIHNvcnRDYXB0dXJlc1BsYXkoY2FwdHVyZXMsIGIsIGdhbWVTdGFnZSk7DQoNCiAgICBsZXQgYmVzdEV2YWwgPSBzdGFuZFBhdDsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNhcHR1cmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBjYXB0dXJlc1tpXTsNCiAgICAgICAgY29uc3QgbW92aW5nUGllY2UgPSBiW21vdmVGcm9tUihtb3ZlKV1bbW92ZUZyb21DKG1vdmUpXTsNCiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlU2VhcmNoTW92ZShiLCBtb3ZlKTsNCiAgICAgICAgaWYgKGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllcikpIHsNCiAgICAgICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOw0KICAgICAgICAgICAgcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQrKzsNCiAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICB9DQogICAgICAgIGNvbnN0IG5leHRIYXNoID0gY2hpbGRCb2FyZEhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOw0KICAgICAgICBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkKys7DQogICAgICAgIGNvbnN0IG5leHRQbGF5ZXIgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgY29uc3QgdmFsdWUgPSBxdWllc2NlbmNlUGxheSgNCiAgICAgICAgICAgIGIsIGFscGhhLCBiZXRhLCBuZXh0UGxheWVyID09PSBzZWFyY2hJbml0aWF0b3IsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgcXNEZXB0aCAtIDEsIG5leHRIYXNoDQogICAgICAgICk7DQogICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOw0KDQogICAgICAgIGlmIChtYXhpbWl6aW5nKSB7DQogICAgICAgICAgICBpZiAodmFsdWUgPiBiZXN0RXZhbCkgYmVzdEV2YWwgPSB2YWx1ZTsNCiAgICAgICAgICAgIGlmICh2YWx1ZSA+IGFscGhhKSBhbHBoYSA9IHZhbHVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKHZhbHVlIDwgYmVzdEV2YWwpIGJlc3RFdmFsID0gdmFsdWU7DQogICAgICAgICAgICBpZiAodmFsdWUgPCBiZXRhKSBiZXRhID0gdmFsdWU7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIGJyZWFrOw0KICAgIH0NCiAgICByZXR1cm4gYmVzdEV2YWw7DQp9Ow0KDQpjb25zdCBhbHBoYUJldGFQbGF5ID0gKAogICAgYiwgZCwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgc2VhcmNoRGVwdGggPSAwLCBzZWFyY2hJbml0aWF0b3IgPSBjdXJyZW50UGxheWVyLCBnYW1lU3RhZ2UgPSAnbWlkJywgYm9hcmRIYXNoID0gMA0KKSA9PiB7CiAgICBjb25zdCBvcmlnaW5hbEFscGhhID0gYWxwaGE7CiAgICBjb25zdCBvcmlnaW5hbEJldGEgPSBiZXRhOw0KDQogICAgcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzKys7DQogICAgaWYgKCFwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSkgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0gPSAwOw0KICAgIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKys7DQoNCiAgICBpZiAoZCA9PT0gMCkgew0KICAgICAgICByZXR1cm4gcXVpZXNjZW5jZVBsYXkoCiAgICAgICAgICAgIGIsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLAogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgU0VBUkNIX1FVSUVTQ0VOQ0VfREVQVEgsIGJvYXJkSGFzaAogICAgICAgICk7CiAgICB9DQoNCiAgICBjb25zdCB0dEtleSA9IG1ha2VTZWFyY2hUVEtleShiLCBjdXJyZW50UGxheWVyLCBib2FyZEhhc2gpOw0KICAgIGNvbnN0IHR0RW50cnkgPSB0cmFuc3Bvc2l0aW9uVGFibGUucmV0cmlldmUodHRLZXkpOw0KICAgIGxldCB0dE1vdmUgPSBudWxsOw0KICAgIGlmICh0dEVudHJ5KSB7DQogICAgICAgIHR0TW92ZSA9IHR0RW50cnkuYmVzdE1vdmUgfHwgbnVsbDsNCiAgICAgICAgaWYgKHR0RW50cnkuZGVwdGggPj0gZCkgew0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ2V4YWN0JykgcmV0dXJuIHR0RW50cnkudmFsdWU7DQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnbG93ZXJib3VuZCcgJiYgdHRFbnRyeS52YWx1ZSA+PSBiZXRhKSByZXR1cm4gdHRFbnRyeS52YWx1ZTsNCiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICd1cHBlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlIDw9IGFscGhhKSByZXR1cm4gdHRFbnRyeS52YWx1ZTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGNvbnN0IHNlYXJjaEluZm8gPSBwcmVwYXJlU2VhcmNoSW5mbyhiLCBjdXJyZW50UGxheWVyKTsNCiAgICBjb25zdCBhYlBpZWNlc0luZm8gPSBzZWFyY2hJbmZvLnBpZWNlc0luZm87DQogICAgY29uc3QgYWJCb2FyZEluZm8gPSBzZWFyY2hJbmZvLmJvYXJkSW5mbzsNCiAgICBjb25zdCBpbkNoZWNrID0gc2VhcmNoSW5mby5pbkNoZWNrIHx8DQogICAgICAgIChjdXJyZW50UGxheWVyID09PSAncmVkJyAmJiBhYkJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8DQogICAgICAgIChjdXJyZW50UGxheWVyID09PSAnYmxhY2snICYmIGFiQm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKTsNCiAgICBjb25zdCB0ZXJtaW5hbFNjb3JlID0gKCkgPT4gew0KICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGN1cnJlbnRQbGF5ZXIgIT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgY29uc3QgYmFzZVNjb3JlID0gaXNJbml0aWF0b3JXaW5uZXIgPyAxMDAwMDAgOiAtMTAwMDAwOw0KICAgICAgICByZXR1cm4gYmFzZVNjb3JlICsgKGlzSW5pdGlhdG9yV2lubmVyID8gZCA6IChzZWFyY2hEZXB0aCAtIGQpKTsNCiAgICB9Ow0KDQogICAgaWYgKCFzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3QgfHwgc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0Lmxlbmd0aCA9PT0gMCkgew0KICAgICAgICBjb25zdCBnYW1lU3RhdGUgPSBhYkJvYXJkSW5mby5nYW1lU3RhdGU7DQogICAgICAgIGlmIChnYW1lU3RhdGUgJiYgKGdhbWVTdGF0ZS5zdGF0dXMgPT09ICdjaGVja21hdGUnIHx8IGdhbWVTdGF0ZS5zdGF0dXMgPT09ICdzdGFsZW1hdGUnKSkgew0KICAgICAgICAgICAgY29uc3QgaXNJbml0aWF0b3JXaW5uZXIgPSBnYW1lU3RhdGUud2lubmVyID09PSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7DQogICAgICAgICAgICByZXR1cm4gYmFzZVNjb3JlICsgKGlzSW5pdGlhdG9yV2lubmVyID8gZCA6IChzZWFyY2hEZXB0aCAtIGQpKTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gdGVybWluYWxTY29yZSgpOw0KICAgIH0NCg0KICAgIGxldCBtb3ZlcyA9IHNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdDsNCiAgICBpZiAoIXBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSkgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdID0gMDsNCiAgICBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gKz0gbW92ZXMubGVuZ3RoOw0KDQogICAgY29uc3Qga2lsbGVyc0F0RGVwdGggPSBraWxsZXJNb3Zlc1tkXSB8fCBbbnVsbCwgbnVsbF07DQogICAgbW92ZXMgPSBzb3J0TW92ZXNQbGF5KA0KICAgICAgICBtb3ZlcywgYiwgY3VycmVudFBsYXllciwgYWJQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGFiQm9hcmRJbmZvLA0KICAgICAgICB0dE1vdmUsIGtpbGxlcnNBdERlcHRoLCBpbkNoZWNrDQogICAgKTsNCg0KICAgIGxldCBiZXN0RXZhbCA9IG1heGltaXppbmcgPyAtSW5maW5pdHkgOiBJbmZpbml0eTsNCiAgICBsZXQgYmVzdE1vdmUgPSBudWxsOw0KICAgIGxldCBsZWdhbE1vdmVzRm91bmQgPSAwOw0KDQogICAgZm9yIChsZXQgbW92ZUluZGV4ID0gMDsgbW92ZUluZGV4IDwgbW92ZXMubGVuZ3RoOyBtb3ZlSW5kZXgrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbbW92ZUluZGV4XTsNCiAgICAgICAgY29uc3QgaXNDYXB0dXJlID0gISFiW21vdmVUb1IobW92ZSldW21vdmVUb0MobW92ZSldOw0KICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldOw0KICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUpOw0KICAgICAgICBpZiAobGVhdmVzT3duS2luZ1Vuc2FmZShiLCBjdXJyZW50UGxheWVyKSkgew0KICAgICAgICAgICAgdW5tYWtlU2VhcmNoTW92ZShiLCBtb3ZlLCBjYXB0dXJlZCk7DQogICAgICAgICAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCsrOw0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsKICAgICAgICBsZWdhbE1vdmVzRm91bmQrKzsKICAgICAgICBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkKys7CiAgICAgICAgY29uc3QgbmV4dFBsYXllciA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgIGNvbnN0IHZhbHVlID0gYWxwaGFCZXRhUGxheSgKICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0UGxheWVyID09PSBzZWFyY2hJbml0aWF0b3IsIG5leHRQbGF5ZXIsCiAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgbmV4dEhhc2gKICAgICAgICApOwogICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOwoNCiAgICAgICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgICAgIGlmICh2YWx1ZSA+IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSB2YWx1ZTsNCiAgICAgICAgICAgICAgICBiZXN0TW92ZSA9IG1vdmU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBhbHBoYSA9IE1hdGgubWF4KGFscGhhLCB2YWx1ZSk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAodmFsdWUgPCBiZXN0RXZhbCkgew0KICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gdmFsdWU7DQogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYmV0YSA9IE1hdGgubWluKGJldGEsIHZhbHVlKTsNCiAgICAgICAgfQ0KDQogICAgICAgIGlmIChiZXRhIDw9IGFscGhhKSB7DQogICAgICAgICAgICBpZiAoIXBlcmZTdGF0cy5jdXRvZmZzW2RdKSBwZXJmU3RhdHMuY3V0b2Zmc1tkXSA9IDA7DQogICAgICAgICAgICBwZXJmU3RhdHMuY3V0b2Zmc1tkXSsrOw0KICAgICAgICAgICAgaWYgKCFpc0NhcHR1cmUpIHsNCiAgICAgICAgICAgICAgICBzdG9yZUtpbGxlck1vdmUoZCwgbW92ZSk7DQogICAgICAgICAgICAgICAgYWRkSGlzdG9yeVNjb3JlKG1vdmUsIGQpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBpZiAobGVnYWxNb3Zlc0ZvdW5kID09PSAwKSByZXR1cm4gdGVybWluYWxTY29yZSgpOw0KDQogICAgbGV0IGZsYWc7DQogICAgaWYgKGJlc3RFdmFsIDw9IG9yaWdpbmFsQWxwaGEpIGZsYWcgPSAndXBwZXJib3VuZCc7DQogICAgZWxzZSBpZiAoYmVzdEV2YWwgPj0gb3JpZ2luYWxCZXRhKSBmbGFnID0gJ2xvd2VyYm91bmQnOw0KICAgIGVsc2UgZmxhZyA9ICdleGFjdCc7DQogICAgdHJhbnNwb3NpdGlvblRhYmxlLnN0b3JlKHR0S2V5LCBkLCBiZXN0RXZhbCwgZmxhZywgYmVzdE1vdmUsIG51bGwpOw0KICAgIHJldHVybiBiZXN0RXZhbDsNCn07DQoNCmNvbnN0IHF1aWVzY2VuY2UgPSAoDQogICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGgsIGJvYXJkSGFzaCA9IDANCikgPT4gew0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnF1aWVzY2VuY2VDYWxscysrOw0KICAgIGNvbnN0IHN0YW5kUGF0ID0gc3RhdGljU2VhcmNoRXZhbChiLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRIYXNoKTsNCg0KICAgIGlmIChxc0RlcHRoIDw9IDApIHsNCiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KDQogICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0ID49IGJldGEpIHsNCiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICB9DQogICAgICAgIGlmIChzdGFuZFBhdCA+IGFscGhhKSB7DQogICAgICAgICAgICBhbHBoYSA9IHN0YW5kUGF0Ow0KICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0IDw9IGFscGhhKSB7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoc3RhbmRQYXQgPCBiZXRhKSB7DQogICAgICAgICAgICBiZXRhID0gc3RhbmRQYXQ7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBsZXQgY2FwdHVyZXMgPSBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoKGIsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnF1aWVzY2VuY2VDYXB0dXJlTW92ZXMgKz0gY2FwdHVyZXMubGVuZ3RoOw0KICAgIGlmIChjYXB0dXJlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KDQogICAgLy8gTVZWLUxWQe+8muWFiOivleWQg+Wkp+WtkA0KICAgIGNhcHR1cmVzLnNvcnQoKGEsIGJNb3ZlKSA9PiB7DQogICAgICAgIGNvbnN0IHNjb3JlQSA9DQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbbW92ZVRvUihhKV1bbW92ZVRvQyhhKV0sIGdhbWVTdGFnZSkgKiAxNiAtDQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbbW92ZUZyb21SKGEpXVttb3ZlRnJvbUMoYSldLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCBzY29yZUIgPQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW21vdmVUb1IoYk1vdmUpXVttb3ZlVG9DKGJNb3ZlKV0sIGdhbWVTdGFnZSkgKiAxNiAtDQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbbW92ZUZyb21SKGJNb3ZlKV1bbW92ZUZyb21DKGJNb3ZlKV0sIGdhbWVTdGFnZSk7DQogICAgICAgIHJldHVybiBzY29yZUIgLSBzY29yZUE7DQogICAgfSk7DQoNCiAgICBsZXQgYmVzdEV2YWwgPSBzdGFuZFBhdDsNCiAgICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOw0KDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjYXB0dXJlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gY2FwdHVyZXNbaV07DQogICAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYlttb3ZlRnJvbVIobW92ZSldW21vdmVGcm9tQyhtb3ZlKV07DQogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZVNlYXJjaE1vdmUoYiwgbW92ZSk7DQogICAgICAgIGlmIChsZWF2ZXNPd25LaW5nVW5zYWZlKGIsIGN1cnJlbnRQbGF5ZXIpKSB7DQogICAgICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkKys7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgICAgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCsrOw0KICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCByZXN1bHQgPSBxdWllc2NlbmNlKA0KICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLA0KICAgICAgICAgICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGggLSAxLCBuZXh0SGFzaA0KICAgICAgICApOw0KICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCg0KICAgICAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsNCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlVG9PYmplY3QobW92ZSksIC4uLihyZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGFscGhhKSB7DQogICAgICAgICAgICAgICAgYWxwaGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4uKHJlc3VsdC5tb3ZlU2VxdWVuY2UgfHwgW10pXTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmV0YSkgew0KICAgICAgICAgICAgICAgIGJldGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPyBiZXN0TW92ZVNlcXVlbmNlIDogW10gfTsNCn07DQoNCi8vIGFscGhhQmV0Ye+8muivhOS8sOWni+e7iOS7jiBzZWFyY2hJbml0aWF0b3Ig6KeS5bqm77ybVFQgKyBraWxsZXIvaGlzdG9yeSArIOepuuedgOWJquaenSArIExNUiArIFFTDQovLyBib2FyZEhhc2jvvJrlop7ph48gWm9icmlzdCDlsYDpnaLlk4jluIzvvIjkuI3lkKvooYzmo4vmlrnvvInvvJvml6fmqKHlvI/kuIvlj6/kvKAgMA0KY29uc3QgYWxwaGFCZXRhID0gKA0KICAgIGIsIGQsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLA0KICAgIHNlYXJjaERlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gY3VycmVudFBsYXllciwgZ2FtZVN0YWdlID0gJ21pZCcsDQogICAgYWxsb3dOdWxsID0gdHJ1ZSwgYm9hcmRIYXNoID0gMA0KKSA9PiB7DQogICAgY29uc3Qgb3JpZ2luYWxBbHBoYSA9IGFscGhhOw0KICAgIGNvbnN0IG9yaWdpbmFsQmV0YSA9IGJldGE7DQoNCiAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMrKzsNCiAgICBpZiAoIXBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKSBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSA9IDA7DQogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0rKzsNCg0KICAgIC8vIOWPtuiKgueCue+8muWujOaVtOW9ouWKv+ivhOS8sCArIOWQg+WtkOmdmem7mOaQnOe0ogogICAgaWYgKGQgPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHF1aWVzY2VuY2UoDQogICAgICAgICAgICBiLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwNCiAgICAgICAgICAgIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBTRUFSQ0hfUVVJRVNDRU5DRV9ERVBUSCwgYm9hcmRIYXNoCiAgICAgICAgKTsNCiAgICB9DQoNCiAgICAvLyDnva7mjaLooajmjqLmtYvvvIhrZXkg5ZCr6KGM5qOL5pa577yM6YG/5YWN5ZCM5b2i5LiN5ZCM6LWw5pa55Yay56qB77yJDQogICAgY29uc3QgdHRLZXkgPSBtYWtlU2VhcmNoVFRLZXkoYiwgY3VycmVudFBsYXllciwgYm9hcmRIYXNoKTsNCiAgICBjb25zdCB0dEVudHJ5ID0gdHJhbnNwb3NpdGlvblRhYmxlLnJldHJpZXZlKHR0S2V5KTsNCiAgICBsZXQgdHRNb3ZlID0gbnVsbDsNCiAgICBpZiAodHRFbnRyeSkgew0KICAgICAgICB0dE1vdmUgPSB0dEVudHJ5LmJlc3RNb3ZlIHx8IG51bGw7DQogICAgICAgIGlmICh0dEVudHJ5LmRlcHRoID49IGQpIHsNCiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICdleGFjdCcpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgICAgICAgICB2YWx1ZTogdHRFbnRyeS52YWx1ZSwNCiAgICAgICAgICAgICAgICAgICAgbW92ZVNlcXVlbmNlOiBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFDQogICAgICAgICAgICAgICAgICAgICAgICA/ICh0dEVudHJ5Lm1vdmVTZXF1ZW5jZSB8fCAodHRNb3ZlID8gW21vdmVUb09iamVjdCh0dE1vdmUpXSA6IFtdKSkNCiAgICAgICAgICAgICAgICAgICAgICAgIDogW10NCiAgICAgICAgICAgICAgICB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ2xvd2VyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPj0gYmV0YSkgew0KICAgICAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiB0dEVudHJ5LnZhbHVlLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAndXBwZXJib3VuZCcgJiYgdHRFbnRyeS52YWx1ZSA8PSBhbHBoYSkgew0KICAgICAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiB0dEVudHJ5LnZhbHVlLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBjb25zdCBzZWFyY2hJbmZvID0gcHJlcGFyZVNlYXJjaEluZm8oYiwgY3VycmVudFBsYXllcik7DQogICAgY29uc3QgYWJQaWVjZXNJbmZvID0gc2VhcmNoSW5mby5waWVjZXNJbmZvOw0KICAgIGNvbnN0IGFiQm9hcmRJbmZvID0gc2VhcmNoSW5mby5ib2FyZEluZm87DQogICAgY29uc3QgY3VycmVudFBsYXllckNvbG9yID0gY3VycmVudFBsYXllcjsNCiAgICBjb25zdCBpbkNoZWNrID0gc2VhcmNoSW5mby5pbkNoZWNrIHx8DQogICAgICAgICAgICAgICAgICAgIChjdXJyZW50UGxheWVyQ29sb3IgPT09ICdyZWQnICYmIGFiQm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwNCiAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ2JsYWNrJyAmJiBhYkJvYXJkSW5mby5ibGFja0lzSW5DaGVjayk7DQoNCiAgICBjb25zdCB0ZXJtaW5hbFNjb3JlID0gKG1hdGVJbkNoZWNrKSA9PiB7DQogICAgICAgIGNvbnN0IGlzSW5pdGlhdG9yV2lubmVyID0gY3VycmVudFBsYXllckNvbG9yICE9PSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgIGNvbnN0IGJhc2VTY29yZSA9IGlzSW5pdGlhdG9yV2lubmVyID8gMTAwMDAwIDogLTEwMDAwMDsNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIHZhbHVlOiBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogKHNlYXJjaERlcHRoIC0gZCkpLA0KICAgICAgICAgICAgbW92ZVNlcXVlbmNlOiBbXSwNCiAgICAgICAgICAgIHRlcm1pbmFsOiBtYXRlSW5DaGVjayA/ICdjaGVja21hdGUnIDogJ3N0YWxlbWF0ZScNCiAgICAgICAgfTsNCiAgICB9Ow0KDQogICAgLy8g5peg5Lyq5ZCI5rOV552A77ya55u05o6l57uI5bGA77yI5p6B5bCR6KeB77yb6YCa5bi46Iez5bCR5pyJ5bCG55qE6LWw5Yqo77yJDQogICAgaWYgKCFzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3QgfHwgc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0Lmxlbmd0aCA9PT0gMCkgew0KICAgICAgICBjb25zdCBnYW1lU3RhdGUgPSBhYkJvYXJkSW5mby5nYW1lU3RhdGU7DQogICAgICAgIGlmIChnYW1lU3RhdGUgJiYgKGdhbWVTdGF0ZS5zdGF0dXMgPT09ICdjaGVja21hdGUnIHx8IGdhbWVTdGF0ZS5zdGF0dXMgPT09ICdzdGFsZW1hdGUnKSkgew0KICAgICAgICAgICAgY29uc3QgaXNJbml0aWF0b3JXaW5uZXIgPSBnYW1lU3RhdGUud2lubmVyID09PSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7DQogICAgICAgICAgICBjb25zdCBzdGVwc0Zyb21Sb290ID0gc2VhcmNoRGVwdGggLSBkOw0KICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IGJhc2VTY29yZSArIChpc0luaXRpYXRvcldpbm5lciA/IGQgOiBzdGVwc0Zyb21Sb290KSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICB9DQogICAgICAgIHJldHVybiB0ZXJtaW5hbFNjb3JlKGluQ2hlY2spOw0KICAgIH0NCg0KICAgIC8vIOepuuedgOWJquaene+8muS7hSBtYXhpbWl6aW5n77yb5a6M5pW06K+E5Lyw5LiL5L+d5a6I5ZCv55SoDQogICAgaWYgKA0KICAgICAgICBmYWxzZSAmJg0KICAgICAgICBhbGxvd051bGwgJiYNCiAgICAgICAgbWF4aW1pemluZyAmJg0KICAgICAgICBkID49IDMgJiYNCiAgICAgICAgIWluQ2hlY2sgJiYNCiAgICAgICAgY2FuRG9OdWxsTW92ZShiLCBjdXJyZW50UGxheWVyQ29sb3IpDQogICAgKSB7DQogICAgICAgIGNvbnN0IG51bGxSID0gZCA+PSA2ID8gMyA6IDI7DQogICAgICAgIGNvbnN0IG51bGxEZXB0aCA9IGQgLSAxIC0gbnVsbFI7DQogICAgICAgIGlmIChudWxsRGVwdGggPj0gMCkgew0KICAgICAgICAgICAgY29uc3QgbnVsbFBsYXllciA9IGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgICAgICBjb25zdCBudWxsTWF4aW1pemluZyA9IG51bGxQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgICAgIC8vIOepuuedgOS4jeaUueWPmOWxgOmdouWTiOW4jO+8jOS7heihjOaji+aWueWPmOWMlu+8iFRUIGtleSDlkKsgc2lkZe+8iQ0KICAgICAgICAgICAgY29uc3QgbnVsbFJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgICBiLCBudWxsRGVwdGgsIGJldGEgLSAxZS02LCBiZXRhLCBudWxsTWF4aW1pemluZywgbnVsbFBsYXllciwNCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGZhbHNlLCBib2FyZEhhc2gNCiAgICAgICAgICAgICk7DQogICAgICAgICAgICBpZiAobnVsbFJlc3VsdC52YWx1ZSA+PSBiZXRhKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IG51bGxSZXN1bHQudmFsdWUsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGxldCBtb3ZlcyA9IHNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdDsNCg0KICAgIGlmICghcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdKSBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gPSAwOw0KICAgIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSArPSBtb3Zlcy5sZW5ndGg7DQoNCiAgICBjb25zdCBraWxsZXJzQXREZXB0aCA9IChraWxsZXJNb3Zlc1tkXSB8fCBbbnVsbCwgbnVsbF0pOw0KICAgIG1vdmVzID0gc29ydE1vdmVzRmFzdChtb3ZlcywgYiwgY3VycmVudFBsYXllckNvbG9yLCBhYlBpZWNlc0luZm8sIGdhbWVTdGFnZSwgYWJCb2FyZEluZm8sIHsNCiAgICAgICAgdHRNb3ZlLA0KICAgICAgICBraWxsZXJzOiBraWxsZXJzQXREZXB0aA0KICAgIH0pOw0KDQogICAgY29uc3Qgc3RvcmVUVCA9ICh2YWx1ZSwgYmVzdE1vdmUsIG1vdmVTZXF1ZW5jZSkgPT4gew0KICAgICAgICBsZXQgZmxhZzsNCiAgICAgICAgaWYgKHZhbHVlIDw9IG9yaWdpbmFsQWxwaGEpIGZsYWcgPSAndXBwZXJib3VuZCc7DQogICAgICAgIGVsc2UgaWYgKHZhbHVlID49IG9yaWdpbmFsQmV0YSkgZmxhZyA9ICdsb3dlcmJvdW5kJzsNCiAgICAgICAgZWxzZSBmbGFnID0gJ2V4YWN0JzsNCiAgICAgICAgdHJhbnNwb3NpdGlvblRhYmxlLnN0b3JlKHR0S2V5LCBkLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUsIFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPyBtb3ZlU2VxdWVuY2UgOiBudWxsKTsNCiAgICB9Ow0KDQogICAgbGV0IGJlc3RFdmFsID0gbWF4aW1pemluZyA/IC1JbmZpbml0eSA6IEluZmluaXR5Ow0KICAgIGxldCBiZXN0TW92ZSA9IG51bGw7DQogICAgbGV0IGJlc3RNb3ZlU2VxdWVuY2UgPSBbXTsNCiAgICBsZXQgbGVnYWxNb3Zlc0ZvdW5kID0gMDsNCg0KICAgIGZvciAobGV0IG1vdmVJbmRleCA9IDA7IG1vdmVJbmRleCA8IG1vdmVzLmxlbmd0aDsgbW92ZUluZGV4KyspIHsNCiAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW21vdmVJbmRleF07DQogICAgICAgIGNvbnN0IGlzQ2FwdHVyZSA9ICEhYlttb3ZlVG9SKG1vdmUpXVttb3ZlVG9DKG1vdmUpXTsNCiAgICAgICAgY29uc3QgaXNUVE1vdmUgPSB0dE1vdmUgJiYgaXNTYW1lTW92ZShtb3ZlLCB0dE1vdmUpOw0KICAgICAgICBjb25zdCBpc0tpbGxlciA9DQogICAgICAgICAgICBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNBdERlcHRoWzBdKSB8fA0KICAgICAgICAgICAgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzQXREZXB0aFsxXSk7DQoNCiAgICAgICAgLy8gTE1S77ya6Z2g5ZCO55qE5a6J6Z2Z552A5rOV6ZmN5rexIDHvvIjlrozmlbTor4TkvLDkuIvkv53lrojvvIkNCiAgICAgICAgLy8gbW92ZUluZGV4IOWQq+S8quWQiOazleW6j++8m+mdnuazleedgOi3s+i/h+WQjueVpeWBj+S/neWuiO+8iOWwkemZjea3se+8ie+8jOS4jeW9seWTjeato+ehruaApw0KICAgICAgICBsZXQgcmVkdWN0aW9uID0gMDsNCiAgICAgICAgaWYgKA0KICAgICAgICAgICAgZmFsc2UgJiYNCiAgICAgICAgICAgIGQgPj0gNCAmJg0KICAgICAgICAgICAgbW92ZUluZGV4ID49IDQgJiYNCiAgICAgICAgICAgICFpbkNoZWNrICYmDQogICAgICAgICAgICAhaXNDYXB0dXJlICYmDQogICAgICAgICAgICAhaXNUVE1vdmUgJiYNCiAgICAgICAgICAgICFpc0tpbGxlcg0KICAgICAgICApIHsNCiAgICAgICAgICAgIHJlZHVjdGlvbiA9IDE7DQogICAgICAgIH0NCg0KICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldOw0KICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUpOw0KICAgICAgICBpZiAobGVhdmVzT3duS2luZ1Vuc2FmZShiLCBjdXJyZW50UGxheWVyQ29sb3IpKSB7DQogICAgICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkKys7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgICAgbGVnYWxNb3Zlc0ZvdW5kKys7DQogICAgICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQrKzsNCg0KICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KDQogICAgICAgIGxldCByZXN1bHQ7DQogICAgICAgIGlmIChyZWR1Y3Rpb24gPiAwKSB7DQogICAgICAgICAgICBjb25zdCByZWR1Y2VkRGVwdGggPSBNYXRoLm1heCgwLCBkIC0gMSAtIHJlZHVjdGlvbik7DQogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgcmVkdWNlZERlcHRoLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIGNvbnN0IG5lZWRSZXNlYXJjaCA9IG1heGltaXppbmcNCiAgICAgICAgICAgICAgICA/IHJlc3VsdC52YWx1ZSA+IGFscGhhDQogICAgICAgICAgICAgICAgOiByZXN1bHQudmFsdWUgPCBiZXRhOw0KICAgICAgICAgICAgaWYgKG5lZWRSZXNlYXJjaCkgew0KICAgICAgICAgICAgICAgIHJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHRydWUsIG5leHRIYXNoDQogICAgICAgICAgICApOw0KICAgICAgICB9DQoNCiAgICAgICAgdW5tYWtlU2VhcmNoTW92ZShiLCBtb3ZlLCBjYXB0dXJlZCk7DQoNCiAgICAgICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPiBiZXN0RXZhbCkgew0KICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgICAgICAgIGJlc3RNb3ZlID0gbW92ZTsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYWxwaGEgPSBNYXRoLm1heChhbHBoYSwgcmVzdWx0LnZhbHVlKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPCBiZXN0RXZhbCkgew0KICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgICAgICAgIGJlc3RNb3ZlID0gbW92ZTsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYmV0YSA9IE1hdGgubWluKGJldGEsIHJlc3VsdC52YWx1ZSk7DQogICAgICAgIH0NCg0KICAgICAgICBpZiAoYmV0YSA8PSBhbHBoYSkgew0KICAgICAgICAgICAgaWYgKCFwZXJmU3RhdHMuY3V0b2Zmc1tkXSkgcGVyZlN0YXRzLmN1dG9mZnNbZF0gPSAwOw0KICAgICAgICAgICAgcGVyZlN0YXRzLmN1dG9mZnNbZF0rKzsNCiAgICAgICAgICAgIGlmICghaXNDYXB0dXJlKSB7DQogICAgICAgICAgICAgICAgc3RvcmVLaWxsZXJNb3ZlKGQsIG1vdmUpOw0KICAgICAgICAgICAgICAgIGFkZEhpc3RvcnlTY29yZShtb3ZlLCBkKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5bu26L+f5ZCI5rOV5oCn77ya5Lyq5ZCI5rOV6Z2e56m65L2G5peg5LiA5ZCI5rOVIOKGkiDlsIbmrbsv5Zuw5q+ZDQogICAgaWYgKGxlZ2FsTW92ZXNGb3VuZCA9PT0gMCkgew0KICAgICAgICByZXR1cm4gdGVybWluYWxTY29yZShpbkNoZWNrKTsNCiAgICB9DQoNCiAgICBzdG9yZVRUKGJlc3RFdmFsLCBiZXN0TW92ZSwgYmVzdE1vdmVTZXF1ZW5jZSk7DQogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPyBiZXN0TW92ZVNlcXVlbmNlIDogW10gfTsNCn07DQoNCi8vIGV4YWN0Um9vdFNjb3JlczogdHJ1ZT1BbmFseXNpcyDlhajmoLnnsr7noa7liIbvvJtmYWxzZT3lr7nlvIjmoIflh4YgUFZT77yIZmFpbC1sb3cg5LiN5Zue5pCc77yJDQpjb25zdCBnZXRCZXN0TW92ZUludGVybmFsID0gKGJvYXJkLCB0dXJuLCBkZXB0aCA9IDgsIHBseSA9IDAsIGVuYWJsZVRpbWVMaW1pdCA9IGZhbHNlLCBleGFjdFJvb3RTY29yZXMgPSBmYWxzZSwgY29sbGVjdE1vdmVTZXF1ZW5jZU92ZXJyaWRlID0gbnVsbCkgPT4gew0KICBjb25zdCB0aW1lTGltaXQgPSA1MDAwOw0KDQogIC8vIEZpcnN0IHRyeSB0byBnZXQgbW92ZSBmcm9tIG9wZW5pbmcgYm9vaw0KICBjb25zdCBib29rTW92ZSA9IG9wZW5pbmdCb29rLmdldEJvb2tNb3ZlKGJvYXJkLCBwbHkpOw0KICANCiAgaWYgKGJvb2tNb3ZlKSB7DQogICAgLy8gQ2hlY2sgaWYgYm9va01vdmUgaXMgdmFsaWQgZm9yIGN1cnJlbnQgYm9hcmQNCiAgICBpZiAoYm9va01vdmUuZnJvbSAmJiBib29rTW92ZS50byAmJiANCiAgICAgICAgdHlwZW9mIGJvb2tNb3ZlLmZyb20uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJvb2tNb3ZlLmZyb20uYyA9PT0gJ251bWJlcicgJiYNCiAgICAgICAgdHlwZW9mIGJvb2tNb3ZlLnRvLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBib29rTW92ZS50by5jID09PSAnbnVtYmVyJykgew0KICAgICAgDQogICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJvYXJkW2Jvb2tNb3ZlLmZyb20ucl1bYm9va01vdmUuZnJvbS5jXTsNCiAgICAgIA0KICAgICAgaWYgKG1vdmluZ1BpZWNlICYmIG1vdmluZ1BpZWNlLmNvbG9yID09PSB0dXJuKSB7DQogICAgICAgIC8vIFZlcmlmeSBtb3ZlIGlzIHZhbGlkDQogICAgICAgIGNvbnN0IHZhbGlkRGVzdGluYXRpb25zID0gZ2V0VmFsaWRNb3Zlcyhib2FyZCwgYm9va01vdmUuZnJvbSk7DQogICAgICAgIGNvbnN0IGlzVmFsaWQgPSB2YWxpZERlc3RpbmF0aW9ucy5zb21lKGRlc3QgPT4gZGVzdC5yID09PSBib29rTW92ZS50by5yICYmIGRlc3QuYyA9PT0gYm9va01vdmUudG8uYyk7DQogICAgICAgIA0KICAgICAgICBpZiAoaXNWYWxpZCkgew0KICAgICAgICAgIHJldHVybiB7IGJlc3RNb3ZlOiBib29rTW92ZSwgc2Vjb25kQmVzdE1vdmU6IG51bGwsIG1vdmVTZXF1ZW5jZTogW10sIHNlY29uZE1vdmVTZXF1ZW5jZTogW10sIGJlc3RNb3ZlU2NvcmU6IDAsIHNlY29uZEJlc3RNb3ZlU2NvcmU6IDAsIGFsbE1vdmVzV2l0aFNjb3JlczogW10gfTsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgIH0NCiAgfQ0KDQogIC8vIOagueiKgueCue+8mui/reS7o+WKoOa3sSArIFBWU++8m1RUL2tpbGxlci9oaXN0b3J5IOi3qOa3seW6puS/neeVme+8iOS7heW8gOWxgOa4heepuuS4gOasoe+8iQ0KICByZXNldFBlcmZTdGF0cygpOw0KICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpOw0KICB0cmFuc3Bvc2l0aW9uVGFibGUucmVzZXRTdGF0cygpOw0KICB0cmFuc3Bvc2l0aW9uVGFibGUuY2xlYXIoKTsNCiAgY2xlYXJFdmFsQ2FjaGUoKTsNCiAgY29uc3QgbWF4RGVwdGggPSBNYXRoLm1heCgxLCBkZXB0aCB8IDApOw0KICByZXNldFNlYXJjaEhldXJpc3RpY3MobWF4RGVwdGgpOw0KICBzeW5jR2VuZXJhbFBvc0NhY2hlKGJvYXJkKTsNCiAgU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA9IHR5cGVvZiBjb2xsZWN0TW92ZVNlcXVlbmNlT3ZlcnJpZGUgPT09ICdib29sZWFuJw0KICAgID8gY29sbGVjdE1vdmVTZXF1ZW5jZU92ZXJyaWRlDQogICAgOiAhIWV4YWN0Um9vdFNjb3JlczsNCg0KICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZSgpOw0KICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCg0KICBjb25zdCByb290RXZhbFJlc3VsdCA9IGV2YWx1YXRlQm9hcmQoYm9hcmQsIHR1cm4sIGdhbWVTdGFnZSk7DQogIGNvbnN0IHJvb3RQaWVjZXNJbmZvID0gcm9vdEV2YWxSZXN1bHQucGllY2VzSW5mbzsNCiAgY29uc3Qgcm9vdEJvYXJkSW5mbyA9IHJvb3RFdmFsUmVzdWx0LmJvYXJkSW5mbzsNCg0KICAvLyDmlLbpm4bmoLnoioLngrnotbDms5XvvIjlj6rlgZrkuIDmrKHvvInvvJvmnKrooqvlsIbml7bov4fmu6TpgIHlkIMNCiAgbGV0IHJvb3RNb3ZlcyA9IFtdOw0KICBjb25zdCByb290SW5DaGVjayA9ICh0dXJuID09PSAncmVkJyAmJiByb290Qm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwNCiAgICAgICAgICAgICAgICAgICAgICAodHVybiA9PT0gJ2JsYWNrJyAmJiByb290Qm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKTsNCg0KICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICBpZiAoYm9hcmRbcl1bY10/LmNvbG9yID09PSB0dXJuKSB7DQogICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgIGNvbnN0IHZhbGlkRGVzdGluYXRpb25zID0gZ2V0VmFsaWRNb3Zlcyhib2FyZCwgeyByLCBjIH0pOw0KICAgICAgICB2YWxpZERlc3RpbmF0aW9ucy5mb3JFYWNoKHRvID0+IHsNCiAgICAgICAgICBjb25zdCBpc0FjY2VwdGFibGUgPSByb290SW5DaGVjayB8fCBpc1Bvc2l0aW9uQWNjZXB0YWJsZShib2FyZCwgeyByLCBjIH0sIHRvLCB0dXJuLCByb290Qm9hcmRJbmZvLCByb290UGllY2VzSW5mbywgcGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgICAgaWYgKGlzQWNjZXB0YWJsZSkgew0KICAgICAgICAgICAgcm9vdE1vdmVzLnB1c2goeyBmcm9tOiB7IHIsIGMgfSwgdG8sIHNjb3JlOiAwLCBtb3ZlU2VxdWVuY2U6IFtdIH0pOw0KICAgICAgICAgIH0NCiAgICAgICAgfSk7DQogICAgICB9DQogICAgfQ0KICB9DQoNCiAgaWYgKHJvb3RNb3Zlcy5sZW5ndGggPT09IDApIHsNCiAgICByZXR1cm4gew0KICAgICAgYmVzdE1vdmU6IG51bGwsDQogICAgICBzZWNvbmRCZXN0TW92ZTogbnVsbCwNCiAgICAgIG1vdmVTZXF1ZW5jZTogW10sDQogICAgICBzZWNvbmRNb3ZlU2VxdWVuY2U6IFtdLA0KICAgICAgYmVzdE1vdmVTY29yZTogMCwNCiAgICAgIHNlY29uZEJlc3RNb3ZlU2NvcmU6IDAsDQogICAgICBhbGxNb3Zlc1dpdGhTY29yZXM6IFtdDQogICAgfTsNCiAgfQ0KDQogIGNvbnN0IHNvcnRSb290TW92ZXNCeVNjb3JlID0gKG1vdmVzKSA9PiB7DQogICAgbW92ZXMuc29ydCgoYSwgYikgPT4gew0KICAgICAgY29uc3Qgc2NvcmVEaWZmID0gYi5zY29yZSAtIGEuc2NvcmU7DQogICAgICBpZiAoTWF0aC5hYnMoc2NvcmVEaWZmKSA8IDFlLTYpIHsNCiAgICAgICAgaWYgKGEuc2NvcmUgPiAwKSB7DQogICAgICAgICAgcmV0dXJuIChhLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApIC0gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCk7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGEuc2NvcmUgPCAwKSB7DQogICAgICAgICAgcmV0dXJuIChiLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApIC0gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCk7DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIDA7DQogICAgICB9DQogICAgICByZXR1cm4gc2NvcmVEaWZmOw0KICAgIH0pOw0KICB9Ow0KDQogIGNvbnN0IHByb21vdGVSb290TW92ZSA9IChtb3ZlcywgcHJlZmVycmVkKSA9PiB7DQogICAgaWYgKCFwcmVmZXJyZWQpIHJldHVybjsNCiAgICBjb25zdCBpZHggPSBtb3Zlcy5maW5kSW5kZXgoKG0pID0+IGlzU2FtZU1vdmUobSwgcHJlZmVycmVkKSk7DQogICAgaWYgKGlkeCA+IDApIHsNCiAgICAgIGNvbnN0IFtoaXRdID0gbW92ZXMuc3BsaWNlKGlkeCwgMSk7DQogICAgICBtb3Zlcy51bnNoaWZ0KGhpdCk7DQogICAgfQ0KICB9Ow0KDQogIGNvbnN0IHdvcmtCb2FyZCA9IGJvYXJkLm1hcCgocm93KSA9PiBbLi4ucm93XSk7DQogIGFjdGl2ZVNlYXJjaFBpZWNlU3RhdGUgPSBjcmVhdGVTZWFyY2hQaWVjZVN0YXRlKHdvcmtCb2FyZCwgZ2FtZVN0YWdlKTsNCiAgY29uc3QgTlVMTF9XSU5ET1dfRVBTID0gMWUtNjsNCiAgY29uc3QgbmV4dFR1cm4gPSB0dXJuID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgLy8g5qC55bGA6Z2i5ZOI5biM5Y+q566X5LiA5qyh77yb5aKe6YeP5qih5byP5pW05qO15pCc57Si5qCR55Sx5q2k5rS+55SfDQogIGNvbnN0IHJvb3RIYXNoID0gem9icmlzdEhhc2hlci5oYXNoKGJvYXJkKTsNCiAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsNCiAgY29uc3Qgcm9vdFRUS2V5ID0gem9icmlzdEhhc2hlci50dEtleUZyb21IYXNoKHJvb3RIYXNoLCB0dXJuKTsNCg0KICBsZXQgY29tcGxldGVkRGVwdGggPSAwOw0KDQogIGZvciAobGV0IGN1cnJlbnREZXB0aCA9IDE7IGN1cnJlbnREZXB0aCA8PSBtYXhEZXB0aDsgY3VycmVudERlcHRoKyspIHsNCiAgICBpZiAoZW5hYmxlVGltZUxpbWl0ICYmIGNvbXBsZXRlZERlcHRoID4gMCAmJiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lID4gdGltZUxpbWl0KSB7DQogICAgICBjb25zb2xlLmxvZyhgSUQgc3RvcHBlZCBiZWZvcmUgZGVwdGggJHtjdXJyZW50RGVwdGh9IGR1ZSB0byB0aW1lIGxpbWl0IChsYXN0IGNvbXBsZXRlZD0ke2NvbXBsZXRlZERlcHRofSlgKTsNCiAgICAgIGJyZWFrOw0KICAgIH0NCg0KICAgIC8vIOa1heWxguacgOS9s+edgCArIFRUIOedgOaOkuWIsOacgOWJje+8jOS+m+acrOWxgiBQVlMg56ys5LiA552A5YWo56qX5L2/55SoDQogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZShyb290VFRLZXkpOw0KICAgIGNvbnN0IHR0TW92ZSA9IHR0RW50cnkgJiYgdHRFbnRyeS5iZXN0TW92ZSA/IHR0RW50cnkuYmVzdE1vdmUgOiBudWxsOw0KICAgIGNvbnN0IHByZXZCZXN0ID0gcm9vdE1vdmVzWzBdOw0KICAgIHNvcnRNb3Zlc0Zhc3Qocm9vdE1vdmVzLCBib2FyZCwgdHVybiwgcm9vdFBpZWNlc0luZm8sIGdhbWVTdGFnZSwgcm9vdEJvYXJkSW5mbywgew0KICAgICAgdHRNb3ZlLA0KICAgICAga2lsbGVyczoga2lsbGVyTW92ZXNbTWF0aC5tYXgoMCwgY3VycmVudERlcHRoIC0gMSldIHx8IFtudWxsLCBudWxsXQ0KICAgIH0pOw0KICAgIC8vIOS4iuS4gOWxguacgOS9s+edgOaUvuesrOS4gO+8iOacgOWQjiBwcm9tb3Rl77yJ77yM5L+d6K+B5pys5bGCIFBWUyDpppbnnYDlhajnqpflkb3kuK3ng63ot6/lvoQNCiAgICBwcm9tb3RlUm9vdE1vdmUocm9vdE1vdmVzLCB0dE1vdmUpOw0KICAgIHByb21vdGVSb290TW92ZShyb290TW92ZXMsIHByZXZCZXN0KTsNCg0KICAgIGNvbnN0IHVzZUV4YWN0Um9vdCA9IGV4YWN0Um9vdFNjb3JlcyAmJiBjdXJyZW50RGVwdGggPT09IG1heERlcHRoOw0KICAgIGNvbnN0IHVzZVBsYXlTZWFyY2ggPSAhZXhhY3RSb290U2NvcmVzOw0KICAgIGxldCByb290QWxwaGEgPSAtSW5maW5pdHk7DQoNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJvb3RNb3Zlcy5sZW5ndGg7IGkrKykgew0KICAgICAgY29uc3QgaXRlbSA9IHJvb3RNb3Zlc1tpXTsNCiAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gd29ya0JvYXJkW2l0ZW0uZnJvbS5yXVtpdGVtLmZyb20uY107DQogICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VNb3ZlKHdvcmtCb2FyZCwgaXRlbS5mcm9tLCBpdGVtLnRvKTsNCiAgICAgIGNvbnN0IGNoaWxkSGFzaCA9IGNoaWxkQm9hcmRIYXNoKHJvb3RIYXNoLCBpdGVtLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOw0KDQogICAgICBsZXQgYWxwaGFCZXRhUmVzdWx0Ow0KICAgICAgbGV0IHNjb3JlOw0KICAgICAgbGV0IHNjb3JlSXNFeGFjdCA9IHRydWU7DQogICAgICBpZiAoaSA9PT0gMCB8fCByb290QWxwaGEgPT09IC1JbmZpbml0eSkgew0KICAgICAgICBpZiAodXNlUGxheVNlYXJjaCkgew0KICAgICAgICAgIHNjb3JlID0gYWxwaGFCZXRhUGxheSgNCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwgLUluZmluaXR5LCBJbmZpbml0eSwNCiAgICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIGNoaWxkSGFzaA0KICAgICAgICAgICk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LA0KICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoDQogICAgICAgICAgKTsNCiAgICAgICAgICBzY29yZSA9IGFscGhhQmV0YVJlc3VsdC52YWx1ZTsNCiAgICAgICAgfQ0KICAgICAgfSBlbHNlIHsNCiAgICAgICAgbGV0IHByb2JlOw0KICAgICAgICBpZiAodXNlUGxheVNlYXJjaCkgew0KICAgICAgICAgIHByb2JlID0gYWxwaGFCZXRhUGxheSgNCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwNCiAgICAgICAgICAgIHJvb3RBbHBoYSwgcm9vdEFscGhhICsgTlVMTF9XSU5ET1dfRVBTLA0KICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgY2hpbGRIYXNoDQogICAgICAgICAgKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsDQogICAgICAgICAgICByb290QWxwaGEsIHJvb3RBbHBoYSArIE5VTExfV0lORE9XX0VQUywNCiAgICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICAgICk7DQogICAgICAgICAgcHJvYmUgPSBhbHBoYUJldGFSZXN1bHQudmFsdWU7DQogICAgICAgIH0NCiAgICAgICAgaWYgKHByb2JlID4gcm9vdEFscGhhKSB7DQogICAgICAgICAgaWYgKHVzZVBsYXlTZWFyY2gpIHsNCiAgICAgICAgICAgIHNjb3JlID0gYWxwaGFCZXRhUGxheSgNCiAgICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCByb290QWxwaGEsIEluZmluaXR5LA0KICAgICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCBjaGlsZEhhc2gNCiAgICAgICAgICAgICk7DQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCByb290QWxwaGEsIEluZmluaXR5LA0KICAgICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCB0cnVlLCBjaGlsZEhhc2gNCiAgICAgICAgICAgICk7DQogICAgICAgICAgICBzY29yZSA9IGFscGhhQmV0YVJlc3VsdC52YWx1ZTsNCiAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAodXNlRXhhY3RSb290KSB7DQogICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LA0KICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoDQogICAgICAgICAgKTsNCiAgICAgICAgICBzY29yZSA9IGFscGhhQmV0YVJlc3VsdC52YWx1ZTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAvLyBmYWlsLWxvd++8muaOoua1i+WIhuWPquaYr+S4iueVjO+8jOS4jeiDveW9k+eyvuehruWIhuWGmeWFpe+8iOWQpuWImSBJRCDkuIvlsYLmjpLluo/ooqvmsaHmn5PvvIzmmJPlj43lpI3otbDngq7vvIkNCiAgICAgICAgICBzY29yZSA9IHByb2JlOw0KICAgICAgICAgIHNjb3JlSXNFeGFjdCA9IGZhbHNlOw0KICAgICAgICB9DQogICAgICB9DQoNCiAgICAgIHVubWFrZU1vdmUod29ya0JvYXJkLCBpdGVtLmZyb20sIGl0ZW0udG8sIGNhcHR1cmVkKTsNCg0KICAgICAgaWYgKHNjb3JlSXNFeGFjdCkgew0KICAgICAgICBpdGVtLnNjb3JlID0gc2NvcmU7DQogICAgICAgIGl0ZW0ubW92ZVNlcXVlbmNlID0gU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRQ0KICAgICAgICAgID8gW3sgZnJvbTogaXRlbS5mcm9tLCB0bzogaXRlbS50byB9LCAuLi4oYWxwaGFCZXRhUmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldDQogICAgICAgICAgOiBbXTsNCiAgICAgICAgaWYgKGl0ZW0uc2NvcmUgPiByb290QWxwaGEpIHsNCiAgICAgICAgICByb290QWxwaGEgPSBpdGVtLnNjb3JlOw0KICAgICAgICB9DQogICAgICB9IGVsc2UgaWYgKGl0ZW0uc2NvcmUgPiByb290QWxwaGEpIHsNCiAgICAgICAgLy8g5L+d55WZ5LiK5LiA5bGC5YiG5pWw77yb6Iul5LuN6auY5LqO5b2T5YmNIM6x77yI5byC5bi477yJ77yM55Wl6ZmN5Lul5YWN5oyk5o6J55yf5pyA5LyYDQogICAgICAgIGl0ZW0uc2NvcmUgPSByb290QWxwaGEgLSAxZS0zOw0KICAgICAgfQ0KICAgIH0NCg0KICAgIHNvcnRSb290TW92ZXNCeVNjb3JlKHJvb3RNb3Zlcyk7DQogICAgY29tcGxldGVkRGVwdGggPSBjdXJyZW50RGVwdGg7DQoNCiAgICAvLyDmiormnKzlsYLmnIDkvbPnnYDlhpnlhaUgVFTvvIzkvpvmm7Tmt7HkuIDlsYLmoLnmjpLluo8NCiAgICB0cmFuc3Bvc2l0aW9uVGFibGUuc3RvcmUoDQogICAgICByb290VFRLZXksDQogICAgICBjdXJyZW50RGVwdGgsDQogICAgICByb290TW92ZXNbMF0uc2NvcmUsDQogICAgICAnZXhhY3QnLA0KICAgICAgcm9vdE1vdmVzWzBdLA0KICAgICAgU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA/IChyb290TW92ZXNbMF0ubW92ZVNlcXVlbmNlIHx8IFtdKSA6IG51bGwNCiAgICApOw0KDQogIH0NCg0KICBjb25zdCBiZXN0TW92ZSA9IHJvb3RNb3Zlc1swXSB8fCBudWxsOw0KICBjb25zdCBzZWNvbmRCZXN0TW92ZSA9IHJvb3RNb3Zlcy5sZW5ndGggPiAxID8gcm9vdE1vdmVzWzFdIDogbnVsbDsNCiAgY29uc3QgYmVzdE1vdmVTZXF1ZW5jZSA9IGJlc3RNb3ZlID8gKGJlc3RNb3ZlLm1vdmVTZXF1ZW5jZSB8fCBbXSkgOiBbXTsNCiAgY29uc3Qgc2Vjb25kTW92ZVNlcXVlbmNlID0gc2Vjb25kQmVzdE1vdmUgPyAoc2Vjb25kQmVzdE1vdmUubW92ZVNlcXVlbmNlIHx8IFtdKSA6IFtdOw0KICBjb25zdCBiZXN0TW92ZVNjb3JlID0gYmVzdE1vdmUgPyBiZXN0TW92ZS5zY29yZSA6IDA7DQogIGNvbnN0IHNlY29uZEJlc3RNb3ZlU2NvcmUgPSBzZWNvbmRCZXN0TW92ZSA/IHNlY29uZEJlc3RNb3ZlLnNjb3JlIDogMDsNCg0KICBjb25zdCBhbGxNb3Zlc1dpdGhTY29yZXMgPSByb290TW92ZXMubWFwKChtb3ZlSW5mbykgPT4gKHsNCiAgICBtb3ZlOiB7DQogICAgICBmcm9tOiBtb3ZlSW5mby5mcm9tLA0KICAgICAgdG86IG1vdmVJbmZvLnRvDQogICAgfSwNCiAgICBzY29yZTogbW92ZUluZm8uc2NvcmUsDQogICAgbW92ZVNlcXVlbmNlOiBtb3ZlSW5mby5tb3ZlU2VxdWVuY2UgfHwgW10NCiAgfSkpOw0KDQogIGNvbnN0IHJlc3VsdCA9IHsNCiAgICBiZXN0TW92ZSwNCiAgICBzZWNvbmRCZXN0TW92ZSwNCiAgICBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UsDQogICAgc2Vjb25kTW92ZVNlcXVlbmNlLA0KICAgIGJlc3RNb3ZlU2NvcmUsDQogICAgc2Vjb25kQmVzdE1vdmVTY29yZSwNCiAgICBhbGxNb3Zlc1dpdGhTY29yZXMsDQogICAgY29tcGxldGVkRGVwdGgNCiAgfTsNCiAgYWN0aXZlU2VhcmNoUGllY2VTdGF0ZSA9IG51bGw7DQogIHJldHVybiByZXN1bHQ7DQp9Ow0KDQovLyBQbGF5IGtlZXBzIHJvb3QgZmFpbC1sb3cgcHJvYmVzIGFzIGJvdW5kczsgYW5hbHlzaXMgcmUtc2VhcmNoZXMgZXZlcnkgZmluYWwNCi8vIHJvb3QgbW92ZSBhbmQgcmV0YWlucyBQViBkYXRhLiBLZWVwaW5nIHRoZWlyIGVudHJ5IHBvaW50cyBzZXBhcmF0ZSBwcmV2ZW50cw0KLy8gZnV0dXJlIHBsYXktcGF0aCB3b3JrIGZyb20gc2lsZW50bHkgY2hhbmdpbmcgYW5hbHlzaXMgc2VtYW50aWNzLg0KY29uc3QgZ2V0QmVzdE1vdmVGb3JQbGF5ID0gKGJvYXJkLCB0dXJuLCBkZXB0aCwgcGx5LCBlbmFibGVUaW1lTGltaXQpID0+DQogIGdldEJlc3RNb3ZlSW50ZXJuYWwoYm9hcmQsIHR1cm4sIGRlcHRoLCBwbHksIGVuYWJsZVRpbWVMaW1pdCwgZmFsc2UsIGZhbHNlKTsNCg0KY29uc3QgZ2V0QmVzdE1vdmVGb3JBbmFseXNpcyA9IChib2FyZCwgdHVybiwgZGVwdGgsIHBseSwgZW5hYmxlVGltZUxpbWl0KSA9Pg0KICBnZXRCZXN0TW92ZUludGVybmFsKGJvYXJkLCB0dXJuLCBkZXB0aCwgcGx5LCBlbmFibGVUaW1lTGltaXQsIHRydWUsIHRydWUpOw0KDQpjb25zdCBnZXRCZXN0TW92ZSA9IChib2FyZCwgdHVybiwgZGVwdGggPSA4LCBwbHkgPSAwLCBlbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzID0gZmFsc2UpID0+DQogIGV4YWN0Um9vdFNjb3Jlcw0KICAgID8gZ2V0QmVzdE1vdmVGb3JBbmFseXNpcyhib2FyZCwgdHVybiwgZGVwdGgsIHBseSwgZW5hYmxlVGltZUxpbWl0KQ0KICAgIDogZ2V0QmVzdE1vdmVGb3JQbGF5KGJvYXJkLCB0dXJuLCBkZXB0aCwgcGx5LCBlbmFibGVUaW1lTGltaXQpOw0KDQovLyAtLS0gV09SS0VSIExJU1RFTkVSICjnu5/kuIDmtojmga/lpITnkIYpIC0tLQ0K';
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

