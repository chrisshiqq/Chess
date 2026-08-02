
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovCgovLyDmo4vnm5jluLjph4/lrprkuYkKY29uc3QgUk9XUyA9IDEwOwpjb25zdCBDT0xTID0gOTsKCi8vIOaji+WtkOexu+Wei+WumuS5iQpjb25zdCBQSUVDRV9UWVBFUyA9IHsKICAgIEdFTkVSQUw6ICdnZW5lcmFsJywKICAgIENIQVJJT1Q6ICdjaGFyaW90JywKICAgIENBTk5PTjogJ2Nhbm5vbicsCiAgICBIT1JTRTogJ2hvcnNlJywKICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLAogICAgQURWSVNPUjogJ2Fkdmlzb3InLAogICAgU09MRElFUjogJ3NvbGRpZXInCn07CgovLyDmnZDmlpnlgLzmnYPph43phY3nva4KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gewogICAgZ2VuZXJhbDogMTAwMDAsICAvLyDlsIYv5biFCiAgICBjaGFyaW90OiA5MDAsICAgICAvLyDovaYKICAgIGNhbm5vbjogewogICAgICAgIGVhcmx5OiA0NTAsICAgIC8vIOW8gOWxgOmYtuautQogICAgICAgIG1pZDogNDAwLCAgICAgIC8vIOS4reWxgOmYtuautQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQogICAgfSwgICAgICAgICAgICAgICAgLy8g54KuCiAgICBob3JzZTogewogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQogICAgICAgIG1pZDogNDUwLCAgICAgIC8vIOS4reWxgOmYtuautQogICAgICAgIGxhdGU6IDQ1MCAgICAgIC8vIOaui+WxgOmYtuautQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsCiAgICBlbGVwaGFudDogMjAwLCAgICAvLyDosaEv55u4CiAgICBhZHZpc29yOiAyMDAsICAgICAvLyDlo6sv5LuVCiAgICBzb2xkaWVyOiB7CiAgICAgICAgZWFybHk6IDEwMCwgICAgLy8g5byA5bGA6Zi25q61CiAgICAgICAgbWlkOiAyMDAsICAgICAgLy8g5Lit5bGA6Zi25q61CiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61CiAgICB9ICAgICAgICAgICAgICAgICAgLy8g5YW1L+WNkgp9OwoKLy8g5qOL5a2Q5Lu35YC85p2D6YeN6YWN572uCmxldCBWQUxVRV9XRUlHSFRTID0gewogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQogICAgLy9wb3NpdGlvbjogMC4yLCAgIC8vIOS9jee9ruWAvOadg+mHjQogICAgLy90aHJlYXQ6IDAuMTUsICAgIC8vIOWogeiDgeWAvOadg+mHjQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQogICAgLy9zYWZldHk6IDAuMSwgICAgIC8vIOWuieWFqOWAvOadg+mHjQogICAgLy9tb2JpbGl0eTogMC4wNSAgIC8vIOacuuWKqOWAvOadg+mHjQoKICAgIG1hdGVyaWFsOiAxLCAgICAvLyDmnZDmlpnlgLzmnYPph40KICAgIHBvc2l0aW9uOiAxLCAgICAvLyDkvY3nva7lgLzmnYPph40KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQogICAgdGFjdGljOiAxLCAgICAgIC8vIOaImOacr+WAvOadg+mHjQogICAgc2FmZXR5OiAxLCAgICAgIC8vIOWuieWFqOWAvOadg+mHjQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQp9OwoKLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XCmNvbnN0IEVWQUxVQVRJT05fUEFSQU1FVEVSUyA9IHsKICAgIC8vIOacuuWKqOWAvOWPguaVsAogICAgbW9iaWxpdHk6IHsKICAgICAgICBiYXNlTW92ZVZhbHVlOiAxLCAgICAgIC8vIOWfuuehgOenu+WKqOS7t+WAvAogICAgfSwKICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQogICAgY2hlY2s6IHsKICAgICAgICBib251czogODAKICAgIH0KfTsKCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rgpjb25zdCBQT1NJVElPTl9UQUJMRVMgPSB7CiAgICAvLyDlhbUv5Y2S5L2N572u6KGoICjnuqLmlrnop4bop5IpCiAgICBzb2xkaWVyOiBbCiAgICAgICAgWzAsIDUsIDEwLCAxNSwgMjAsIDE1LCAxMCwgNSwgMF0sCiAgICAgICAgWzUsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCA1XSwKICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sCiAgICAgICAgWzEwLCAxNSwgMjUsIDMwLCAzMCwgMzAsIDI1LCAxNSwgMTBdLAogICAgICAgIFsxMCwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDEwXSwKICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdCiAgICBdLAogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpCiAgICBjaGFyaW90OiBbCiAgICAgICAgWzUsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDEwLCA1XSwKICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLAogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwKICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLAogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwKICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLAogICAgICAgIFsxMCwgMTAsIDUsIDE1LCAwLCAxNSwgNSwgMTAsIDEwXSwKICAgICAgICBbMCwgMTAsIDUsIDUsIDUsIDUsIDEwLCA1LCAwXQogICAgXSwKICAgIC8vIOmprOS9jee9ruihqCAo57qi5pa56KeG6KeSKQogICAgaG9yc2U6IFsKICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwKICAgICAgICBbMCwgNSwgMjUsIDEwLCAxMCwgMTAsIDI1LCA1LCAwXSwKICAgICAgICBbNSwgNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCA1LCA1XSwKICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sCiAgICAgICAgWzAsIDUsIDE1LCAyMCwgMjAsIDIwLCAxNSwgNSwgMF0sCiAgICAgICAgWzAsIDUsIDI1LCAyMCwgMCwgMjAsIDI1LCA1LCAwXSwKICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwKICAgICAgICBbNSwgMCwgNSwgNSwgMCwgNSwgNSwgMCwgNV0sCiAgICAgICAgWzAsIDAsIDAsIDUsIC0yMCwgNSwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdCiAgICBdLAogICAgLy8g54Ku5L2N572u6KGoICjnuqLmlrnop4bop5IpCiAgICBjYW5ub246IFsKICAgICAgICBbMTAsIDIwLCAxNSwgMTAsIDAsIDEwLCAxNSwgMjAsIDEwXSwKICAgICAgICBbMCwgNSwgNSwgMTAsIDEwLCAxMCwgNSwgNSwgMF0sCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLAogICAgICAgIFs1LCA1LCAxNSwgNSwgMjUsIDUsIDE1LCA1LCA1XSwKICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLAogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwKICAgICAgICBbMTAsIDEwLCAxNSwgMjAsIDMwLCAyMCwgMTUsIDEwLCAxMF0sIAogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0KICAgIF0sCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikKICAgIGVsZXBoYW50OiBbCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0KICAgIF0sCiAgICAvLyDlo6vkvY3nva7ooaggKOe6ouaWueinhuinkikKICAgIGFkdmlzb3I6IFsKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAxMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0KICAgIF0KfTsKCi8vIOiOt+WPluaji+WtkOeahOadkOaWmeWAvApjb25zdCBnZXRNYXRlcmlhbFZhbHVlID0gKHBpZWNlLCBnYW1lU3RhZ2UgPSAnbWlkJykgPT4gewogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOwogICAgCiAgICAvLyDpkojlr7nmnInliIbpmLbmrrXmnZDmlpnlgLznmoTlhbXnp43vvIjlhbXjgIHngq7jgIHpqazvvInosIPmlbTmnZDmlpnlgLwKICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7CiAgICAgICAgdmFsdWUgPSB2YWx1ZVtnYW1lU3RhZ2VdIHx8IHZhbHVlLm1pZDsKICAgIH0KICAgIAogICAgcmV0dXJuIHZhbHVlOwp9OwoKLy8g6I635Y+W5qOL5a2Q55qE5L2N572u5YC8CmNvbnN0IGdldFBvc2l0aW9uVmFsdWUgPSAocGllY2UsIHIsIGMpID0+IHsKICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOwogICAgaWYgKCF0YWJsZSkgcmV0dXJuIDA7CiAgICAKICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqAogICAgY29uc3Qgcm93SWR4ID0gcGllY2UuY29sb3IgPT09ICdyZWQnID8gKDktIHIpIDogcjsKICAgIHJldHVybiB0YWJsZVtyb3dJZHhdW2NdIHx8IDA7Cn07CgovLyDmlLvlh7vkvY3lm77vvJo5MCDmoLznlKggM8OXVWludDMy44CC5pCc57Si5Y+25Y+q6ZyA44CM5piv5ZCm5pWM5o6n44CN77yb54K55qOLL1VJIOS7jeeUqOaOp+WItuiAheWIl+ihqOOAggpjb25zdCBBVFRBQ0tfV09SRFMgPSAzOwpjb25zdCBzY3JhdGNoUmVkQXR0YWNrID0gbmV3IFVpbnQzMkFycmF5KEFUVEFDS19XT1JEUyk7CmNvbnN0IHNjcmF0Y2hCbGFja0F0dGFjayA9IG5ldyBVaW50MzJBcnJheShBVFRBQ0tfV09SRFMpOwovLyB0cnVlPeaQnOe0ouWPtueUqOaUu+WHu+S9jeWbvu+8iOm7mOiupO+8ie+8m2ZhbHNlPeWPtuivhOS8sOS7jeW7uiAxMMOXOSDmjqfliLbogIXooajvvIhBL0LvvIkKbGV0IFNFQVJDSF9MRUFGX0FUVEFDS19CSVRTID0gdHJ1ZTsKLy8gdHJ1ZT3lhbPns7vnlKjmoLzkvY0gVWludDMyIOaUuy/lrogv5o6nIG1hc2vvvIjpu5jorqTvvInvvJtmYWxzZT10aHJlYXQvZ3VhcmQg5a+56LGh5YiX6KGo77yIQS9C77yJCmxldCBTRUFSQ0hfUkVMQVRJT05fTUFTS1MgPSB0cnVlOwoKY29uc3QgY2xlYXJBdHRhY2tCaXRzID0gKGJpdHMpID0+IHsKICAgIGJpdHNbMF0gPSAwOwogICAgYml0c1sxXSA9IDA7CiAgICBiaXRzWzJdID0gMDsKfTsKCmNvbnN0IHNldEF0dGFja0JpdCA9IChiaXRzLCBzcSkgPT4gewogICAgYml0c1tzcSA+Pj4gNV0gfD0gKDEgPDwgKHNxICYgMzEpKTsKfTsKCmNvbnN0IGhhc0F0dGFja0JpdCA9IChiaXRzLCBzcSkgPT4gKGJpdHNbc3EgPj4+IDVdICYgKDEgPDwgKHNxICYgMzEpKSkgIT09IDA7Cgpjb25zdCBtYWtlRW1wdHlDb250cm9sbGVyR3JpZCA9ICgpID0+CiAgICBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsKCi8vIOWFs+ezuyBtYXNr77ya5pyA5aSaIDMyIOWtkO+8iOS4reWbveixoeaji+a7oeebmO+8ie+8jGJpdCBpID0gcGllY2VzSW5mb1tpXQpjb25zdCBSRUxfU1FVQVJFUyA9IDkwOwpjb25zdCBzY3JhdGNoQXR0YWNrTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7ICAvLyDmlYzlrZDmiYDlnKjmoLzvvJrosIHlnKjmiZPlroMKY29uc3Qgc2NyYXRjaEd1YXJkTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7ICAgLy8g5Y+L5Yab5omA5Zyo5qC877ya6LCB5Zyo5L+d5a6DCmNvbnN0IHNjcmF0Y2hDb250cm9sTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7IC8vIOepuuaOp+agvO+8muiwgeaOp+WItuWug++8iOWvuem9kOaXpyBib2FyZEluZm/vvIkKCmNvbnN0IGNsZWFyUmVsYXRpb25NYXNrcyA9IChjbGVhckNvbnRyb2wgPSB0cnVlKSA9PiB7CiAgICBzY3JhdGNoQXR0YWNrTWFzay5maWxsKDApOwogICAgc2NyYXRjaEd1YXJkTWFzay5maWxsKDApOwogICAgaWYgKGNsZWFyQ29udHJvbCkgc2NyYXRjaENvbnRyb2xNYXNrLmZpbGwoMCk7Cn07CgovLyDmoLzkvY0g4oaSIHBpZWNlc0luZm8g5byV55So77yI5pu/5Luj5q+P5Y+2IG5ldyBNYXDvvIkKY29uc3Qgc2NyYXRjaFBpZWNlQXRTcSA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7CmNvbnN0IGNsZWFyUGllY2VBdFNxID0gKCkgPT4gewogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBSRUxfU1FVQVJFUzsgaSsrKSBzY3JhdGNoUGllY2VBdFNxW2ldID0gbnVsbDsKfTsKCi8vIOWkjeeUqCByZWxDdHjvvIzpgb/lhY3mr4/lrZAgbmV3IOWwj+WvueixoQpjb25zdCBzY3JhdGNoUmVsQ3R4ID0gewogICAgdXNlTWFza3M6IHRydWUsCiAgICBza2lwQ29udHJvbE1hc2s6IGZhbHNlLCAvLyDmkJzntKLlj7bvvJrkuI3lhpnnqbrmjqcgY29udHJvbE1hc2vvvIjku43lhpnmlLvlh7vkvY3lm74r5py65Yqo77yJCiAgICBwaWVjZUluZGV4OiAwLAogICAgYXR0YWNrTWFzazogbnVsbCwKICAgIGd1YXJkTWFzazogbnVsbCwKICAgIGNvbnRyb2xNYXNrOiBudWxsLAogICAgcmVkQXR0YWNrOiBudWxsLAogICAgYmxhY2tBdHRhY2s6IG51bGwKfTsKCmNvbnN0IGxvd2VzdFNldEJpdEluZGV4ID0gKG1hc2spID0+IDMxIC0gTWF0aC5jbHozMihtYXNrICYgLW1hc2spOwoKY29uc3QgZm9yRWFjaFNldEJpdCA9IChtYXNrLCBmbikgPT4gewogICAgbGV0IG0gPSBtYXNrID4+PiAwOwogICAgd2hpbGUgKG0gIT09IDApIHsKICAgICAgICBjb25zdCBiaXQgPSBtICYgLW07CiAgICAgICAgZm4oMzEgLSBNYXRoLmNsejMyKGJpdCkpOwogICAgICAgIG0gXj0gYml0OwogICAgfQp9OwoKLy8g5Li76K+E5Lyw5Ye95pWwIC0g6K+m57uG6K+E5Lyw5qOL55uY5bGA5Yq/77yIVUkgLyDngrnmo4vlhbPns7sgLyDmkJzntKLlj7YgLyDmoLnoioLngrnvvIkKLy8gb3B0aW9ucy5mb3JTZWFyY2hMZWFmOiDku4Xot7Pov4fnu4jlsYAgZ2V0VmFsaWRNb3Zlc++8iOaXoOedgOW3suWcqOeItuiKgueCueWkhOeQhu+8ie+8m+WPr+eUqOaUu+WHu+S9jeWbvuS7o+abv+aOp+WItuiAheihqApjb25zdCBldmFsdWF0ZUJvYXJkID0gKGJvYXJkLCBjdXJyZW50UGxheWVyID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcsIG9wdGlvbnMgPSBudWxsKSA9PiB7CiAgICBjb25zdCBfX3QwID0gcGVyZm9ybWFuY2Uubm93KCk7CiAgICAvLyDnu5/orqEKICAgIGlmIChjdXJyZW50UGxheWVyKSB7CiAgICAgICAgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRDb3VudFtjdXJyZW50UGxheWVyXSsrOwogICAgfQogICAgY29uc3QgZm9yU2VhcmNoTGVhZiA9ICEhKG9wdGlvbnMgJiYgb3B0aW9ucy5mb3JTZWFyY2hMZWFmKTsKCiAgICBjb25zdCBvdXRwdXRQaGFzZSA9IGdhbWVTdGFnZTsKCiAgICAvLyDpgY3ljobmo4vnm5jvvJrlj6rmlLbpm4blrZDlipsvUFNU77yb552A5rOVK+WFs+ezu+e7n+S4gOWcqCBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyDkuIDmrKHlh6DkvZXnlJ/miJDvvIjlr7npvZDngq7vvIkKICAgIGxldCBwaWVjZXNJbmZvID0gW107CiAgICBsZXQgcmVkTWF0ZXJpYWwgPSAwLCByZWRQb3NpdGlvbiA9IDA7CiAgICBsZXQgYmxhY2tNYXRlcmlhbCA9IDAsIGJsYWNrUG9zaXRpb24gPSAwOwogICAgCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgewogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOwogICAgICAgICAgICAKICAgICAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7CiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uVmFsdWUgPSBnZXRQb3NpdGlvblZhbHVlKHBpZWNlLCByLCBjKTsKICAgICAgICAgICAgCiAgICAgICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsKICAgICAgICAgICAgICAgIHJlZE1hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7CiAgICAgICAgICAgICAgICByZWRQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgYmxhY2tNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOwogICAgICAgICAgICAgICAgYmxhY2tQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOwogICAgICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgICAgICBwaWVjZXNJbmZvLnB1c2goewogICAgICAgICAgICAgICAgcGllY2UsCiAgICAgICAgICAgICAgICByLAogICAgICAgICAgICAgICAgYywKICAgICAgICAgICAgICAgIHBpZWNlSW5kZXg6IHBpZWNlc0luZm8ubGVuZ3RoLAogICAgICAgICAgICAgICAgbW92ZXM6IFtdLAogICAgICAgICAgICAgICAgYWxseUd1YXJkczogW10sCiAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlLAogICAgICAgICAgICAgICAgcG9zaXRpb25WYWx1ZSwKICAgICAgICAgICAgICAgIHRocmVhdFZhbHVlOiAwLAogICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsCiAgICAgICAgICAgICAgICB0YWN0aWNWYWx1ZTogMCwKICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWU6IDAsCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLAogICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwKICAgICAgICAgICAgICAgIGd1YXJkOiBbXSwKICAgICAgICAgICAgICAgIGd1YXJkZWRCeTogW10sCiAgICAgICAgICAgICAgICBjb250cm9sOiBbXSwKICAgICAgICAgICAgICAgIHByb3RlY3Q6IFtdCiAgICAgICAgICAgIH0pOwogICAgICAgIH0KICAgIH0KCiAgICAvLyDlhbPns7sgbWFza++8iOKJpDMyIOWtkO+8ieS8mOWFiO+8m+WQpuWImeWbnumAgOaXp+WIl+ihqCAvIOWPtuaUu+WHu+S9jeWbvgogICAgY29uc3QgdXNlUmVsYXRpb25NYXNrcyA9IFNFQVJDSF9SRUxBVElPTl9NQVNLUyAmJiBwaWVjZXNJbmZvLmxlbmd0aCA8PSAzMjsKICAgIGNvbnN0IHVzZUF0dGFja0JpdHMgPSAhdXNlUmVsYXRpb25NYXNrcyAmJiBmb3JTZWFyY2hMZWFmICYmIFNFQVJDSF9MRUFGX0FUVEFDS19CSVRTOwogICAgbGV0IGJvYXJkSW5mbzsKICAgIGlmICh1c2VSZWxhdGlvbk1hc2tzKSB7CiAgICAgICAgY2xlYXJSZWxhdGlvbk1hc2tzKCFmb3JTZWFyY2hMZWFmKTsKICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaFJlZEF0dGFjayk7CiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7CiAgICAgICAgYm9hcmRJbmZvID0gewogICAgICAgICAgICB1c2VSZWxhdGlvbk1hc2tzOiB0cnVlLAogICAgICAgICAgICB1c2VBdHRhY2tCaXRzOiB0cnVlLAogICAgICAgICAgICBza2lwQ29udHJvbE1hc2s6ICEhZm9yU2VhcmNoTGVhZiwKICAgICAgICAgICAgYXR0YWNrTWFzazogc2NyYXRjaEF0dGFja01hc2ssCiAgICAgICAgICAgIGd1YXJkTWFzazogc2NyYXRjaEd1YXJkTWFzaywKICAgICAgICAgICAgY29udHJvbE1hc2s6IHNjcmF0Y2hDb250cm9sTWFzaywKICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLAogICAgICAgICAgICBibGFja0F0dGFjazogc2NyYXRjaEJsYWNrQXR0YWNrCiAgICAgICAgfTsKICAgIH0gZWxzZSBpZiAodXNlQXR0YWNrQml0cykgewogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsKICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaEJsYWNrQXR0YWNrKTsKICAgICAgICBib2FyZEluZm8gPSB7CiAgICAgICAgICAgIHVzZUF0dGFja0JpdHM6IHRydWUsCiAgICAgICAgICAgIHJlZEF0dGFjazogc2NyYXRjaFJlZEF0dGFjaywKICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjawogICAgICAgIH07CiAgICB9IGVsc2UgewogICAgICAgIGJvYXJkSW5mbyA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7CiAgICB9CiAgICBjYWxjdWxhdGVEZXJpdmVkVmFsdWVzKGJvYXJkLCBwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyLCBib2FyZEluZm8sIGZvclNlYXJjaExlYWYpOwogICAgCiAgICAvLyDnrKzkuInmraXvvJrorqHnrpfmgLvliIbvvIjlj6rorqHnrpfliankvZnliIbmlbDvvIzln7rnoYDliIbmlbDlt7LlnKjmo4vnm5jpgY3ljobml7borqHnrpfvvIkKICAgIGxldCByZWRUaHJlYXQgPSAwLCByZWRUYWN0aWMgPSAwLCByZWRTYWZldHkgPSAwLCByZWRNb2JpbGl0eSA9IDA7CiAgICBsZXQgYmxhY2tUaHJlYXQgPSAwLCBibGFja1RhY3RpYyA9IDAsIGJsYWNrU2FmZXR5ID0gMCwgYmxhY2tNb2JpbGl0eSA9IDA7CiAgICAKICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7CiAgICAgICAgY29uc3QgeyBwaWVjZSwgdGhyZWF0VmFsdWUsIHRhY3RpY1ZhbHVlLCBzYWZldHlWYWx1ZSwgbW9iaWxpdHlWYWx1ZSB9ID0gaW5mbzsKICAgICAgICAKICAgICAgICBpZiAocGllY2UuY29sb3IgPT09ICdyZWQnKSB7CiAgICAgICAgICAgIHJlZFRocmVhdCArPSB0aHJlYXRWYWx1ZTsKICAgICAgICAgICAgcmVkVGFjdGljICs9IHRhY3RpY1ZhbHVlOwogICAgICAgICAgICByZWRTYWZldHkgKz0gc2FmZXR5VmFsdWU7CiAgICAgICAgICAgIHJlZE1vYmlsaXR5ICs9IG1vYmlsaXR5VmFsdWU7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgYmxhY2tUaHJlYXQgKz0gdGhyZWF0VmFsdWU7CiAgICAgICAgICAgIGJsYWNrVGFjdGljICs9IHRhY3RpY1ZhbHVlOwogICAgICAgICAgICBibGFja1NhZmV0eSArPSBzYWZldHlWYWx1ZTsKICAgICAgICAgICAgYmxhY2tNb2JpbGl0eSArPSBtb2JpbGl0eVZhbHVlOwogICAgICAgIH0KICAgIH0KICAgIAogICAgLy8g6K6h566X5bGA5Yq/5oC75YiGCiAgICBjb25zdCByZWRUb3RhbCA9IAogICAgICAgIHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArCiAgICAgICAgcmVkUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsKICAgICAgICByZWRUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArCiAgICAgICAgcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKwogICAgICAgIHJlZFNhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsKICAgICAgICByZWRNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7IAogICAgCiAgICBjb25zdCBibGFja1RvdGFsID0gCiAgICAgICAgYmxhY2tNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwgKwogICAgICAgIGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsKICAgICAgICBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsKICAgICAgICBibGFja1RhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljICsKICAgICAgICBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsKICAgICAgICBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsKICAgIAogICAgLy8g6L+U5Zue6K+m57uG6K+E5Lyw57uT5p6cCiAgICBjb25zdCBfX2V2YWxSZXN1bHQgPSB7CiAgICAgICAgcmVkOiB7CiAgICAgICAgICAgIHRvdGFsOiByZWRUb3RhbCwKICAgICAgICAgICAgbWF0ZXJpYWw6IHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwKICAgICAgICAgICAgcG9zaXRpb246IHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwKICAgICAgICAgICAgdGhyZWF0OiByZWRUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCwKICAgICAgICAgICAgdGFjdGljOiByZWRUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYywKICAgICAgICAgICAgc2FmZXR5OiByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwKICAgICAgICAgICAgbW9iaWxpdHk6IHJlZE1vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eSwKICAgICAgICAgICAgcGhhc2U6IG91dHB1dFBoYXNlLAogICAgICAgICAgICB3ZWlnaHRzOiB7CiAgICAgICAgICAgICAgICBtYXRlcmlhbDogMC40LAogICAgICAgICAgICAgICAgcG9zaXRpb246IDAuMiwKICAgICAgICAgICAgICAgIHRhY3RpYzogMC4xLAogICAgICAgICAgICAgICAgc2FmZXR5OiAwLjEsCiAgICAgICAgICAgICAgICBtb2JpbGl0eTogMC4wNSwKICAgICAgICAgICAgICAgIHRocmVhdDogMC4xNQogICAgICAgICAgICB9CiAgICAgICAgfSwKICAgICAgICBibGFjazogewogICAgICAgICAgICB0b3RhbDogYmxhY2tUb3RhbCwKICAgICAgICAgICAgbWF0ZXJpYWw6IGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsLAogICAgICAgICAgICBwb3NpdGlvbjogYmxhY2tQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sCiAgICAgICAgICAgIHRocmVhdDogYmxhY2tUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCwKICAgICAgICAgICAgdGFjdGljOiBibGFja1RhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljLAogICAgICAgICAgICBzYWZldHk6IGJsYWNrU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHksCiAgICAgICAgICAgIG1vYmlsaXR5OiBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eSwKICAgICAgICAgICAgcGhhc2U6IG91dHB1dFBoYXNlLAogICAgICAgICAgICB3ZWlnaHRzOiB7CiAgICAgICAgICAgICAgICBtYXRlcmlhbDogMC40LAogICAgICAgICAgICAgICAgcG9zaXRpb246IDAuMiwKICAgICAgICAgICAgICAgIHRhY3RpYzogMC4xLAogICAgICAgICAgICAgICAgc2FmZXR5OiAwLjEsCiAgICAgICAgICAgICAgICBtb2JpbGl0eTogMC4wNSwKICAgICAgICAgICAgICAgIHRocmVhdDogMC4xNQogICAgICAgICAgICB9CiAgICAgICAgfSwKICAgICAgICBwaWVjZXNJbmZvOiBwaWVjZXNJbmZvLAogICAgICAgIGdhbWVTdGFnZTogZ2FtZVN0YWdlLAogICAgICAgIGJvYXJkSW5mbzogYm9hcmRJbmZvCiAgICB9OwogICAgaWYgKHR5cGVvZiBwZXJmU3RhdHMgIT09ICd1bmRlZmluZWQnICYmIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMgIT0gbnVsbCkgewogICAgICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOwogICAgfQogICAgcmV0dXJuIF9fZXZhbFJlc3VsdDsKfTsKCi8vIOWwhi/luIXkvY3nva7nvJPlrZjvvJrkvpsgcG9zdC1tb3ZlIGlzQ2hlY2sgLyDpo57lsIblv6vpgJ/mn6Xor6LvvIznlLEgbWFrZS91bm1ha2Ug57u05oqkCmxldCBnZW5lcmFsUG9zQ2FjaGUgPSB7IHJlZDogbnVsbCwgYmxhY2s6IG51bGwgfTsKCi8vIOWwhuW4heS7heWcqOS5neWuq+WGhe+8jOaMieS5neWuq+aJq+aPj+WNs+WPrwpjb25zdCBmaW5kR2VuZXJhbFBvcyA9IChib2FyZCwgY29sb3IpID0+IHsKICAgIGNvbnN0IHJvd1N0YXJ0ID0gY29sb3IgPT09ICdyZWQnID8gMCA6IDc7CiAgICBjb25zdCByb3dFbmQgPSBjb2xvciA9PT0gJ3JlZCcgPyAyIDogOTsKICAgIGZvciAobGV0IHIgPSByb3dTdGFydDsgciA8PSByb3dFbmQ7IHIrKykgewogICAgICAgIGZvciAobGV0IGMgPSAzOyBjIDw9IDU7IGMrKykgewogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgIGlmIChwICYmIHAudHlwZSA9PT0gJ2dlbmVyYWwnICYmIHAuY29sb3IgPT09IGNvbG9yKSB7CiAgICAgICAgICAgICAgICByZXR1cm4geyByLCBjIH07CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CiAgICByZXR1cm4gbnVsbDsKfTsKCmNvbnN0IHN5bmNHZW5lcmFsUG9zQ2FjaGUgPSAoYm9hcmQpID0+IHsKICAgIGdlbmVyYWxQb3NDYWNoZS5yZWQgPSBmaW5kR2VuZXJhbFBvcyhib2FyZCwgJ3JlZCcpOwogICAgZ2VuZXJhbFBvc0NhY2hlLmJsYWNrID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsICdibGFjaycpOwp9OwoKY29uc3QgZ2V0R2VuZXJhbFBvcyA9IChib2FyZCwgY29sb3IpID0+IHsKICAgIGNvbnN0IGNhY2hlZCA9IGdlbmVyYWxQb3NDYWNoZVtjb2xvcl07CiAgICBpZiAoY2FjaGVkKSB7CiAgICAgICAgY29uc3QgcCA9IGJvYXJkW2NhY2hlZC5yXT8uW2NhY2hlZC5jXTsKICAgICAgICBpZiAocCAmJiBwLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBwLmNvbG9yID09PSBjb2xvcikgewogICAgICAgICAgICByZXR1cm4gY2FjaGVkOwogICAgICAgIH0KICAgIH0KICAgIGNvbnN0IHBvcyA9IGZpbmRHZW5lcmFsUG9zKGJvYXJkLCBjb2xvcik7CiAgICBnZW5lcmFsUG9zQ2FjaGVbY29sb3JdID0gcG9zOwogICAgcmV0dXJuIHBvczsKfTsKCi8vIOaQnOe0oueUqOWOn+WcsOi1sOWtkCAvIOaBouWkje+8iOmBv+WFjeavj+asoemAkuW9kiBib2FyZC5tYXDvvInvvJvlkIzmraXnu7TmiqTlsIbkvY3nvJPlrZgKY29uc3QgbWFrZU1vdmUgPSAoYm9hcmQsIGZyb20sIHRvKSA9PiB7CiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsKICAgIGNvbnN0IGNhcHR1cmVkID0gYm9hcmRbdG8ucl1bdG8uY107CiAgICBib2FyZFt0by5yXVt0by5jXSA9IHBpZWNlOwogICAgYm9hcmRbZnJvbS5yXVtmcm9tLmNdID0gbnVsbDsKICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsKICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbcGllY2UuY29sb3JdID0geyByOiB0by5yLCBjOiB0by5jIH07CiAgICB9CiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IG51bGw7CiAgICB9CiAgICByZXR1cm4gY2FwdHVyZWQ7Cn07Cgpjb25zdCB1bm1ha2VNb3ZlID0gKGJvYXJkLCBmcm9tLCB0bywgY2FwdHVyZWQpID0+IHsKICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbdG8ucl1bdG8uY107CiAgICBib2FyZFtmcm9tLnJdW2Zyb20uY10gPSBwaWVjZTsKICAgIGJvYXJkW3RvLnJdW3RvLmNdID0gY2FwdHVyZWQ7CiAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogZnJvbS5yLCBjOiBmcm9tLmMgfTsKICAgIH0KICAgIGlmIChjYXB0dXJlZCAmJiBjYXB0dXJlZC50eXBlID09PSAnZ2VuZXJhbCcpIHsKICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0geyByOiB0by5yLCBjOiB0by5jIH07CiAgICB9Cn07CgovLyDotbDlrZDlkI7mmK/lkKbkvb/lt7HmlrnlsIbkuI3lronlhajvvIjpo57lsIbmiJbooqvlsIbvvInjgILosIPnlKjliY3pobvlt7IgbWFrZU1vdmXjgIIKY29uc3QgbGVhdmVzT3duS2luZ1Vuc2FmZSA9IChib2FyZCwgY29sb3IpID0+IHsKICAgIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcysrOwogICAgcmV0dXJuIGlzRmx5aW5nR2VuZXJhbChib2FyZCkgfHwgaXNDaGVja1Jhdyhib2FyZCwgY29sb3IpOwp9OwoKLy8g5LuO5Lyq5ZCI5rOV552A5rOV5Lit6L+H5ruk5Ye65LiN6YCB5bCGL+S4jemjnuWwhueahOWQiOazleedgOazle+8iFVJL+agueiKgueCuS/lvIDlsYDlupPmoKHpqozvvIkKLy8g5pCc57Si54Ot6Lev5b6E5L2/55So5bu26L+f5ZCI5rOV5oCn77yI6K+V6LWw5pe25qOA5rWL77yJ77yM6YG/5YWN5a+55Ymq5p6d5pyq6Kem5Y+K55qE552A5rOV5YGa5YWo6YeP6L+H5rukCmNvbnN0IGZpbHRlckxlZ2FsTW92ZXMgPSAoYm9hcmQsIGZyb20sIHBpZWNlLCBwc2V1ZG9Nb3ZlcykgPT4gewogICAgY29uc3QgdmFsaWRNb3ZlcyA9IFtdOwogICAgZm9yIChjb25zdCB0byBvZiBwc2V1ZG9Nb3ZlcykgewogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZU1vdmUoYm9hcmQsIGZyb20sIHRvKTsKICAgICAgICBjb25zdCBpbGxlZ2FsID0gbGVhdmVzT3duS2luZ1Vuc2FmZShib2FyZCwgcGllY2UuY29sb3IpOwogICAgICAgIHVubWFrZU1vdmUoYm9hcmQsIGZyb20sIHRvLCBjYXB0dXJlZCk7CiAgICAgICAgaWYgKCFpbGxlZ2FsKSB2YWxpZE1vdmVzLnB1c2godG8pOwogICAgfQogICAgcmV0dXJuIHZhbGlkTW92ZXM7Cn07CgovLyBTZWFyY2ggaG90IHBhdGggbW92ZSBlbmNvZGluZzogbW92ZSA9IChmcm9tU3EgPDwgNykgfCB0b1NxLgpjb25zdCBNT1ZFX1RPX01BU0sgPSAweDdmOwpjb25zdCBlbmNvZGVNb3ZlID0gKGZyb20sIHRvKSA9PiAoKGZyb20uciAqIDkgKyBmcm9tLmMpIDw8IDcpIHwgKHRvLnIgKiA5ICsgdG8uYyk7CmNvbnN0IGVuY29kZU1vdmVGcm9tQ29vcmRzID0gKGZyLCBmYywgdHIsIHRjKSA9PiAoKGZyICogOSArIGZjKSA8PCA3KSB8ICh0ciAqIDkgKyB0Yyk7CmNvbnN0IGlzRW5jb2RlZE1vdmUgPSAobW92ZSkgPT4gdHlwZW9mIG1vdmUgPT09ICdudW1iZXInOwpjb25zdCBtb3ZlRnJvbVNxID0gKG1vdmUpID0+IGlzRW5jb2RlZE1vdmUobW92ZSkgPyAobW92ZSA+Pj4gNykgOiBtb3ZlLmZyb20uciAqIDkgKyBtb3ZlLmZyb20uYzsKY29uc3QgbW92ZVRvU3EgPSAobW92ZSkgPT4gaXNFbmNvZGVkTW92ZShtb3ZlKSA/IChtb3ZlICYgTU9WRV9UT19NQVNLKSA6IG1vdmUudG8uciAqIDkgKyBtb3ZlLnRvLmM7CmNvbnN0IG1vdmVGcm9tUiA9IChtb3ZlKSA9PiB7CiAgICBjb25zdCBzcSA9IG1vdmVGcm9tU3EobW92ZSk7CiAgICByZXR1cm4gKHNxIC8gOSkgfCAwOwp9Owpjb25zdCBtb3ZlRnJvbUMgPSAobW92ZSkgPT4gbW92ZUZyb21TcShtb3ZlKSAlIDk7CmNvbnN0IG1vdmVUb1IgPSAobW92ZSkgPT4gewogICAgY29uc3Qgc3EgPSBtb3ZlVG9TcShtb3ZlKTsKICAgIHJldHVybiAoc3EgLyA5KSB8IDA7Cn07CmNvbnN0IG1vdmVUb0MgPSAobW92ZSkgPT4gbW92ZVRvU3EobW92ZSkgJSA5Owpjb25zdCBtb3ZlVG9PYmplY3QgPSAobW92ZSkgPT4gewogICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSByZXR1cm4gbW92ZTsKICAgIGNvbnN0IGZyb20gPSBtb3ZlRnJvbVNxKG1vdmUpOwogICAgY29uc3QgdG8gPSBtb3ZlVG9TcShtb3ZlKTsKICAgIHJldHVybiB7CiAgICAgICAgZnJvbTogeyByOiAoZnJvbSAvIDkpIHwgMCwgYzogZnJvbSAlIDkgfSwKICAgICAgICB0bzogeyByOiAodG8gLyA5KSB8IDAsIGM6IHRvICUgOSB9CiAgICB9Owp9OwoKY29uc3QgbWFrZVNlYXJjaE1vdmUgPSAoYm9hcmQsIG1vdmUpID0+IHsKICAgIGlmICghaXNFbmNvZGVkTW92ZShtb3ZlKSkgcmV0dXJuIG1ha2VNb3ZlKGJvYXJkLCBtb3ZlLmZyb20sIG1vdmUudG8pOwogICAgY29uc3QgZnJvbSA9IG1vdmUgPj4+IDc7CiAgICBjb25zdCB0byA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7CiAgICBjb25zdCBmciA9IChmcm9tIC8gOSkgfCAwLCBmYyA9IGZyb20gJSA5OwogICAgY29uc3QgdHIgPSAodG8gLyA5KSB8IDAsIHRjID0gdG8gJSA5OwogICAgY29uc3QgcGllY2UgPSBib2FyZFtmcl1bZmNdOwogICAgY29uc3QgY2FwdHVyZWQgPSBib2FyZFt0cl1bdGNdOwogICAgYm9hcmRbdHJdW3RjXSA9IHBpZWNlOwogICAgYm9hcmRbZnJdW2ZjXSA9IG51bGw7CiAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogdHIsIGM6IHRjIH07CiAgICB9CiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IG51bGw7CiAgICB9CiAgICByZXR1cm4gY2FwdHVyZWQ7Cn07Cgpjb25zdCB1bm1ha2VTZWFyY2hNb3ZlID0gKGJvYXJkLCBtb3ZlLCBjYXB0dXJlZCkgPT4gewogICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSB7CiAgICAgICAgdW5tYWtlTW92ZShib2FyZCwgbW92ZS5mcm9tLCBtb3ZlLnRvLCBjYXB0dXJlZCk7CiAgICAgICAgcmV0dXJuOwogICAgfQogICAgY29uc3QgZnJvbSA9IG1vdmUgPj4+IDc7CiAgICBjb25zdCB0byA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7CiAgICBjb25zdCBmciA9IChmcm9tIC8gOSkgfCAwLCBmYyA9IGZyb20gJSA5OwogICAgY29uc3QgdHIgPSAodG8gLyA5KSB8IDAsIHRjID0gdG8gJSA5OwogICAgY29uc3QgcGllY2UgPSBib2FyZFt0cl1bdGNdOwogICAgYm9hcmRbZnJdW2ZjXSA9IHBpZWNlOwogICAgYm9hcmRbdHJdW3RjXSA9IGNhcHR1cmVkOwogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgewogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtwaWVjZS5jb2xvcl0gPSB7IHI6IGZyLCBjOiBmYyB9OwogICAgfQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgewogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSB7IHI6IHRyLCBjOiB0YyB9OwogICAgfQp9OwoKY29uc3Qgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2ggPSBbXTsKY29uc3Qgc29ydE1vdmVTY29yZVNjcmF0Y2ggPSBbXTsKY29uc3Qgc3F1YXJlTWFya1NjcmF0Y2ggPSBuZXcgVWludDhBcnJheShSRUxfU1FVQVJFUyk7CmNvbnN0IHNxdWFyZU1hcmtUb3VjaGVkID0gW107Cgpjb25zdCBtYXJrU29ydFNxdWFyZSA9IChzcSkgPT4gewogICAgaWYgKCFzcXVhcmVNYXJrU2NyYXRjaFtzcV0pIHsKICAgICAgICBzcXVhcmVNYXJrU2NyYXRjaFtzcV0gPSAxOwogICAgICAgIHNxdWFyZU1hcmtUb3VjaGVkLnB1c2goc3EpOwogICAgfQp9OwoKY29uc3QgY2xlYXJTb3J0U3F1YXJlTWFya3MgPSAoKSA9PiB7CiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNxdWFyZU1hcmtUb3VjaGVkLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgc3F1YXJlTWFya1NjcmF0Y2hbc3F1YXJlTWFya1RvdWNoZWRbaV1dID0gMDsKICAgIH0KICAgIHNxdWFyZU1hcmtUb3VjaGVkLmxlbmd0aCA9IDA7Cn07Cgpjb25zdCBzb3J0TW92ZXNGYXN0ID0gKG1vdmVzLCBib2FyZCwgY3VycmVudFBsYXllciwgcGllY2VzSW5mbywgZ2FtZVN0YWdlID0gJ21pZCcsIGJvYXJkSW5mbyA9IG51bGwsIHNlYXJjaEhldXJpc3RpY3MgPSBudWxsKSA9PiB7CiAgICBjb25zdCBjdXJyZW50SXNJbkNoZWNrID0gYm9hcmRJbmZvCiAgICAgICAgPyAoKGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnICYmIGJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8CiAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgJiYgYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKSkKICAgICAgICA6IGlzQ2hlY2soYm9hcmQsIGN1cnJlbnRQbGF5ZXIpOwoKICAgIGlmIChjdXJyZW50SXNJbkNoZWNrICYmIHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7CiAgICAgICAgbGV0IGdlbmVyYWxJbmZvID0gbnVsbDsKICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07CiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlICYmIGluZm8ucGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnICYmIGluZm8ucGllY2UuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXIpIHsKICAgICAgICAgICAgICAgIGdlbmVyYWxJbmZvID0gaW5mbzsKICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIGlmIChnZW5lcmFsSW5mbykgewogICAgICAgICAgICBpZiAoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKSB7CiAgICAgICAgICAgICAgICBsZXQgbSA9IGJvYXJkSW5mby5hdHRhY2tNYXNrW2dlbmVyYWxJbmZvLnIgKiA5ICsgZ2VuZXJhbEluZm8uY10gPj4+IDA7CiAgICAgICAgICAgICAgICB3aGlsZSAobSAhPT0gMCkgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IGJpdCA9IG0gJiAtbTsKICAgICAgICAgICAgICAgICAgICBjb25zdCB0ID0gcGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV07CiAgICAgICAgICAgICAgICAgICAgaWYgKHQgJiYgdC5waWVjZSAmJiB0LnBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtTb3J0U3F1YXJlKHQuciAqIDkgKyB0LmMpOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICBtIF49IGJpdDsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfSBlbHNlIGlmIChnZW5lcmFsSW5mby50aHJlYXRlbmVkQnkpIHsKICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5Lmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdCA9IGdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeVtpXTsKICAgICAgICAgICAgICAgICAgICBpZiAodC5waWVjZSAmJiB0LnBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtTb3J0U3F1YXJlKHQuciAqIDkgKyB0LmMpOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KCiAgICBjb25zdCBoYXNUaHJlYXRlbmVkID0gIWN1cnJlbnRJc0luQ2hlY2sgJiYgISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzICYmIGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLmxlbmd0aCA+IDApOwogICAgaWYgKGhhc1RocmVhdGVuZWQpIHsKICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlc1tpXTsKICAgICAgICAgICAgbWFya1NvcnRTcXVhcmUocC5yICogOSArIHAuYyk7CiAgICAgICAgfQogICAgfQogICAgY29uc3QgdGhyZWF0ZW5lZE1hcmtFbmQgPSBzcXVhcmVNYXJrVG91Y2hlZC5sZW5ndGg7CgogICAgY29uc3QgaGFzQ2FuQ2FwdHVyZSA9ICFjdXJyZW50SXNJbkNoZWNrICYmICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8uY2FuQ2FwdHVyZSAmJiBib2FyZEluZm8uY2FuQ2FwdHVyZS5sZW5ndGggPiAwKTsKICAgIGlmIChoYXNDYW5DYXB0dXJlKSB7CiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2FyZEluZm8uY2FuQ2FwdHVyZS5sZW5ndGg7IGkrKykgewogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRJbmZvLmNhbkNhcHR1cmVbaV07CiAgICAgICAgICAgIG1hcmtTb3J0U3F1YXJlKHAuciAqIDkgKyBwLmMpOwogICAgICAgIH0KICAgIH0KCiAgICBjb25zdCB0dE1vdmUgPSBzZWFyY2hIZXVyaXN0aWNzPy50dE1vdmUgfHwgbnVsbDsKICAgIGNvbnN0IGtpbGxlcnMgPSBzZWFyY2hIZXVyaXN0aWNzPy5raWxsZXJzIHx8IG51bGw7CiAgICBjb25zdCBpc01hcmtlZFRocmVhdGVuZWQgPSAoc3EpID0+IHsKICAgICAgICBpZiAoIWhhc1RocmVhdGVuZWQpIHJldHVybiBmYWxzZTsKICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRocmVhdGVuZWRNYXJrRW5kOyBpKyspIHsKICAgICAgICAgICAgaWYgKHNxdWFyZU1hcmtUb3VjaGVkW2ldID09PSBzcSkgcmV0dXJuIHRydWU7CiAgICAgICAgfQogICAgICAgIHJldHVybiBmYWxzZTsKICAgIH07CgogICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG1vdmVzLmxlbmd0aDsgaW5kZXgrKykgewogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpbmRleF07CiAgICAgICAgY29uc3QgZnJvbVNxID0gbW92ZUZyb21TcShtb3ZlKTsKICAgICAgICBjb25zdCB0b1NxID0gbW92ZVRvU3EobW92ZSk7CiAgICAgICAgY29uc3QgZnJvbVIgPSAoZnJvbVNxIC8gOSkgfCAwLCBmcm9tQyA9IGZyb21TcSAlIDk7CiAgICAgICAgY29uc3QgdG9SID0gKHRvU3EgLyA5KSB8IDAsIHRvQyA9IHRvU3EgJSA5OwogICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbZnJvbVJdW2Zyb21DXTsKICAgICAgICBjb25zdCBwaWVjZVZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKTsKICAgICAgICBjb25zdCB0YXJnZXRQaWVjZSA9IGJvYXJkW3RvUl1bdG9DXTsKICAgICAgICBjb25zdCB0YXJnZXRQaWVjZVZhbHVlID0gdGFyZ2V0UGllY2UgPyBnZXRNYXRlcmlhbFZhbHVlKHRhcmdldFBpZWNlLCBnYW1lU3RhZ2UpIDogMDsKICAgICAgICBsZXQgcHJpb3JpdHkgPSA0OwogICAgICAgIGxldCBzY29yZSA9IDA7CgogICAgICAgIGlmICh0dE1vdmUgJiYgaXNTYW1lTW92ZShtb3ZlLCB0dE1vdmUpKSB7CiAgICAgICAgICAgIHByaW9yaXR5ID0gLTE7CiAgICAgICAgICAgIHNjb3JlID0gMTAwMDAwMDsKICAgICAgICB9IGVsc2UgaWYgKGN1cnJlbnRJc0luQ2hlY2spIHsKICAgICAgICAgICAgY29uc3QgY2FwdHVyZXNDaGVja2VyID0gdGFyZ2V0UGllY2UgJiYgc3F1YXJlTWFya1NjcmF0Y2hbdG9TcV0gIT09IDA7CiAgICAgICAgICAgIGlmIChjYXB0dXJlc0NoZWNrZXIpIHsKICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMDsKICAgICAgICAgICAgICAgIHNjb3JlID0gMTAwMDAgKyB0YXJnZXRQaWVjZVZhbHVlOwogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDI7CiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWUgKiAxNiAtIHBpZWNlVmFsdWU7CiAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDM7CiAgICAgICAgICAgICAgICBzY29yZSA9IHBpZWNlVmFsdWU7CiAgICAgICAgICAgIH0KICAgICAgICB9IGVsc2UgaWYgKGhhc1RocmVhdGVuZWQpIHsKICAgICAgICAgICAgaWYgKGlzTWFya2VkVGhyZWF0ZW5lZChmcm9tU3EpKSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDE7CiAgICAgICAgICAgICAgICBzY29yZSA9IHBpZWNlVmFsdWU7CiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsKICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gaGFzQ2FuQ2FwdHVyZSAmJiBzcXVhcmVNYXJrU2NyYXRjaFt0b1NxXSAhPT0gMCA/IDIgOiAzOwogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOwogICAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIGlmIChoYXNDYW5DYXB0dXJlKSB7CiAgICAgICAgICAgIGlmIChzcXVhcmVNYXJrU2NyYXRjaFt0b1NxXSAhPT0gMCkgewogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOwogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOwogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDM7CiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7CiAgICAgICAgICAgIH0KICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7CiAgICAgICAgICAgIHByaW9yaXR5ID0gMzsKICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlICogMTYgLSBwaWVjZVZhbHVlOwogICAgICAgIH0KCiAgICAgICAgaWYgKHByaW9yaXR5ID49IDApIHsKICAgICAgICAgICAgaWYgKCF0YXJnZXRQaWVjZSAmJiBraWxsZXJzICYmIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc1swXSkpIHsKICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gTWF0aC5taW4ocHJpb3JpdHksIDIpOwogICAgICAgICAgICAgICAgc2NvcmUgKz0gODAwMDsKICAgICAgICAgICAgfSBlbHNlIGlmICghdGFyZ2V0UGllY2UgJiYga2lsbGVycyAmJiBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNbMV0pKSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IE1hdGgubWluKHByaW9yaXR5LCAyKTsKICAgICAgICAgICAgICAgIHNjb3JlICs9IDcwMDA7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgc2NvcmUgKz0gZ2V0SGlzdG9yeVNjb3JlKG1vdmUpOwogICAgICAgIH0KCiAgICAgICAgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaW5kZXhdID0gcHJpb3JpdHk7CiAgICAgICAgc29ydE1vdmVTY29yZVNjcmF0Y2hbaW5kZXhdID0gc2NvcmU7CiAgICAgICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSB7CiAgICAgICAgICAgIG1vdmUucHJpb3JpdHkgPSBwcmlvcml0eTsKICAgICAgICAgICAgbW92ZS5zb3J0U2NvcmUgPSBzY29yZTsKICAgICAgICAgICAgbW92ZS5vcmlnaW5hbEluZGV4ID0gaW5kZXg7CiAgICAgICAgfQogICAgfQoKICAgIGZvciAobGV0IGkgPSAxOyBpIDwgbW92ZXMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbaV07CiAgICAgICAgY29uc3QgcHJpb3JpdHkgPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtpXTsKICAgICAgICBjb25zdCBzY29yZSA9IHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2ldOwogICAgICAgIGxldCBqID0gaSAtIDE7CiAgICAgICAgd2hpbGUgKAogICAgICAgICAgICBqID49IDAgJiYKICAgICAgICAgICAgKHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2pdID4gcHJpb3JpdHkgfHwKICAgICAgICAgICAgIChzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXSA9PT0gcHJpb3JpdHkgJiYgc29ydE1vdmVTY29yZVNjcmF0Y2hbal0gPCBzY29yZSkpCiAgICAgICAgKSB7CiAgICAgICAgICAgIG1vdmVzW2ogKyAxXSA9IG1vdmVzW2pdOwogICAgICAgICAgICBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqICsgMV0gPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXTsKICAgICAgICAgICAgc29ydE1vdmVTY29yZVNjcmF0Y2hbaiArIDFdID0gc29ydE1vdmVTY29yZVNjcmF0Y2hbal07CiAgICAgICAgICAgIGotLTsKICAgICAgICB9CiAgICAgICAgbW92ZXNbaiArIDFdID0gbW92ZTsKICAgICAgICBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqICsgMV0gPSBwcmlvcml0eTsKICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqICsgMV0gPSBzY29yZTsKICAgIH0KCiAgICBjbGVhclNvcnRTcXVhcmVNYXJrcygpOwogICAgcmV0dXJuIG1vdmVzOwp9OwoKLy8g5pCc57Si55So552A5rOV5YeG5aSH77yI6L276YeP77yJ77ya5LiN5bu65YWz57O75Zu+L+WogeiDgS/mnLrliqjmgKcKLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPXRydWXvvJrlj6rnlJ/miJDkvKrlkIjms5XvvIzlkIjms5XmgKflnKjor5XotbDml7bmo4DmtYsKLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPWZhbHNl77ya6aKE6L+H5ruk5ZCI5rOV552A77yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQovLyDngrnmo4vlhbPns7vku43otbDlrozmlbQgZXZhbHVhdGVCb2FyZO+8jOS4jeWPl+W9seWTjQpjb25zdCBwcmVwYXJlU2VhcmNoSW5mbyA9IChib2FyZCwgY3VycmVudFBsYXllcikgPT4gewogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOwogICAgcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnRbY3VycmVudFBsYXllcl0rKzsKCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVja1Jhdyhib2FyZCwgY3VycmVudFBsYXllcik7CiAgICBjb25zdCBwaWVjZXNJbmZvID0gW107CiAgICBjb25zdCBsZWdhbE1vdmVMaXN0ID0gW107CiAgICBjb25zdCBkZWZlciA9IFNFQVJDSF9ERUZFUl9MRUdBTElUWTsKCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgewogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgIGlmICghcGllY2UgfHwgcGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIGNvbnRpbnVlOwoKICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCB7IHIsIGMgfSwgcGllY2UpOwogICAgICAgICAgICBjb25zdCB1c2VNb3ZlcyA9IGRlZmVyID8gbW92ZXMgOiBmaWx0ZXJMZWdhbE1vdmVzKGJvYXJkLCB7IHIsIGMgfSwgcGllY2UsIG1vdmVzKTsKICAgICAgICAgICAgcGllY2VzSW5mby5wdXNoKHsKICAgICAgICAgICAgICAgIHBpZWNlLAogICAgICAgICAgICAgICAgciwKICAgICAgICAgICAgICAgIGMsCiAgICAgICAgICAgICAgICBtb3ZlcywKICAgICAgICAgICAgICAgIGxlZ2FsTW92ZXM6IHVzZU1vdmVzCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHVzZU1vdmVzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBjb25zdCB0byA9IHVzZU1vdmVzW2ldOwogICAgICAgICAgICAgICAgbGVnYWxNb3ZlTGlzdC5wdXNoKGVuY29kZU1vdmVGcm9tQ29vcmRzKHIsIGMsIHRvLnIsIHRvLmMpKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgKz0gbW92ZXMubGVuZ3RoOwogICAgICAgIH0KICAgIH0KCiAgICAvLyDovbvph48gYm9hcmRJbmZv77ya5LuF6KKr5bCG5qCH5b+XCiAgICBjb25zdCBib2FyZEluZm8gPSB7CiAgICAgICAgcmVkSXNJbkNoZWNrOiBjdXJyZW50UGxheWVyID09PSAncmVkJyA/IGluQ2hlY2sgOiBmYWxzZSwKICAgICAgICBibGFja0lzSW5DaGVjazogY3VycmVudFBsYXllciA9PT0gJ2JsYWNrJyA/IGluQ2hlY2sgOiBmYWxzZSwKICAgICAgICBnYW1lU3RhdGU6IG51bGwKICAgIH07CgogICAgaWYgKGxlZ2FsTW92ZUxpc3QubGVuZ3RoID09PSAwKSB7CiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0gaW5DaGVjawogICAgICAgICAgICA/IHsgc3RhdHVzOiAnY2hlY2ttYXRlJywgd2lubmVyOiBvcHBvbmVudCB9CiAgICAgICAgICAgIDogeyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07CiAgICB9IGVsc2UgewogICAgICAgIGJvYXJkSW5mby5nYW1lU3RhdGUgPSB7IHN0YXR1czogJ3BsYXlpbmcnIH07CiAgICB9CgogICAgcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOwogICAgcmV0dXJuIHsgcGllY2VzSW5mbywgYm9hcmRJbmZvLCBsZWdhbE1vdmVMaXN0LCBpbkNoZWNrIH07Cn07CgovLyDorqHnrpfooY3nlJ/lgLzvvJrlqIHog4HlgLzjgIHlronlhajlgLzjgIHmiJjmnK/lgLzjgIHmnLrliqjlgLwKY29uc3QgY2FsY3VsYXRlRGVyaXZlZFZhbHVlcyA9IChib2FyZCwgcGllY2VzSW5mbywgY3VycmVudFBsYXllciA9IG51bGwsIGJvYXJkSW5mbyA9IG51bGwsIGZvclNlYXJjaExlYWYgPSBmYWxzZSkgPT4gewogICAgLy8g6YeN572u5omA5pyJ6KGN55Sf5YC877yM6Zmk5LqG5py65Yqo5YC877yI5bey5Zyo5pS26ZuG5qOL5a2Q5L+h5oGv5pe26K6h566X77yJCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgewogICAgICAgIGluZm8udGhyZWF0VmFsdWUgPSAwOwogICAgICAgIGluZm8uc2FmZXR5VmFsdWUgPSAwOwogICAgICAgIGluZm8udGFjdGljVmFsdWUgPSAwOwogICAgICAgIC8vIOS/neeVmeacuuWKqOWAvO+8jOWboOS4uuW3suWcqOaUtumbhuaji+WtkOS/oeaBr+aXtuiuoeeulwogICAgfQogICAgCiAgICAvLyAxLiDorqHnrpfmo4vlrZDlhbPns7vvvIjlqIHog4HogIXjgIHooqvlqIHog4HogIXjgIHkv53miqTogIXjgIHooqvkv53miqTogIXvvIkKICAgIGlmICghYm9hcmRJbmZvKSB7CiAgICAgICAgYm9hcmRJbmZvID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7CiAgICB9CiAgICBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyhib2FyZCwgcGllY2VzSW5mbywgYm9hcmRJbmZvKTsKICAgIAogICAgLy8gMi4g6K6h566X5aiB6IOB5YC877yI5oyJ6KKr5aiB6IOB5a2Q6IGa5ZCI77yMU0VFIOavj+ebruagh+S4gOasoe+8iQogICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzKHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbyk7CiAgICAKICAgIC8vIDMuIOiuoeeul+WuieWFqOWAvAogICAgY2FsY3VsYXRlU2FmZXR5VmFsdWVzKHBpZWNlc0luZm8sIGJvYXJkSW5mbywgYm9hcmQpOwogICAgCiAgICAvLyA0LiDorqHnrpfmuLjmiI/nirbmgIHlubbkv53lrZjliLBib2FyZEluZm8KICAgIC8vIOaQnOe0ouWPtuiKgueCuei3s+i/h++8muaXoOedgC/lsIbmrbvlt7LlnKjniLboioLngrnlpITnkIbvvIzmraTlpITlj6rpnIDpnZnmgIHliIYKICAgIGlmIChjdXJyZW50UGxheWVyICYmICFmb3JTZWFyY2hMZWFmKSB7CiAgICAgICAgLy8g5qOA5p+l5b2T5YmN546p5a625piv5ZCm5pyJ5ZCI5rOV6LWw5rOVCiAgICAgICAgbGV0IGhhc01vdmVzID0gZmFsc2U7CiAgICAgICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsKICAgICAgICAgICAgaWYgKGluZm8ucGllY2UuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXIpIHsKICAgICAgICAgICAgICAgIC8vIOiOt+WPluW9k+WJjeaji+WtkOeahOacieaViOi1sOazlQogICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHI6IGluZm8uciwgYzogaW5mby5jIH0pOwogICAgICAgICAgICAgICAgaWYgKG1vdmVzLmxlbmd0aCA+IDApIHsKICAgICAgICAgICAgICAgICAgICBoYXNNb3ZlcyA9IHRydWU7CiAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgCiAgICAgICAgLy8g5Yik5pat5ri45oiP54q25oCBCiAgICAgICAgbGV0IGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAncGxheWluZycgfTsKICAgICAgICBpZiAoIWhhc01vdmVzKSB7CiAgICAgICAgICAgIC8vIOayoeacieWQiOazlei1sOazle+8jOajgOafpeaYr+WQpuiiq+WwhuWGmwogICAgICAgICAgICBjb25zdCBpbkNoZWNrID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkSXNJbkNoZWNrIDogYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrOwogICAgICAgICAgICBjb25zdCBvcHBvbmVudCA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgICAgICAKICAgICAgICAgICAgaWYgKGluQ2hlY2spIHsKICAgICAgICAgICAgICAgIGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAnY2hlY2ttYXRlJywgd2lubmVyOiBvcHBvbmVudCB9OwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgCiAgICAgICAgLy8g5L+d5a2Y5ri45oiP54q25oCB5YiwYm9hcmRJbmZvCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IGdhbWVTdGF0ZTsKICAgIH0KfTsKCi8vIOaji+WtkOWHoOS9leaWueWQkeihqO+8iOmihOiuoeeul+iFvy/nnLzlgY/np7vvvIzng63ot6/lvoTpgb/lhY0gTWF0aC5zaWduIC8gZHIvMu+8iQpjb25zdCBPUlRIX0RJUlMgPSBbCiAgICBbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXQpdOwpjb25zdCBESUFHX0RJUlMgPSBbCiAgICBbMSwgMV0sIFsxLCAtMV0sIFstMSwgMV0sIFstMSwgLTFdCl07CmNvbnN0IEVMRVBIQU5UX0RJUlMgPSBbCiAgICB7IGRyOiAyLCBkYzogMiwgZXllRHI6IDEsIGV5ZURjOiAxIH0sCiAgICB7IGRyOiAyLCBkYzogLTIsIGV5ZURyOiAxLCBleWVEYzogLTEgfSwKICAgIHsgZHI6IC0yLCBkYzogMiwgZXllRHI6IC0xLCBleWVEYzogMSB9LAogICAgeyBkcjogLTIsIGRjOiAtMiwgZXllRHI6IC0xLCBleWVEYzogLTEgfQpdOwpjb25zdCBIT1JTRV9ESVJTID0gWwogICAgeyBkcjogMiwgZGM6IDEsIGxlZ0RyOiAxLCBsZWdEYzogMCB9LAogICAgeyBkcjogMiwgZGM6IC0xLCBsZWdEcjogMSwgbGVnRGM6IDAgfSwKICAgIHsgZHI6IC0yLCBkYzogMSwgbGVnRHI6IC0xLCBsZWdEYzogMCB9LAogICAgeyBkcjogLTIsIGRjOiAtMSwgbGVnRHI6IC0xLCBsZWdEYzogMCB9LAogICAgeyBkcjogMSwgZGM6IDIsIGxlZ0RyOiAwLCBsZWdEYzogMSB9LAogICAgeyBkcjogMSwgZGM6IC0yLCBsZWdEcjogMCwgbGVnRGM6IC0xIH0sCiAgICB7IGRyOiAtMSwgZGM6IDIsIGxlZ0RyOiAwLCBsZWdEYzogMSB9LAogICAgeyBkcjogLTEsIGRjOiAtMiwgbGVnRHI6IDAsIGxlZ0RjOiAtMSB9Cl07CgovLyDnn63mraXlrZDpooTooajvvJrkuI7ljp8gc3dpdGNoIOaWueWQkemhuuW6jy/lrqvmsrPov4fmu6TkuIDoh7TvvJvpqazosaHluKYgYnIsYmPvvIjohb8v55y877yJCmNvbnN0IEdFTkVSQUxfREVTVCA9IFtuZXcgQXJyYXkoUkVMX1NRVUFSRVMpLCBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpXTsKY29uc3QgQURWSVNPUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOwpjb25zdCBFTEVQSEFOVF9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOwpjb25zdCBIT1JTRV9ERVNUID0gbmV3IEFycmF5KFJFTF9TUVVBUkVTKTsKY29uc3QgU09MRElFUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOwoKKCgpID0+IHsKICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7CiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsKICAgICAgICAgICAgY29uc3Qgc3EgPSByICogOSArIGM7CiAgICAgICAgICAgIGNvbnN0IGdSZWQgPSBbXSwgZ0JsYWNrID0gW10sIGFSZWQgPSBbXSwgYUJsYWNrID0gW107CiAgICAgICAgICAgIGNvbnN0IGVSZWQgPSBbXSwgZUJsYWNrID0gW10sIGhvcnNlID0gW10sIHNSZWQgPSBbXSwgc0JsYWNrID0gW107CgogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgT1JUSF9ESVJTW2ldWzBdLCBuYyA9IGMgKyBPUlRIX0RJUlNbaV1bMV07CiAgICAgICAgICAgICAgICBpZiAobmMgPCAzIHx8IG5jID4gNSkgY29udGludWU7CiAgICAgICAgICAgICAgICBpZiAobnIgPj0gMCAmJiBuciA8PSAyKSBnUmVkLnB1c2goeyByOiBuciwgYzogbmMgfSk7CiAgICAgICAgICAgICAgICBpZiAobnIgPj0gNyAmJiBuciA8PSA5KSBnQmxhY2sucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgfQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IERJQUdfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgRElBR19ESVJTW2ldWzBdLCBuYyA9IGMgKyBESUFHX0RJUlNbaV1bMV07CiAgICAgICAgICAgICAgICBpZiAobmMgPCAzIHx8IG5jID4gNSkgY29udGludWU7CiAgICAgICAgICAgICAgICBpZiAobnIgPj0gMCAmJiBuciA8PSAyKSBhUmVkLnB1c2goeyByOiBuciwgYzogbmMgfSk7CiAgICAgICAgICAgICAgICBpZiAobnIgPj0gNyAmJiBuciA8PSA5KSBhQmxhY2sucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgfQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IEVMRVBIQU5UX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBFTEVQSEFOVF9ESVJTW2ldOwogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZC5kciwgbmMgPSBjICsgZC5kYzsKICAgICAgICAgICAgICAgIGlmIChuciA8IDAgfHwgbnIgPj0gUk9XUyB8fCBuYyA8IDAgfHwgbmMgPj0gQ09MUykgY29udGludWU7CiAgICAgICAgICAgICAgICBjb25zdCBleWVSID0gciArIGQuZXllRHIsIGV5ZUMgPSBjICsgZC5leWVEYzsKICAgICAgICAgICAgICAgIGlmIChuciA8PSA0KSBlUmVkLnB1c2goeyByOiBuciwgYzogbmMsIGJyOiBleWVSLCBiYzogZXllQyB9KTsKICAgICAgICAgICAgICAgIGlmIChuciA+PSA1KSBlQmxhY2sucHVzaCh7IHI6IG5yLCBjOiBuYywgYnI6IGV5ZVIsIGJjOiBleWVDIH0pOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgSE9SU0VfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgZCA9IEhPUlNFX0RJUlNbaV07CiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBkLmRyLCBuYyA9IGMgKyBkLmRjOwogICAgICAgICAgICAgICAgY29uc3QgbGVnUiA9IHIgKyBkLmxlZ0RyLCBsZWdDID0gYyArIGQubGVnRGM7CiAgICAgICAgICAgICAgICBpZiAobGVnUiA8IDAgfHwgbGVnUiA+PSBST1dTIHx8IGxlZ0MgPCAwIHx8IGxlZ0MgPj0gQ09MUykgY29udGludWU7CiAgICAgICAgICAgICAgICBpZiAobnIgPCAwIHx8IG5yID49IFJPV1MgfHwgbmMgPCAwIHx8IG5jID49IENPTFMpIGNvbnRpbnVlOwogICAgICAgICAgICAgICAgaG9yc2UucHVzaCh7IHI6IG5yLCBjOiBuYywgYnI6IGxlZ1IsIGJjOiBsZWdDIH0pOwogICAgICAgICAgICB9CiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGNvbnN0IGZyID0gciArIDE7CiAgICAgICAgICAgICAgICBpZiAoZnIgPj0gMCAmJiBmciA8IFJPV1MpIHNSZWQucHVzaCh7IHI6IGZyLCBjIH0pOwogICAgICAgICAgICAgICAgaWYgKHIgPj0gNSkgewogICAgICAgICAgICAgICAgICAgIGlmIChjIC0gMSA+PSAwKSBzUmVkLnB1c2goeyByLCBjOiBjIC0gMSB9KTsKICAgICAgICAgICAgICAgICAgICBpZiAoYyArIDEgPCBDT0xTKSBzUmVkLnB1c2goeyByLCBjOiBjICsgMSB9KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIGNvbnN0IGZiciA9IHIgLSAxOwogICAgICAgICAgICAgICAgaWYgKGZiciA+PSAwICYmIGZiciA8IFJPV1MpIHNCbGFjay5wdXNoKHsgcjogZmJyLCBjIH0pOwogICAgICAgICAgICAgICAgaWYgKHIgPD0gNCkgewogICAgICAgICAgICAgICAgICAgIGlmIChjIC0gMSA+PSAwKSBzQmxhY2sucHVzaCh7IHIsIGM6IGMgLSAxIH0pOwogICAgICAgICAgICAgICAgICAgIGlmIChjICsgMSA8IENPTFMpIHNCbGFjay5wdXNoKHsgciwgYzogYyArIDEgfSk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIEdFTkVSQUxfREVTVFswXVtzcV0gPSBnUmVkOwogICAgICAgICAgICBHRU5FUkFMX0RFU1RbMV1bc3FdID0gZ0JsYWNrOwogICAgICAgICAgICBBRFZJU09SX0RFU1RbMF1bc3FdID0gYVJlZDsKICAgICAgICAgICAgQURWSVNPUl9ERVNUWzFdW3NxXSA9IGFCbGFjazsKICAgICAgICAgICAgRUxFUEhBTlRfREVTVFswXVtzcV0gPSBlUmVkOwogICAgICAgICAgICBFTEVQSEFOVF9ERVNUWzFdW3NxXSA9IGVCbGFjazsKICAgICAgICAgICAgSE9SU0VfREVTVFtzcV0gPSBob3JzZTsKICAgICAgICAgICAgU09MRElFUl9ERVNUWzBdW3NxXSA9IHNSZWQ7CiAgICAgICAgICAgIFNPTERJRVJfREVTVFsxXVtzcV0gPSBzQmxhY2s7CiAgICAgICAgfQogICAgfQp9KSgpOwoKLy8g5qih5Z2X57qn6JC954K55aSE55CG77yI6Z2e5q+P5a2Q5paw5bu66Zet5YyF77yJ77yb6L+U5Zue5py65Yqo5aKe6YePCi8vIHBpZWNlQXRTcTogOTAg5qC8IOKGkiBwaWVjZXNJbmZv77ybcmVsQ3R4LnVzZU1hc2tzIOaXtuWGmSBtYXNrCmNvbnN0IGFwcGx5UmVsYXRpb25TcXVhcmUgPSAoYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgdHIsIHRjLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yKSA9PiB7CiAgICBpZiAodHIgPCAwIHx8IHRyID49IFJPV1MgfHwgdGMgPCAwIHx8IHRjID49IENPTFMpIHJldHVybiAwOwogICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbdHJdW3RjXTsKICAgIGlmICghdGFyZ2V0KSB7CiAgICAgICAgaWYgKHVzZU1hc2tzKSB7CiAgICAgICAgICAgIGNvbnN0IHNxID0gdHIgKiA5ICsgdGM7CiAgICAgICAgICAgIGlmICghcmVsQ3R4LnNraXBDb250cm9sTWFzaykgcmVsQ3R4LmNvbnRyb2xNYXNrW3NxXSB8PSBiaXQ7CiAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHJlbEN0eC5yZWRBdHRhY2ssIHNxKTsKICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOwogICAgICAgICAgICBpbmZvLmNvbnRyb2wucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuIEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eS5iYXNlTW92ZVZhbHVlOwogICAgfQogICAgaWYgKHRhcmdldC5jb2xvciAhPT0gcGllY2VDb2xvcikgewogICAgICAgIGlmICh1c2VNYXNrcykgewogICAgICAgICAgICBpZiAocGllY2VBdFNxW3RyICogOSArIHRjXSkgewogICAgICAgICAgICAgICAgcmVsQ3R4LmF0dGFja01hc2tbdHIgKiA5ICsgdGNdIHw9IGJpdDsKICAgICAgICAgICAgfQogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsKICAgICAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBpZWNlQXRTcVt0ciAqIDkgKyB0Y107CiAgICAgICAgICAgIGlmICh0YXJnZXRJbmZvKSB7CiAgICAgICAgICAgICAgICBpbmZvLnRocmVhdC5wdXNoKHRhcmdldEluZm8pOwogICAgICAgICAgICAgICAgdGFyZ2V0SW5mby50aHJlYXRlbmVkQnkucHVzaChpbmZvKTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICByZXR1cm4gMDsKICAgIH0KICAgIGlmICh0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBpZWNlQXRTcVt0ciAqIDkgKyB0Y107CiAgICAgICAgaWYgKHRhcmdldEluZm8gJiYgdGFyZ2V0SW5mbyAhPT0gaW5mbykgewogICAgICAgICAgICBpZiAodXNlTWFza3MpIHsKICAgICAgICAgICAgICAgIHJlbEN0eC5ndWFyZE1hc2tbdHIgKiA5ICsgdGNdIHw9IGJpdDsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsKICAgICAgICAgICAgICAgIHRhcmdldEluZm8uZ3VhcmRlZEJ5LnB1c2goaW5mbyk7CiAgICAgICAgICAgICAgICBpbmZvLmFsbHlHdWFyZHMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KICAgIHJldHVybiAwOwp9OwoKLy8g6Z2e54Ku77ya5LiA5qyh5Yeg5L2V5omr5o+P77yb55+t5q2l5a2Q6LWw6aKE6KGo77yM6L2m5LuN5bCE57q/77yb6K+t5LmJ5LiOIGdldFBpZWNlTW92ZXMg5LiA6Ie0CmNvbnN0IGZpbGxOb25DYW5ub25SZWxhdGlvbnMgPSAoYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgcmVsQ3R4ID0gbnVsbCkgPT4gewogICAgY29uc3QgcGllY2UgPSBpbmZvLnBpZWNlOwogICAgY29uc3QgeyByLCBjIH0gPSBpbmZvOwogICAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7CiAgICBjb25zdCBwaWVjZUNvbG9yID0gcGllY2UuY29sb3I7CiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKHJlbEN0eCAmJiByZWxDdHgudXNlTWFza3MpOwogICAgY29uc3Qgc2tpcENvbnRyb2wgPSB1c2VNYXNrcyAmJiByZWxDdHguc2tpcENvbnRyb2xNYXNrOwogICAgY29uc3QgYml0ID0gdXNlTWFza3MgPyAoMSA8PCByZWxDdHgucGllY2VJbmRleCkgOiAwOwogICAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOwogICAgY29uc3QgZnJvbVNxID0gciAqIDkgKyBjOwogICAgaWYgKCF1c2VNYXNrcykgewogICAgICAgIGluZm8ubW92ZXMgPSBbXTsKICAgICAgICBpbmZvLmNvbnRyb2wgPSBbXTsKICAgICAgICBpbmZvLmFsbHlHdWFyZHMgPSBbXTsKICAgIH0KICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsKCiAgICBzd2l0Y2ggKHBpZWNlLnR5cGUpIHsKICAgICAgICBjYXNlICdnZW5lcmFsJzogewogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEdFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOwogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVJlbGF0aW9uU3F1YXJlKAogICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yCiAgICAgICAgICAgICAgICApOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICBjYXNlICdhZHZpc29yJzogewogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEFEVklTT1JfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOwogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVJlbGF0aW9uU3F1YXJlKAogICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yCiAgICAgICAgICAgICAgICApOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICBjYXNlICdlbGVwaGFudCc6IHsKICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBFTEVQSEFOVF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOwogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07CiAgICAgICAgICAgICAgICBpZiAoYm9hcmRbZC5icl1bZC5iY10gPT09IG51bGwpIHsKICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yCiAgICAgICAgICAgICAgICAgICAgKTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgY2FzZSAnaG9yc2UnOiB7CiAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gSE9SU0VfREVTVFtmcm9tU3FdOwogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07CiAgICAgICAgICAgICAgICBpZiAoYm9hcmRbZC5icl1bZC5iY10gPT09IG51bGwpIHsKICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yCiAgICAgICAgICAgICAgICAgICAgKTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgY2FzZSAnY2hhcmlvdCc6CiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07CiAgICAgICAgICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOwogICAgICAgICAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbbnJdW25jXTsKICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0ID09PSBudWxsKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBuciAqIDkgKyBuYzsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghc2tpcENvbnRyb2wpIHJlbEN0eC5jb250cm9sTWFza1tzcV0gfD0gYml0OwogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSBzZXRBdHRhY2tCaXQocmVsQ3R4LnJlZEF0dGFjaywgc3EpOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLmNvbnRyb2wucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eS5iYXNlTW92ZVZhbHVlOwogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZUF0U3FbbnIgKiA5ICsgbmNdKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5hdHRhY2tNYXNrW25yICogOSArIG5jXSB8PSBiaXQ7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBpZWNlQXRTcVtuciAqIDkgKyBuY107CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldEluZm8pIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby50aHJlYXRlbmVkQnkucHVzaChpbmZvKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBpZWNlQXRTcVtuciAqIDkgKyBuY107CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5ndWFyZE1hc2tbbnIgKiA5ICsgbmNdIHw9IGJpdDsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLmd1YXJkLnB1c2godGFyZ2V0SW5mbyk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8uZ3VhcmRlZEJ5LnB1c2goaW5mbyk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uYWxseUd1YXJkcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgbnIgKz0gZHI7CiAgICAgICAgICAgICAgICAgICAgbmMgKz0gZGM7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgY2FzZSAnc29sZGllcic6IHsKICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBTT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07CiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsKICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgKICAgICAgICAgICAgICAgICAgICBib2FyZCwgaW5mbywgcGllY2VBdFNxLCBkLnIsIGQuYywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcgogICAgICAgICAgICAgICAgKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgZGVmYXVsdDoKICAgICAgICAgICAgYnJlYWs7CiAgICB9CiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOwp9OwoKLy8g54Ku77ya5LiA5qyh5Zub5ZCR5bCE57q/77ybbWFzayDmqKHlvI/lhpkgYXR0YWNrL2d1YXJkL2NvbnRyb2zvvIzliJfooajmqKHlvI/kv53mjIHml6for63kuYkKY29uc3QgZmlsbENhbm5vblJlbGF0aW9ucyA9IChib2FyZCwgaW5mbywgcGllY2VBdFNxLCByZWxDdHggPSBudWxsKSA9PiB7CiAgICBjb25zdCBwaWVjZSA9IGluZm8ucGllY2U7CiAgICBjb25zdCB7IHIsIGMgfSA9IGluZm87CiAgICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsKICAgIGNvbnN0IHBpZWNlQ29sb3IgPSBwaWVjZS5jb2xvcjsKICAgIGNvbnN0IHsgYmFzZU1vdmVWYWx1ZSB9ID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5OwogICAgY29uc3QgdXNlTWFza3MgPSAhIShyZWxDdHggJiYgcmVsQ3R4LnVzZU1hc2tzKTsKICAgIGNvbnN0IHNraXBDb250cm9sID0gdXNlTWFza3MgJiYgcmVsQ3R4LnNraXBDb250cm9sTWFzazsKICAgIGNvbnN0IGJpdCA9IHVzZU1hc2tzID8gKDEgPDwgcmVsQ3R4LnBpZWNlSW5kZXgpIDogMDsKICAgIGlmICghdXNlTWFza3MpIHsKICAgICAgICBpbmZvLm1vdmVzID0gW107CiAgICAgICAgaW5mby5jb250cm9sID0gW107CiAgICB9CiAgICBsZXQgbW9iaWxpdHlWYWx1ZSA9IDA7CgogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07CiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsKICAgICAgICBsZXQgc2NyZWVuRm91bmRDb3VudCA9IDA7CiAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTICYmIHNjcmVlbkZvdW5kQ291bnQgPCAyKSB7CiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOwogICAgICAgICAgICBpZiAocCAhPT0gbnVsbCkgewogICAgICAgICAgICAgICAgc2NyZWVuRm91bmRDb3VudCsrOwogICAgICAgICAgICAgICAgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDIpIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW25yICogOSArIG5jXTsKICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yICE9PSBwaWVjZUNvbG9yKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWxDdHguYXR0YWNrTWFza1tuciAqIDkgKyBuY10gfD0gYml0OwogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLnRocmVhdC5wdXNoKHRhcmdldEluZm8pOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHAudHlwZSAhPT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWxDdHguZ3VhcmRNYXNrW25yICogOSArIG5jXSB8PSBiaXQ7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLmd1YXJkZWRCeS5wdXNoKGluZm8pOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwLmNvbG9yICE9PSBwaWVjZUNvbG9yKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdXNlTWFza3MpIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMCkgewogICAgICAgICAgICAgICAgaWYgKCF1c2VNYXNrcykgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOwogICAgICAgICAgICB9IGVsc2UgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDEpIHsKICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gbnIgKiA5ICsgbmM7CiAgICAgICAgICAgICAgICAgICAgaWYgKCFza2lwQ29udHJvbCkgcmVsQ3R4LmNvbnRyb2xNYXNrW3NxXSB8PSBiaXQ7CiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSBzZXRBdHRhY2tCaXQocmVsQ3R4LnJlZEF0dGFjaywgc3EpOwogICAgICAgICAgICAgICAgICAgIGVsc2Ugc2V0QXR0YWNrQml0KHJlbEN0eC5ibGFja0F0dGFjaywgc3EpOwogICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICBpbmZvLmNvbnRyb2wucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICBuciArPSBkcjsKICAgICAgICAgICAgbmMgKz0gZGM7CiAgICAgICAgfQogICAgfQogICAgaW5mby5tb2JpbGl0eVZhbHVlID0gbW9iaWxpdHlWYWx1ZTsKfTsKCi8vIOS7juagvOS9jSBtYXNrIOi/mOWOnyB0aHJlYXQvZ3VhcmQvY29udHJvbCDliJfooajvvIjngrnmo4svVUnvvIkKY29uc3QgaHlkcmF0ZVJlbGF0aW9uc0Zyb21NYXNrcyA9IChwaWVjZXNJbmZvLCBib2FyZEluZm8pID0+IHsKICAgIGNvbnN0IGF0dGFja01hc2sgPSBib2FyZEluZm8uYXR0YWNrTWFzazsKICAgIGNvbnN0IGd1YXJkTWFzayA9IGJvYXJkSW5mby5ndWFyZE1hc2s7CiAgICBjb25zdCBjb250cm9sTWFzayA9IGJvYXJkSW5mby5jb250cm9sTWFzazsKICAgIGNvbnN0IG4gPSBwaWVjZXNJbmZvLmxlbmd0aDsKICAgIGNvbnN0IGJ5U3EgPSBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHsKICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1tpXTsKICAgICAgICBpbmZvLnRocmVhdCA9IFtdOwogICAgICAgIGluZm8udGhyZWF0ZW5lZEJ5ID0gW107CiAgICAgICAgaW5mby5ndWFyZCA9IFtdOwogICAgICAgIGluZm8uZ3VhcmRlZEJ5ID0gW107CiAgICAgICAgaW5mby5jb250cm9sID0gW107CiAgICAgICAgYnlTcVtpbmZvLnIgKiA5ICsgaW5mby5jXSA9IGluZm87CiAgICB9CgogICAgZm9yIChsZXQgc3EgPSAwOyBzcSA8IFJFTF9TUVVBUkVTOyBzcSsrKSB7CiAgICAgICAgY29uc3QgciA9IChzcSAvIDkpIHwgMDsKICAgICAgICBjb25zdCBjID0gc3EgJSA5OwogICAgICAgIGNvbnN0IHRhcmdldCA9IGJ5U3Fbc3FdOwoKICAgICAgICBsZXQgY20gPSBjb250cm9sTWFza1tzcV0gPj4+IDA7CiAgICAgICAgd2hpbGUgKGNtICE9PSAwKSB7CiAgICAgICAgICAgIGNvbnN0IGJpdCA9IGNtICYgLWNtOwogICAgICAgICAgICBjb25zdCBpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7CiAgICAgICAgICAgIHBpZWNlc0luZm9baV0uY29udHJvbC5wdXNoKHsgciwgYyB9KTsKICAgICAgICAgICAgY20gXj0gYml0OwogICAgICAgIH0KCiAgICAgICAgbGV0IGFtID0gYXR0YWNrTWFza1tzcV0gPj4+IDA7CiAgICAgICAgd2hpbGUgKGFtICE9PSAwKSB7CiAgICAgICAgICAgIGNvbnN0IGJpdCA9IGFtICYgLWFtOwogICAgICAgICAgICBjb25zdCBpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7CiAgICAgICAgICAgIGNvbnN0IGF0dGFja2VyID0gcGllY2VzSW5mb1tpXTsKICAgICAgICAgICAgaWYgKHRhcmdldCAmJiB0YXJnZXQgIT09IGF0dGFja2VyICYmIHRhcmdldC5waWVjZS5jb2xvciAhPT0gYXR0YWNrZXIucGllY2UuY29sb3IpIHsKICAgICAgICAgICAgICAgIGF0dGFja2VyLnRocmVhdC5wdXNoKHRhcmdldCk7CiAgICAgICAgICAgICAgICB0YXJnZXQudGhyZWF0ZW5lZEJ5LnB1c2goYXR0YWNrZXIpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGFtIF49IGJpdDsKICAgICAgICB9CgogICAgICAgIGxldCBnbSA9IGd1YXJkTWFza1tzcV0gPj4+IDA7CiAgICAgICAgd2hpbGUgKGdtICE9PSAwKSB7CiAgICAgICAgICAgIGNvbnN0IGJpdCA9IGdtICYgLWdtOwogICAgICAgICAgICBjb25zdCBpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7CiAgICAgICAgICAgIGNvbnN0IGd1YXJkZXIgPSBwaWVjZXNJbmZvW2ldOwogICAgICAgICAgICBpZiAodGFyZ2V0ICYmIHRhcmdldCAhPT0gZ3VhcmRlciAmJiB0YXJnZXQucGllY2UuY29sb3IgPT09IGd1YXJkZXIucGllY2UuY29sb3IpIHsKICAgICAgICAgICAgICAgIGd1YXJkZXIuZ3VhcmQucHVzaCh0YXJnZXQpOwogICAgICAgICAgICAgICAgdGFyZ2V0Lmd1YXJkZWRCeS5wdXNoKGd1YXJkZXIpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGdtIF49IGJpdDsKICAgICAgICB9CiAgICB9CgogICAgLy8g5L6bIGlzUG9zaXRpb25BY2NlcHRhYmxlIC8g54K55qOLIGNvbnRyb2xsZXJz77ya5LiO5pen6K+t5LmJ5LiA6Ie077yM5LuF56m65o6n5qC8CiAgICBjb25zdCBncmlkID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsKICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgewogICAgICAgIGxldCBjbSA9IGNvbnRyb2xNYXNrW3NxXSA+Pj4gMDsKICAgICAgICBpZiAoY20gPT09IDApIGNvbnRpbnVlOwogICAgICAgIGNvbnN0IHIgPSAoc3EgLyA5KSB8IDA7CiAgICAgICAgY29uc3QgYyA9IHNxICUgOTsKICAgICAgICB3aGlsZSAoY20gIT09IDApIHsKICAgICAgICAgICAgY29uc3QgYml0ID0gY20gJiAtY207CiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsKICAgICAgICAgICAgZ3JpZFtyXVtjXS5wdXNoKHBpZWNlc0luZm9baV0pOwogICAgICAgICAgICBjbSBePSBiaXQ7CiAgICAgICAgfQogICAgfQogICAgYm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkID0gZ3JpZDsKfTsKCi8vIOiuoeeul+aji+WtkOWFs+ezu++8mm1hc2sg6Lev5b6E5YaZIFVpbnQzMiDmoLzkvY3ooajvvJvliJfooajot6/lvoTkv53mjIHml6cgcHVzaApjb25zdCBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyA9IChib2FyZCwgcGllY2VzSW5mbywgYm9hcmRJbmZvKSA9PiB7CiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcyk7CiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VBdHRhY2tCaXRzKSAmJiAhdXNlTWFza3M7CgogICAgaWYgKCF1c2VNYXNrcykgewogICAgICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7CiAgICAgICAgICAgIGluZm8udGhyZWF0ID0gW107CiAgICAgICAgICAgIGluZm8udGhyZWF0ZW5lZEJ5ID0gW107CiAgICAgICAgICAgIGluZm8uZ3VhcmQgPSBbXTsKICAgICAgICAgICAgaW5mby5ndWFyZGVkQnkgPSBbXTsKICAgICAgICAgICAgaW5mby5jb250cm9sID0gW107CiAgICAgICAgfQogICAgfQoKICAgIGlmICghYm9hcmRJbmZvKSB7CiAgICAgICAgYm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsKICAgIH0KCiAgICBjbGVhclBpZWNlQXRTcSgpOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07CiAgICAgICAgaWYgKGluZm8ucGllY2VJbmRleCA9PSBudWxsKSBpbmZvLnBpZWNlSW5kZXggPSBpOwogICAgICAgIHNjcmF0Y2hQaWVjZUF0U3FbaW5mby5yICogOSArIGluZm8uY10gPSBpbmZvOwogICAgfQoKICAgIGxldCByZWxDdHggPSBudWxsOwogICAgaWYgKHVzZU1hc2tzKSB7CiAgICAgICAgcmVsQ3R4ID0gc2NyYXRjaFJlbEN0eDsKICAgICAgICByZWxDdHgudXNlTWFza3MgPSB0cnVlOwogICAgICAgIHJlbEN0eC5za2lwQ29udHJvbE1hc2sgPSAhIWJvYXJkSW5mby5za2lwQ29udHJvbE1hc2s7CiAgICAgICAgcmVsQ3R4LmF0dGFja01hc2sgPSBib2FyZEluZm8uYXR0YWNrTWFzazsKICAgICAgICByZWxDdHguZ3VhcmRNYXNrID0gYm9hcmRJbmZvLmd1YXJkTWFzazsKICAgICAgICByZWxDdHguY29udHJvbE1hc2sgPSBib2FyZEluZm8uY29udHJvbE1hc2s7CiAgICAgICAgcmVsQ3R4LnJlZEF0dGFjayA9IGJvYXJkSW5mby5yZWRBdHRhY2s7CiAgICAgICAgcmVsQ3R4LmJsYWNrQXR0YWNrID0gYm9hcmRJbmZvLmJsYWNrQXR0YWNrOwogICAgfQoKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGllY2VzSW5mby5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOwogICAgICAgIGlmIChyZWxDdHgpIHJlbEN0eC5waWVjZUluZGV4ID0gaW5mby5waWVjZUluZGV4OwoKICAgICAgICBpZiAoaW5mby5waWVjZS50eXBlID09PSAnY2Fubm9uJykgewogICAgICAgICAgICBmaWxsQ2Fubm9uUmVsYXRpb25zKGJvYXJkLCBpbmZvLCBzY3JhdGNoUGllY2VBdFNxLCByZWxDdHgpOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGZpbGxOb25DYW5ub25SZWxhdGlvbnMoYm9hcmQsIGluZm8sIHNjcmF0Y2hQaWVjZUF0U3EsIHJlbEN0eCk7CiAgICAgICAgfQoKICAgICAgICBpZiAoIXVzZU1hc2tzKSB7CiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2wgPSBpbmZvLmNvbnRyb2w7CiAgICAgICAgICAgIGlmICh1c2VBdHRhY2tCaXRzKSB7CiAgICAgICAgICAgICAgICBjb25zdCBiaXRzID0gaW5mby5waWVjZS5jb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkQXR0YWNrIDogYm9hcmRJbmZvLmJsYWNrQXR0YWNrOwogICAgICAgICAgICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBjb250cm9sLmxlbmd0aDsgaysrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zID0gY29udHJvbFtrXTsKICAgICAgICAgICAgICAgICAgICBzZXRBdHRhY2tCaXQoYml0cywgcG9zLnIgKiA5ICsgcG9zLmMpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoYm9hcmRJbmZvWzBdKSkgewogICAgICAgICAgICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBjb250cm9sLmxlbmd0aDsgaysrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zID0gY29udHJvbFtrXTsKICAgICAgICAgICAgICAgICAgICBib2FyZEluZm9bcG9zLnJdW3Bvcy5jXS5wdXNoKGluZm8pOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIGxldCByZWRJc0luQ2hlY2sgPSBmYWxzZTsKICAgIGxldCBibGFja0lzSW5DaGVjayA9IGZhbHNlOwogICAgbGV0IHJlZEdlbmVyYWxJbmZvID0gbnVsbDsKICAgIGxldCBibGFja0dlbmVyYWxJbmZvID0gbnVsbDsKICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7CiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJykgcmVkR2VuZXJhbEluZm8gPSBpbmZvOwogICAgICAgICAgICBlbHNlIGJsYWNrR2VuZXJhbEluZm8gPSBpbmZvOwogICAgICAgIH0KICAgIH0KCiAgICBpZiAodXNlTWFza3MpIHsKICAgICAgICBpZiAocmVkR2VuZXJhbEluZm8gJiYgYm9hcmRJbmZvLmF0dGFja01hc2tbcmVkR2VuZXJhbEluZm8uciAqIDkgKyByZWRHZW5lcmFsSW5mby5jXSAhPT0gMCkgewogICAgICAgICAgICByZWRJc0luQ2hlY2sgPSB0cnVlOwogICAgICAgIH0KICAgICAgICBpZiAoYmxhY2tHZW5lcmFsSW5mbyAmJiBib2FyZEluZm8uYXR0YWNrTWFza1tibGFja0dlbmVyYWxJbmZvLnIgKiA5ICsgYmxhY2tHZW5lcmFsSW5mby5jXSAhPT0gMCkgewogICAgICAgICAgICBibGFja0lzSW5DaGVjayA9IHRydWU7CiAgICAgICAgfQogICAgfSBlbHNlIHsKICAgICAgICBpZiAocmVkR2VuZXJhbEluZm8pIHsKICAgICAgICAgICAgZm9yIChjb25zdCB0aHJlYXRlbmVyIG9mIHJlZEdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgewogICAgICAgICAgICAgICAgaWYgKHRocmVhdGVuZXIucGllY2UuY29sb3IgPT09ICdibGFjaycpIHsKICAgICAgICAgICAgICAgICAgICByZWRJc0luQ2hlY2sgPSB0cnVlOwogICAgICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIGlmIChibGFja0dlbmVyYWxJbmZvKSB7CiAgICAgICAgICAgIGZvciAoY29uc3QgdGhyZWF0ZW5lciBvZiBibGFja0dlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgewogICAgICAgICAgICAgICAgaWYgKHRocmVhdGVuZXIucGllY2UuY29sb3IgPT09ICdyZWQnKSB7CiAgICAgICAgICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOwogICAgICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIGlmIChyZWRHZW5lcmFsSW5mbyAmJiBibGFja0dlbmVyYWxJbmZvICYmIHJlZEdlbmVyYWxJbmZvLmMgPT09IGJsYWNrR2VuZXJhbEluZm8uYykgewogICAgICAgIGxldCBoYXNQaWVjZUJldHdlZW4gPSBmYWxzZTsKICAgICAgICBjb25zdCBzdGFydFIgPSBNYXRoLm1pbihyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpICsgMTsKICAgICAgICBjb25zdCBlbmRSID0gTWF0aC5tYXgocmVkR2VuZXJhbEluZm8uciwgYmxhY2tHZW5lcmFsSW5mby5yKSAtIDE7CiAgICAgICAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsKICAgICAgICAgICAgaWYgKGJvYXJkW3JdW3JlZEdlbmVyYWxJbmZvLmNdKSB7CiAgICAgICAgICAgICAgICBoYXNQaWVjZUJldHdlZW4gPSB0cnVlOwogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgaWYgKCFoYXNQaWVjZUJldHdlZW4pIHsKICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsKICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOwogICAgICAgIH0KICAgIH0KCiAgICBib2FyZEluZm8ucmVkSXNJbkNoZWNrID0gcmVkSXNJbkNoZWNrOwogICAgYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrID0gYmxhY2tJc0luQ2hlY2s7Cn07Cgpjb25zdCBpc1Bvc2l0aW9uQWNjZXB0YWJsZSA9IChib2FyZCwgZnJvbSwgdG8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbyA9IG51bGwsIHBpZWNlc0luZm8gPSBudWxsLCB0cnlNb3ZlUGllY2UgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJykgPT4gewogICAgY29uc3QgbW92aW5nUGllY2UgPSB0cnlNb3ZlUGllY2UgfHwgYm9hcmRbZnJvbS5yXVtmcm9tLmNdOwogICAgY29uc3QgdGFyZ2V0UGllY2UgPSBib2FyZFt0by5yXVt0by5jXTsKICAgIGNvbnN0IGlzQ2FwdHVyZSA9IHRhcmdldFBpZWNlICYmIHRhcmdldFBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyOwoKICAgIC8vIOaUtumbhuaJgOacieaji+WtkOS/oeaBr++8jOWPquWcqOayoeacieaPkOS+m+aXtuiuoeeulwogICAgbGV0IGxvY2FsUGllY2VzSW5mbyA9IHBpZWNlc0luZm87CiAgICBpZiAoIWxvY2FsUGllY2VzSW5mbykgewogICAgICAgIGxvY2FsUGllY2VzSW5mbyA9IFtdOwogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7CiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgYWxseUd1YXJkcyA9IFtdOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlLCBhbGx5R3VhcmRzKTsKICAgICAgICAgICAgICAgICAgICBsb2NhbFBpZWNlc0luZm8ucHVzaCh7CiAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlLAogICAgICAgICAgICAgICAgICAgICAgICByLCBjLCBtb3ZlcywgYWxseUd1YXJkcywKICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWxWYWx1ZTogZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKSwKICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiBbXSwKICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwKICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLAogICAgICAgICAgICAgICAgICAgICAgICBndWFyZGVkQnk6IFtdLAogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlOiAwLAogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRWYWx1ZTogMCwKICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpY1ZhbHVlOiAwCiAgICAgICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CgogICAgLy8g6K6h566X5qOL5a2Q5YWz57O75ZKM5o6n5Yi25L+h5oGv77yM5Y+q5Zyo5rKh5pyJ5o+Q5L6b5pe26K6h566XCiAgICBsZXQgbG9jYWxCb2FyZEluZm8gPSBib2FyZEluZm87CiAgICBpZiAoIWxvY2FsQm9hcmRJbmZvKSB7CiAgICAgICAgaWYgKFNFQVJDSF9SRUxBVElPTl9NQVNLUyAmJiBsb2NhbFBpZWNlc0luZm8ubGVuZ3RoIDw9IDMyKSB7CiAgICAgICAgICAgIGNsZWFyUmVsYXRpb25NYXNrcygpOwogICAgICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaFJlZEF0dGFjayk7CiAgICAgICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOwogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxvY2FsUGllY2VzSW5mby5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgbG9jYWxQaWVjZXNJbmZvW2ldLnBpZWNlSW5kZXggPSBpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGxvY2FsQm9hcmRJbmZvID0gewogICAgICAgICAgICAgICAgdXNlUmVsYXRpb25NYXNrczogdHJ1ZSwKICAgICAgICAgICAgICAgIHVzZUF0dGFja0JpdHM6IHRydWUsCiAgICAgICAgICAgICAgICBhdHRhY2tNYXNrOiBzY3JhdGNoQXR0YWNrTWFzaywKICAgICAgICAgICAgICAgIGd1YXJkTWFzazogc2NyYXRjaEd1YXJkTWFzaywKICAgICAgICAgICAgICAgIGNvbnRyb2xNYXNrOiBzY3JhdGNoQ29udHJvbE1hc2ssCiAgICAgICAgICAgICAgICByZWRBdHRhY2s6IHNjcmF0Y2hSZWRBdHRhY2ssCiAgICAgICAgICAgICAgICBibGFja0F0dGFjazogc2NyYXRjaEJsYWNrQXR0YWNrCiAgICAgICAgICAgIH07CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgbG9jYWxCb2FyZEluZm8gPSBtYWtlRW1wdHlDb250cm9sbGVyR3JpZCgpOwogICAgICAgIH0KICAgICAgICBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyhib2FyZCwgbG9jYWxQaWVjZXNJbmZvLCBsb2NhbEJvYXJkSW5mbyk7CiAgICB9CgogICAgLy8g5o6n5Yi26ICF77yabWFzayDnlKggY29udHJvbE1hc2vvvJvml6fot6/lvoTnlKggYm9hcmRJbmZvW3JdW2Nd77ybaHlkcmF0ZSDlkI7lj6/nlKggY29udHJvbGxlckdyaWQKICAgIGxldCBjb250cm9sbGVyczsKICAgIGlmIChsb2NhbEJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKSB7CiAgICAgICAgY29udHJvbGxlcnMgPSBbXTsKICAgICAgICBmb3JFYWNoU2V0Qml0KGxvY2FsQm9hcmRJbmZvLmNvbnRyb2xNYXNrW3RvLnIgKiA5ICsgdG8uY10sIChpKSA9PiB7CiAgICAgICAgICAgIGNvbnRyb2xsZXJzLnB1c2gobG9jYWxQaWVjZXNJbmZvW2ldKTsKICAgICAgICB9KTsKICAgIH0gZWxzZSBpZiAobG9jYWxCb2FyZEluZm8uY29udHJvbGxlckdyaWQpIHsKICAgICAgICBjb250cm9sbGVycyA9IGxvY2FsQm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkW3RvLnJdW3RvLmNdIHx8IFtdOwogICAgfSBlbHNlIHsKICAgICAgICBjb250cm9sbGVycyA9IGxvY2FsQm9hcmRJbmZvW3RvLnJdW3RvLmNdIHx8IFtdOwogICAgfQogICAgbGV0IGhhc0FsbHlDb250cm9sbGVyID0gZmFsc2U7CiAgICBsZXQgaGFzRW5lbXlDb250cm9sbGVyID0gZmFsc2U7CgogICAgLy8g5o6n5Yi26ICF5Y+v6IO95pivIHBpZWNlc0luZm8g5byV55SoIHtwaWVjZSxyLGN9IOaIluaXp+e7k+aehCB7Y29sb3IsdHlwZSxyLGN9CiAgICBjb25zdCBjb250cm9sbGVyQ29sb3IgPSAoY29udHJvbGxlcikgPT4KICAgICAgICBjb250cm9sbGVyLnBpZWNlID8gY29udHJvbGxlci5waWVjZS5jb2xvciA6IGNvbnRyb2xsZXIuY29sb3I7CgogICAgZm9yIChjb25zdCBjb250cm9sbGVyIG9mIGNvbnRyb2xsZXJzKSB7CiAgICAgICAgLy8g5o6S6Zmk5q2j5Zyo56e75Yqo55qE5qOL5a2Q5pys6Lqr77yI6LWw5ZCO5a6D5LiN5YaN5LuO5Y6f5L2N5o6n5Yi255uu5qCH77yJCiAgICAgICAgaWYgKG1vdmluZ1BpZWNlICYmIGNvbnRyb2xsZXIuciA9PT0gZnJvbS5yICYmIGNvbnRyb2xsZXIuYyA9PT0gZnJvbS5jKSB7CiAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH0KICAgICAgICBpZiAoY29udHJvbGxlckNvbG9yKGNvbnRyb2xsZXIpID09PSBjdXJyZW50UGxheWVyKSB7CiAgICAgICAgICAgIGhhc0FsbHlDb250cm9sbGVyID0gdHJ1ZTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgICBoYXNFbmVteUNvbnRyb2xsZXIgPSB0cnVlOwogICAgICAgIH0KICAgIH0KCiAgICBpZiAoaXNDYXB0dXJlKSB7CiAgICAgICAgLy8g55m95ZCD77ya55uu5qCH5pyq6KKr5pWM5pa55L+d5oqkCiAgICAgICAgaWYgKCFoYXNFbmVteUNvbnRyb2xsZXIpIHsKICAgICAgICAgICAgcmV0dXJuIHRydWU7CiAgICAgICAgfQogICAgICAgIC8vIOeugOWNlSBTRUXvvJrlhYjlvpfnm67moIfliIbvvIzoi6XkvJrooqvlj43lkIPliJnlho3lpLHlt7Hmlrnmo4vlrZAKICAgICAgICBjb25zdCB0YXJnZXRWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUodGFyZ2V0UGllY2UsIGdhbWVTdGFnZSk7CiAgICAgICAgY29uc3Qgb3VyVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKG1vdmluZ1BpZWNlLCBnYW1lU3RhZ2UpOwogICAgICAgIGxldCBzZWUgPSB0YXJnZXRWYWx1ZSAtIG91clZhbHVlOwogICAgICAgIC8vIOiLpeacieW3seaWuee7p+e7reS/neaKpO+8jOeyl+eVpeiupOS4uuWPr+iDveWGjeWQg+WbnuacgOS9juS7t+WAvOeahOaVjOaWueS/neaKpOiAhQogICAgICAgIGlmIChoYXNBbGx5Q29udHJvbGxlcikgewogICAgICAgICAgICBjb25zdCBlbmVteUd1YXJkVmFsdWVzID0gY29udHJvbGxlcnMKICAgICAgICAgICAgICAgIC5maWx0ZXIoYyA9PiBjb250cm9sbGVyQ29sb3IoYykgIT09IGN1cnJlbnRQbGF5ZXIgJiYgIShjLnIgPT09IGZyb20uciAmJiBjLmMgPT09IGZyb20uYykpCiAgICAgICAgICAgICAgICAubWFwKGMgPT4gewogICAgICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtjLnJdW2MuY107CiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHAgPyBnZXRNYXRlcmlhbFZhbHVlKHAsIGdhbWVTdGFnZSkgOiAwOwogICAgICAgICAgICAgICAgfSkKICAgICAgICAgICAgICAgIC5maWx0ZXIodiA9PiB2ID4gMCkKICAgICAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBhIC0gYik7CiAgICAgICAgICAgIGlmIChlbmVteUd1YXJkVmFsdWVzLmxlbmd0aCA+IDApIHsKICAgICAgICAgICAgICAgIHNlZSArPSBlbmVteUd1YXJkVmFsdWVzWzBdOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIC8vIOaYjuaYvuS6j+aNou+8iOWmgui9puaNouaXoOagueWFteS4lOS8muiiq+WPjeWQg++8ieWImei/h+a7pO+8m+W5s+aNoi/otZrmjaLnlZnnu5nmkJzntKIKICAgICAgICByZXR1cm4gc2VlID49IDA7CiAgICB9CgogICAgLy8g6Z2e5ZCD5a2Q77ya55uu5qCH5LuF6KKr5pWM5pa55o6n5Yi25YiZ6KeG5Li66YCB5ZCDCiAgICBpZiAoY29udHJvbGxlcnMubGVuZ3RoID09PSAwKSB7CiAgICAgICAgcmV0dXJuIHRydWU7CiAgICB9CiAgICByZXR1cm4gIWhhc0VuZW15Q29udHJvbGxlciB8fCBoYXNBbGx5Q29udHJvbGxlcjsKfTsKCi8vIFNFRSDmjpLluo/lpI3nlKjnvJPlhrLvvIzpmY3kvY7lj7bor4TkvLAgR0MKY29uc3Qgc2VlQXR0YWNrZXJTY3JhdGNoID0gW107CmNvbnN0IHNlZUd1YXJkU2NyYXRjaCA9IFtdOwpjb25zdCBzZWVBdHRhY2tlck1hdFNjcmF0Y2ggPSBbXTsKY29uc3Qgc2VlR3VhcmRNYXRTY3JhdGNoID0gW107CgovLyDmnInmoLnlrZDnroDljJYgU0VF77yI5LiO5pen5a6e546w6YCQ6KGM562J5Lu377yJ77yb5q+P5Liq55uu5qCH5Y+q5bqU6LCD55So5LiA5qyhCmNvbnN0IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmUgPSAodGhyZWF0ZW5lZFBpZWNlKSA9PiB7CiAgICBjb25zdCBhdHRhY2tlcnMgPSBzZWVBdHRhY2tlclNjcmF0Y2g7CiAgICBjb25zdCBndWFyZHMgPSBzZWVHdWFyZFNjcmF0Y2g7CiAgICBhdHRhY2tlcnMubGVuZ3RoID0gMDsKICAgIGd1YXJkcy5sZW5ndGggPSAwOwogICAgY29uc3QgcmF3QXR0YWNrZXJzID0gdGhyZWF0ZW5lZFBpZWNlLnRocmVhdGVuZWRCeTsKICAgIGNvbnN0IHJhd0d1YXJkcyA9IHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnk7CiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJhd0F0dGFja2Vycy5sZW5ndGg7IGkrKykgYXR0YWNrZXJzLnB1c2gocmF3QXR0YWNrZXJzW2ldKTsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF3R3VhcmRzLmxlbmd0aDsgaSsrKSBndWFyZHMucHVzaChyYXdHdWFyZHNbaV0pOwogICAgYXR0YWNrZXJzLnNvcnQoKGEsIGIpID0+IGEubWF0ZXJpYWxWYWx1ZSAtIGIubWF0ZXJpYWxWYWx1ZSk7CiAgICBndWFyZHMuc29ydCgoYSwgYikgPT4gYS5tYXRlcmlhbFZhbHVlIC0gYi5tYXRlcmlhbFZhbHVlKTsKCiAgICBsZXQgZXhjaGFuZ2VTY29yZSA9IDA7CiAgICBsZXQgYXR0YWNrZXJJbmRleCA9IDA7CiAgICBsZXQgZ3VhcmRJbmRleCA9IDA7CiAgICBjb25zdCB0YXJnZXRWYWx1ZSA9IHRocmVhdGVuZWRQaWVjZS5tYXRlcmlhbFZhbHVlOwoKICAgIHdoaWxlIChhdHRhY2tlckluZGV4IDwgYXR0YWNrZXJzLmxlbmd0aCAmJiBndWFyZEluZGV4IDwgZ3VhcmRzLmxlbmd0aCkgewogICAgICAgIGlmIChndWFyZEluZGV4ID09PSAwKSB7CiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gdGFyZ2V0VmFsdWU7CiAgICAgICAgfQogICAgICAgIGV4Y2hhbmdlU2NvcmUgLT0gYXR0YWNrZXJzW2F0dGFja2VySW5kZXhdLm1hdGVyaWFsVmFsdWU7CiAgICAgICAgaWYgKGF0dGFja2VySW5kZXggKyAxIDwgYXR0YWNrZXJzLmxlbmd0aCkgewogICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IGd1YXJkc1tndWFyZEluZGV4XS5tYXRlcmlhbFZhbHVlOwogICAgICAgIH0KICAgICAgICBhdHRhY2tlckluZGV4Kys7CiAgICAgICAgZ3VhcmRJbmRleCsrOwogICAgfQogICAgcmV0dXJuIGV4Y2hhbmdlU2NvcmU7Cn07CgovLyBtYXNrIOi3r+W+hCBTRUXvvJrmnZDmlpnmlbDnu4TmjpLluo/vvIzor63kuYnkuI7kuIrlvI/kuIDoh7TvvIhiaXRzY2FuIOWGheiBlO+8jOaXoOWbnuiwg++8iQpjb25zdCBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlRnJvbU1hc2tzID0gKHRocmVhdGVuZWRQaWVjZSwgcGllY2VzSW5mbywgYXR0YWNrTWFzaywgZ3VhcmRNYXNrKSA9PiB7CiAgICBjb25zdCBhdGtNYXRzID0gc2VlQXR0YWNrZXJNYXRTY3JhdGNoOwogICAgY29uc3QgZ3JkTWF0cyA9IHNlZUd1YXJkTWF0U2NyYXRjaDsKICAgIGF0a01hdHMubGVuZ3RoID0gMDsKICAgIGdyZE1hdHMubGVuZ3RoID0gMDsKICAgIGNvbnN0IHNxID0gdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmM7CiAgICBsZXQgYW0gPSBhdHRhY2tNYXNrW3NxXSA+Pj4gMDsKICAgIHdoaWxlIChhbSAhPT0gMCkgewogICAgICAgIGNvbnN0IGJpdCA9IGFtICYgLWFtOwogICAgICAgIGF0a01hdHMucHVzaChwaWVjZXNJbmZvWzMxIC0gTWF0aC5jbHozMihiaXQpXS5tYXRlcmlhbFZhbHVlKTsKICAgICAgICBhbSBePSBiaXQ7CiAgICB9CiAgICBsZXQgZ20gPSBndWFyZE1hc2tbc3FdID4+PiAwOwogICAgd2hpbGUgKGdtICE9PSAwKSB7CiAgICAgICAgY29uc3QgYml0ID0gZ20gJiAtZ207CiAgICAgICAgZ3JkTWF0cy5wdXNoKHBpZWNlc0luZm9bMzEgLSBNYXRoLmNsejMyKGJpdCldLm1hdGVyaWFsVmFsdWUpOwogICAgICAgIGdtIF49IGJpdDsKICAgIH0KICAgIGF0a01hdHMuc29ydCgoYSwgYikgPT4gYSAtIGIpOwogICAgZ3JkTWF0cy5zb3J0KChhLCBiKSA9PiBhIC0gYik7CgogICAgbGV0IGV4Y2hhbmdlU2NvcmUgPSAwOwogICAgbGV0IGF0dGFja2VySW5kZXggPSAwOwogICAgbGV0IGd1YXJkSW5kZXggPSAwOwogICAgY29uc3QgdGFyZ2V0VmFsdWUgPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsKCiAgICB3aGlsZSAoYXR0YWNrZXJJbmRleCA8IGF0a01hdHMubGVuZ3RoICYmIGd1YXJkSW5kZXggPCBncmRNYXRzLmxlbmd0aCkgewogICAgICAgIGlmIChndWFyZEluZGV4ID09PSAwKSB7CiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gdGFyZ2V0VmFsdWU7CiAgICAgICAgfQogICAgICAgIGV4Y2hhbmdlU2NvcmUgLT0gYXRrTWF0c1thdHRhY2tlckluZGV4XTsKICAgICAgICBpZiAoYXR0YWNrZXJJbmRleCArIDEgPCBhdGtNYXRzLmxlbmd0aCkgewogICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IGdyZE1hdHNbZ3VhcmRJbmRleF07CiAgICAgICAgfQogICAgICAgIGF0dGFja2VySW5kZXgrKzsKICAgICAgICBndWFyZEluZGV4Kys7CiAgICB9CiAgICByZXR1cm4gZXhjaGFuZ2VTY29yZTsKfTsKCi8vIOiuoeeul+WogeiDgeWAvO+8iOWfuuS6juWujOaVtOeahOWogeiDgeWFs+ezu++8iQovLyDmjInooqvlqIHog4HlrZDogZrlkIjvvJrmr4/kuKrnm67moIfmnIDlpJrkuIDmrKEgU0VF77yb5YiG5YC85Yqg57uZIHRocmVhdGVuZWRCeVswXQovLyDvvIjlhbPns7vmnoTlu7rmjIkgcGllY2VzSW5mbyDpobrluo8gcHVzaO+8jOaVheS4juaXp+KAnOaUu+WHu+aWueWkluWxgumBjeWOhummluasoeiuoeWIhuKAneW9kuWxnuS4gOiHtO+8iQpjb25zdCBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMgPSAocGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvID0gbnVsbCkgPT4gewogICAgLy8g57uf6K6hCiAgICBpZiAoY3VycmVudFBsYXllcikgewogICAgICAgIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudFtjdXJyZW50UGxheWVyXSsrOwogICAgfQoKICAgIC8vIOWIneWni+WMluWogeiDgeexu+Wei+e7n+iuoeS/oeaBrwogICAgaWYgKGJvYXJkSW5mbykgewogICAgICAgIGJvYXJkSW5mby5jaGVja3MgPSBbXTsgICAgICAvLyDlsIblhpvkv6Hmga8KICAgICAgICBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyA9IFtdOyAgLy8g6KKr5o2J55qE5qOL5a2QCiAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUgPSBbXTsgIC8vIOWPr+WQg+eahOaji+WtkAogICAgfQoKICAgIGNvbnN0IGNoZWNrQm9udXMgPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuY2hlY2suYm9udXM7CiAgICBjb25zdCBjYW5DYXB0dXJlU2VlbiA9IG5ldyBTZXQoKTsKICAgIGNvbnN0IHVzZU1hc2tzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKTsKICAgIGNvbnN0IGF0dGFja01hc2sgPSB1c2VNYXNrcyA/IGJvYXJkSW5mby5hdHRhY2tNYXNrIDogbnVsbDsKICAgIGNvbnN0IGd1YXJkTWFzayA9IHVzZU1hc2tzID8gYm9hcmRJbmZvLmd1YXJkTWFzayA6IG51bGw7CgogICAgZm9yIChsZXQgdGkgPSAwOyB0aSA8IHBpZWNlc0luZm8ubGVuZ3RoOyB0aSsrKSB7CiAgICAgICAgY29uc3QgdGhyZWF0ZW5lZFBpZWNlID0gcGllY2VzSW5mb1t0aV07CiAgICAgICAgbGV0IGZpcnN0QXR0YWNrZXI7CiAgICAgICAgbGV0IGhhc0d1YXJkOwogICAgICAgIGxldCBhdHRhY2tlckxpc3QgPSBudWxsOwoKICAgICAgICBpZiAodXNlTWFza3MpIHsKICAgICAgICAgICAgY29uc3Qgc3EgPSB0aHJlYXRlbmVkUGllY2UuciAqIDkgKyB0aHJlYXRlbmVkUGllY2UuYzsKICAgICAgICAgICAgY29uc3QgYW0gPSBhdHRhY2tNYXNrW3NxXTsKICAgICAgICAgICAgaWYgKGFtID09PSAwKSBjb250aW51ZTsKICAgICAgICAgICAgLy8g5pyA5L2OIGJpdCA9IHBpZWNlc0luZm8g6aG65bqP5LiL5pyA5YWI5oyC5LiK55qE5pS75Ye75pa577yI5LiO5penIHRocmVhdGVuZWRCeVswXSDkuIDoh7TvvIkKICAgICAgICAgICAgZmlyc3RBdHRhY2tlciA9IHBpZWNlc0luZm9bbG93ZXN0U2V0Qml0SW5kZXgoYW0pXTsKICAgICAgICAgICAgaGFzR3VhcmQgPSBndWFyZE1hc2tbc3FdICE9PSAwOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGNvbnN0IGF0dGFja2VycyA9IHRocmVhdGVuZWRQaWVjZS50aHJlYXRlbmVkQnk7CiAgICAgICAgICAgIGlmICghYXR0YWNrZXJzIHx8IGF0dGFja2Vycy5sZW5ndGggPT09IDApIGNvbnRpbnVlOwogICAgICAgICAgICBmaXJzdEF0dGFja2VyID0gYXR0YWNrZXJzWzBdOwogICAgICAgICAgICBoYXNHdWFyZCA9IHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnkgJiYgdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeS5sZW5ndGggPiAwOwogICAgICAgICAgICBhdHRhY2tlckxpc3QgPSBhdHRhY2tlcnM7CiAgICAgICAgfQoKICAgICAgICAvLyDlsIblhpvvvJrlj6rnu5nlsI/pop3lhYjmiYvliIbvvIznu53kuI3mjInlsIYv5biF5p2Q5paZ5YC85YGaIFNFRQogICAgICAgIGlmICh0aHJlYXRlbmVkUGllY2UucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgewogICAgICAgICAgICBpZiAoYm9hcmRJbmZvKSB7CiAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsKICAgICAgICAgICAgICAgICAgICBsZXQgbSA9IGF0dGFja01hc2tbdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmNdID4+PiAwOwogICAgICAgICAgICAgICAgICAgIHdoaWxlIChtICE9PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJpdCA9IG0gJiAtbTsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsKICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNoZWNrcy5wdXNoKHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja2VyOiBwaWVjZXNJbmZvW2FpXSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldDogdGhyZWF0ZW5lZFBpZWNlLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNDaGVjazogdHJ1ZQogICAgICAgICAgICAgICAgICAgICAgICB9KTsKICAgICAgICAgICAgICAgICAgICAgICAgbSBePSBiaXQ7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBhaSA9IDA7IGFpIDwgYXR0YWNrZXJMaXN0Lmxlbmd0aDsgYWkrKykgewogICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2hlY2tzLnB1c2goewogICAgICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrZXI6IGF0dGFja2VyTGlzdFthaV0sCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHRocmVhdGVuZWRQaWVjZSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQ2hlY2s6IHRydWUKICAgICAgICAgICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gY2hlY2tCb251czsKICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgfQoKICAgICAgICAvLyDlj6rmiorlr7nmlLvlh7vmlrnmnInliKnnmoTlqIHog4HorqHlhaUgdGhyZWF0VmFsdWXvvIjljZXlkJHorqHlhaXvvIzkuI3lgZogc2FmZXR5IOWvueensOaJo+WIhu+8iQogICAgICAgIGlmICghaGFzR3VhcmQpIHsKICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsKICAgICAgICAgICAgaWYgKGJvYXJkSW5mbykgewogICAgICAgICAgICAgICAgaWYgKGZpcnN0QXR0YWNrZXIucGllY2UuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXIpIHsKICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsKICAgICAgICAgICAgICAgICAgICAgICAgbGV0IG0gPSBhdHRhY2tNYXNrW3RocmVhdGVuZWRQaWVjZS5yICogOSArIHRocmVhdGVuZWRQaWVjZS5jXSA+Pj4gMDsKICAgICAgICAgICAgICAgICAgICAgICAgd2hpbGUgKG0gIT09IDApIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJpdCA9IG0gJiAtbTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvWzMxIC0gTWF0aC5jbHozMihiaXQpXTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghY2FuQ2FwdHVyZVNlZW4uaGFzKGluZm8pKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FuQ2FwdHVyZVNlZW4uYWRkKGluZm8pOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jYW5DYXB0dXJlLnB1c2goaW5mbyk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtIF49IGJpdDsKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGFpID0gMDsgYWkgPCBhdHRhY2tlckxpc3QubGVuZ3RoOyBhaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gYXR0YWNrZXJMaXN0W2FpXTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghY2FuQ2FwdHVyZVNlZW4uaGFzKGluZm8pKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FuQ2FwdHVyZVNlZW4uYWRkKGluZm8pOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jYW5DYXB0dXJlLnB1c2goaW5mbyk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLnB1c2godGhyZWF0ZW5lZFBpZWNlKTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGNvbnN0IHNzZVNjb3JlID0gdXNlTWFza3MKICAgICAgICAgICAgICAgID8gY2FsY3VsYXRlU3RhdGljRXhjaGFuZ2VTY29yZUZyb21NYXNrcyh0aHJlYXRlbmVkUGllY2UsIHBpZWNlc0luZm8sIGF0dGFja01hc2ssIGd1YXJkTWFzaykKICAgICAgICAgICAgICAgIDogY2FsY3VsYXRlU3RhdGljRXhjaGFuZ2VTY29yZSh0aHJlYXRlbmVkUGllY2UpOwogICAgICAgICAgICBpZiAoc3NlU2NvcmUgPiAwKSB7CiAgICAgICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IHNzZVNjb3JlICogMC41OwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQp9OwoKLy8g6K6h566X5a6J5YWo5YC877ya5bCG56m65o6n6YK75qC85piv5ZCm6KKr5pWM5o6n77yI5pegIHZpc2l0IOWbnuiwg++8iQpjb25zdCBjYWxjdWxhdGVTYWZldHlWYWx1ZXMgPSAocGllY2VzSW5mbywgYm9hcmRJbmZvLCBib2FyZCA9IG51bGwpID0+IHsKICAgIGNvbnN0IGdlbmVyYWxJbmZvID0gW107CiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsKICAgICAgICBpZiAocGllY2VzSW5mb1tpXS5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5HRU5FUkFMKSB7CiAgICAgICAgICAgIGdlbmVyYWxJbmZvLnB1c2gocGllY2VzSW5mb1tpXSk7CiAgICAgICAgfQogICAgfQoKICAgIGNvbnN0IHVzZUF0dGFja0JpdHMgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMpOwogICAgY29uc3QgdXNlTWFza3MgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpOwoKICAgIGZvciAobGV0IGdpID0gMDsgZ2kgPCBnZW5lcmFsSW5mby5sZW5ndGg7IGdpKyspIHsKICAgICAgICBjb25zdCBnZW5lcmFsID0gZ2VuZXJhbEluZm9bZ2ldOwogICAgICAgIGNvbnN0IGdlbmVyYWxDb2xvciA9IGdlbmVyYWwucGllY2UuY29sb3I7CiAgICAgICAgY29uc3QgZW5lbXlDb2xvciA9IGdlbmVyYWxDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7CiAgICAgICAgY29uc3QgZW5lbXlCaXRzID0gdXNlQXR0YWNrQml0cwogICAgICAgICAgICA/IChlbmVteUNvbG9yID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRBdHRhY2sgOiBib2FyZEluZm8uYmxhY2tBdHRhY2spCiAgICAgICAgICAgIDogbnVsbDsKICAgICAgICBjb25zdCBpc1JlZCA9IGdlbmVyYWxDb2xvciA9PT0gJ3JlZCc7CiAgICAgICAgY29uc3QgeyByLCBjIH0gPSBnZW5lcmFsOwoKICAgICAgICBjb25zdCBwZW5hbGl6ZUlmRW5lbXkgPSAobnIsIG5jKSA9PiB7CiAgICAgICAgICAgIGxldCBoYXNFbmVteUNvbnRyb2w7CiAgICAgICAgICAgIGlmICh1c2VBdHRhY2tCaXRzKSB7CiAgICAgICAgICAgICAgICBoYXNFbmVteUNvbnRyb2wgPSBoYXNBdHRhY2tCaXQoZW5lbXlCaXRzLCBuciAqIDkgKyBuYyk7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICBjb25zdCBwb3NpdGlvbkNvbnRyb2xsZXJzID0gYm9hcmRJbmZvW25yXVtuY107CiAgICAgICAgICAgICAgICBoYXNFbmVteUNvbnRyb2wgPSBmYWxzZTsKICAgICAgICAgICAgICAgIGZvciAobGV0IGNpID0gMDsgY2kgPCBwb3NpdGlvbkNvbnRyb2xsZXJzLmxlbmd0aDsgY2krKykgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBwb3NpdGlvbkNvbnRyb2xsZXJzW2NpXTsKICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2xvciA9IGNvbnRyb2xsZXIucGllY2UgPyBjb250cm9sbGVyLnBpZWNlLmNvbG9yIDogY29udHJvbGxlci5jb2xvcjsKICAgICAgICAgICAgICAgICAgICBpZiAoY29sb3IgPT09IGVuZW15Q29sb3IpIHsKICAgICAgICAgICAgICAgICAgICAgICAgaGFzRW5lbXlDb250cm9sID0gdHJ1ZTsKICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmIChoYXNFbmVteUNvbnRyb2wpIGdlbmVyYWwuc2FmZXR5VmFsdWUgLT0gNTA7CiAgICAgICAgfTsKCiAgICAgICAgaWYgKCh1c2VNYXNrcyAmJiBib2FyZCkgfHwgKCghZ2VuZXJhbC5jb250cm9sIHx8IGdlbmVyYWwuY29udHJvbC5sZW5ndGggPT09IDApICYmIGJvYXJkKSkgewogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgT1JUSF9ESVJTW2ldWzBdOwogICAgICAgICAgICAgICAgY29uc3QgbmMgPSBjICsgT1JUSF9ESVJTW2ldWzFdOwogICAgICAgICAgICAgICAgaWYgKG5jIDwgMyB8fCBuYyA+IDUpIGNvbnRpbnVlOwogICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7CiAgICAgICAgICAgICAgICAgICAgaWYgKG5yIDwgMCB8fCBuciA+IDIpIGNvbnRpbnVlOwogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChuciA8IDcgfHwgbnIgPiA5KSB7CiAgICAgICAgICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCkgcGVuYWxpemVJZkVuZW15KG5yLCBuYyk7CiAgICAgICAgICAgIH0KICAgICAgICB9IGVsc2UgaWYgKGdlbmVyYWwuY29udHJvbCAmJiBnZW5lcmFsLmNvbnRyb2wubGVuZ3RoKSB7CiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ2VuZXJhbC5jb250cm9sLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBwZW5hbGl6ZUlmRW5lbXkoZ2VuZXJhbC5jb250cm9sW2ldLnIsIGdlbmVyYWwuY29udHJvbFtpXS5jKTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KfTsKCi8vIC0tLSBUeXBlcyAoSW5saW5lZCB0byBhdm9pZCBpbXBvcnQgaXNzdWVzIGluIFdvcmtlcikgLS0tCi8vIC8vIHR5cGUgQ29sb3IgLSBUeXBlU2NyaXB0IHR5cGUgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5ICdyZWQnIHwgJ2JsYWNrJzsKLy8gLy8gdHlwZSBQaWVjZVR5cGUgLSBUeXBlU2NyaXB0IHR5cGUgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5ICdnZW5lcmFsJyB8ICdhZHZpc29yJyB8ICdlbGVwaGFudCcgfCAnaG9yc2UnIHwgJ2NoYXJpb3QnIHwgJ2Nhbm5vbicgfCAnc29sZGllcic7Ci8vIC8vIGludGVyZmFjZSBQaWVjZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQovLyAvLyBpbnRlcmZhY2UgUG9zaXRpb24gLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkKLy8gLy8gaW50ZXJmYWNlIE1vdmUgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkKLy8gLy8gdHlwZSBCb2FyZCAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgKFBpZWNlIHwgbnVsbClbXVtdOwoKLy8gLS0tIE9wZW5pbmcgQm9vayBUeXBlcyAtLS0KLy8gT3BlbmluZyBCb29rIEVudHJ5IC0gcmVwcmVzZW50cyBwb3NzaWJsZSBtb3ZlcyBmb3IgYSBwb3NpdGlvbgovLyBpbnRlcmZhY2UgQm9va0VudHJ5IC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5CgovLyBJbmRpdmlkdWFsIG1vdmUgaW4gb3BlbmluZyBib29rIHdpdGggbWV0YWRhdGEKLy8gaW50ZXJmYWNlIEJvb2tNb3ZlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5CgovLyAtLS0gWm9icmlzdCBIYXNoaW5nIGZvciBPcGVuaW5nIEJvb2sgLS0tCi8vIEVhY2ggcGllY2UgdHlwZS9jb2xvci9wb3NpdGlvbiBnZXRzIGEgdW5pcXVlIHJhbmRvbSA1My1iaXQgaW50ZWdlcgovLyBVc2VzIHNlZWRlZCBSTkcgZm9yIGRldGVybWluaXN0aWMgaGFzaGluZwpjbGFzcyBab2JyaXN0SGFzaGVyIHsKICAgIGhhc2hUYWJsZTsgIC8vIFtyb3ddW2NvbF1bcGllY2VJbmRleF0KICAgIHBpZWNlVG9JbmRleDsKCiAgICBjb25zdHJ1Y3RvcigpIHsKICAgICAgICB0aGlzLnBpZWNlVG9JbmRleCA9IG5ldyBNYXAoWwogICAgICAgICAgICBbJ3JlZC1nZW5lcmFsJywgMF0sCiAgICAgICAgICAgIFsncmVkLWFkdmlzb3InLCAxXSwKICAgICAgICAgICAgWydyZWQtZWxlcGhhbnQnLCAyXSwKICAgICAgICAgICAgWydyZWQtaG9yc2UnLCAzXSwKICAgICAgICAgICAgWydyZWQtY2hhcmlvdCcsIDRdLAogICAgICAgICAgICBbJ3JlZC1jYW5ub24nLCA1XSwKICAgICAgICAgICAgWydyZWQtc29sZGllcicsIDZdLAogICAgICAgICAgICBbJ2JsYWNrLWdlbmVyYWwnLCA3XSwKICAgICAgICAgICAgWydibGFjay1hZHZpc29yJywgOF0sCiAgICAgICAgICAgIFsnYmxhY2stZWxlcGhhbnQnLCA5XSwKICAgICAgICAgICAgWydibGFjay1ob3JzZScsIDEwXSwKICAgICAgICAgICAgWydibGFjay1jaGFyaW90JywgMTFdLAogICAgICAgICAgICBbJ2JsYWNrLWNhbm5vbicsIDEyXSwKICAgICAgICAgICAgWydibGFjay1zb2xkaWVyJywgMTNdLAogICAgICAgIF0pOwoKICAgICAgICAvLyBJbml0aWFsaXplIHJhbmRvbSBoYXNoIHZhbHVlcyB1c2luZyBzZWVkZWQgUk5HICg1My1iaXQgaW50ZWdlcnMgdG8gYXZvaWQgcHJlY2lzaW9uIGlzc3VlcykKICAgICAgICB0aGlzLmhhc2hUYWJsZSA9IFtdOwogICAgICAgIGNvbnN0IE1BWF9TQUZFID0gMHgxRkZGRkZGRkZGRkZGRjsgLy8gMl41MyAtIDEKICAgICAgICAKICAgICAgICAvLyBTaW1wbGUgc2VlZGVkIFJORyAoTENHIC0gTGluZWFyIENvbmdydWVudGlhbCBHZW5lcmF0b3IpCiAgICAgICAgbGV0IHNlZWQgPSAxMjM0NTY3ODk7IC8vIEZpeGVkIHNlZWQgZm9yIGRldGVybWluaXN0aWMgaGFzaGluZwogICAgICAgIGNvbnN0IHNlZWRlZFJhbmRvbSA9ICgpID0+IHsKICAgICAgICAgICAgc2VlZCA9IChzZWVkICogMTEwMzUxNTI0NSArIDEyMzQ1KSAmIDB4N2ZmZmZmZmY7CiAgICAgICAgICAgIHJldHVybiBzZWVkIC8gMHg3ZmZmZmZmZjsKICAgICAgICB9OwoKICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsKICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl0gPSBbXTsKICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsKICAgICAgICAgICAgICAgIHRoaXMuaGFzaFRhYmxlW3JdW2NdID0gW107CiAgICAgICAgICAgICAgICBmb3IgKGxldCBwID0gMDsgcCA8IDE0OyBwKyspIHsKICAgICAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBkZXRlcm1pbmlzdGljIDUzLWJpdCBpbnRlZ2VyCiAgICAgICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY11bcF0gPSBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQoKICAgICAgICAvLyDlj7bor4TkvLDnvJPlrZjplK7vvJpib2FyZEhhc2ggXiBpbml0aWF0b3JLZXkgXiBzdGFnZUtleQogICAgICAgIHRoaXMuZXZhbEluaXRpYXRvcktleXMgPSB7CiAgICAgICAgICAgIHJlZDogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwKICAgICAgICAgICAgYmxhY2s6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSkKICAgICAgICB9OwogICAgICAgIHRoaXMuZXZhbFN0YWdlS2V5cyA9IHsKICAgICAgICAgICAgZWFybHk6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSksCiAgICAgICAgICAgIG1pZDogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwKICAgICAgICAgICAgbGF0ZTogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKQogICAgICAgIH07CiAgICB9CgogICAgcGllY2VJbmRleChwaWVjZU9yS2V5KSB7CiAgICAgICAgaWYgKHBpZWNlT3JLZXkgPT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDsKICAgICAgICBpZiAodHlwZW9mIHBpZWNlT3JLZXkgPT09ICdzdHJpbmcnKSByZXR1cm4gdGhpcy5waWVjZVRvSW5kZXguZ2V0KHBpZWNlT3JLZXkpOwogICAgICAgIHJldHVybiB0aGlzLnBpZWNlVG9JbmRleC5nZXQoYCR7cGllY2VPcktleS5jb2xvcn0tJHtwaWVjZU9yS2V5LnR5cGV9YCk7CiAgICB9CgogICAgZXZhbENhY2hlS2V5KGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSkgewogICAgICAgIGNvbnN0IHN0YWdlS2V5ID0gdGhpcy5ldmFsU3RhZ2VLZXlzW2dhbWVTdGFnZV0gfHwgdGhpcy5ldmFsU3RhZ2VLZXlzLm1pZDsKICAgICAgICByZXR1cm4gdGhpcy5oYXNoKGJvYXJkKSBeIHRoaXMuZXZhbEluaXRpYXRvcktleXNbc2VhcmNoSW5pdGlhdG9yXSBeIHN0YWdlS2V5OwogICAgfQoKICAgIGV2YWxDYWNoZUtleUZyb21IYXNoKGJvYXJkSGFzaCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpIHsKICAgICAgICBjb25zdCBzdGFnZUtleSA9IHRoaXMuZXZhbFN0YWdlS2V5c1tnYW1lU3RhZ2VdIHx8IHRoaXMuZXZhbFN0YWdlS2V5cy5taWQ7CiAgICAgICAgcmV0dXJuIGJvYXJkSGFzaCBeIHRoaXMuZXZhbEluaXRpYXRvcktleXNbc2VhcmNoSW5pdGlhdG9yXSBeIHN0YWdlS2V5OwogICAgfQoKICAgIC8qKgogICAgICog5pWw5YC8IFRUIGtlee+8muaKiuihjOaji+aWuee8lueggei/m+acgOS9juS9je+8jOmBv+WFjSBgaGFzaCBeIHNpZGVLZXlgIOWcqCBKUyBUb0ludDMyCiAgICAgKiDkuIvkuqfnlJ/ot6jnuqLpu5HnorDmkp7vvIjpgqPkvJrkvb8gVFQg6K+v5ZG95Lit5bm25pS55Y+Y5pCc57Si5qCRL+aji+WKm++8ieOAggogICAgICog562J5Lu35LqO5pen5a2X56ym5LiyIGtleSBgJHtoYXNofToke3NpZGV9YCDnmoTljLrliIbog73lipvjgIIKICAgICAqLwogICAgdHRLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNpZGUpIHsKICAgICAgICBjb25zdCBoID0gYm9hcmRIYXNoIHwgMDsgLy8gXj0g6ZO+57uT5p6c5bey5pivIEludDMyCiAgICAgICAgcmV0dXJuIGggKiAyICsgKHNpZGUgPT09ICdyZWQnID8gMCA6IDEpOwogICAgfQoKICAgIC8qKgogICAgICogQ29tcHV0ZSBoYXNoIGZvciBhIGJvYXJkIHBvc2l0aW9uCiAgICAgKi8KICAgIGhhc2goYm9hcmQpIHsKICAgICAgICBsZXQgaCA9IDA7CiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7CiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGllY2VJZHggPSB0aGlzLnBpZWNlSW5kZXgocGllY2UpOwogICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZUlkeCAhPT0gdW5kZWZpbmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGggXj0gdGhpcy5oYXNoVGFibGVbcl1bY11bcGllY2VJZHhdOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICByZXR1cm4gaDsKICAgIH0KCiAgICAvKioKICAgICAqIE1pcnJvciBhIGJvYXJkIGhvcml6b250YWxseSAoZm9yIHN5bW1ldHJ5IGRldGVjdGlvbikKICAgICAqLwogICAgbWlycm9yQm9hcmQoYm9hcmQpIHsKICAgICAgICBjb25zdCBtaXJyb3JlZCA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpKTsKICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsKICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsKICAgICAgICAgICAgICAgIG1pcnJvcmVkW3JdWzggLSBjXSA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybiBtaXJyb3JlZDsKICAgIH0KCiAgICAvKioKICAgICAqIE1pcnJvciBhIG1vdmUgaG9yaXpvbnRhbGx5CiAgICAgKi8KICAgIG1pcnJvck1vdmUobW92ZSkgewogICAgICAgIHJldHVybiB7CiAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IDggLSBtb3ZlLmZyb20uYyB9LAogICAgICAgICAgICB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IDggLSBtb3ZlLnRvLmMgfQogICAgICAgIH07CiAgICB9CgogICAgLyoqCiAgICAgKiBJbmNyZW1lbnRhbGx5IHVwZGF0ZSBoYXNoIGFmdGVyIGEgbW92ZSAoWE9SIOiHqumAhu+8muWGjeiwg+eUqOS4gOasoeWPr+i/mOWOnykuCiAgICAgKiBtb3ZpbmdQaWVjZSAvIGNhcHR1cmVkUGllY2Ug5Y+v5Li65qOL5a2Q5a+56LGh5oiWICdjb2xvci10eXBlJyDlrZfnrKbkuLLjgIIKICAgICAqIOmhu+WcqCBtYWtlTW92ZSDkuYvliY3lj5blvpcgbW92aW5nUGllY2XvvIxjYXB0dXJlZCDnlKggbWFrZU1vdmUg6L+U5Zue5YC844CCCiAgICAgKi8KICAgIHVwZGF0ZUhhc2goY3VycmVudEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZFBpZWNlKSB7CiAgICAgICAgbGV0IG5ld0hhc2ggPSBjdXJyZW50SGFzaDsKICAgICAgICBjb25zdCBtb3ZpbmdJZHggPSB0aGlzLnBpZWNlSW5kZXgobW92aW5nUGllY2UpOwogICAgICAgIGlmIChtb3ZpbmdJZHggIT09IHVuZGVmaW5lZCkgewogICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY11bbW92aW5nSWR4XTsKICAgICAgICAgICAgbmV3SGFzaCBePSB0aGlzLmhhc2hUYWJsZVttb3ZlLnRvLnJdW21vdmUudG8uY11bbW92aW5nSWR4XTsKICAgICAgICB9CiAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsKICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRJZHggPSB0aGlzLnBpZWNlSW5kZXgoY2FwdHVyZWRQaWVjZSk7CiAgICAgICAgICAgIGlmIChjYXB0dXJlZElkeCAhPT0gdW5kZWZpbmVkKSB7CiAgICAgICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUudG8ucl1bbW92ZS50by5jXVtjYXB0dXJlZElkeF07CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgcmV0dXJuIG5ld0hhc2g7CiAgICB9Cn0KCi8qKgogKiBPcGVuaW5nIEJvb2sgTWFuYWdlcgogKi8KY2xhc3MgT3BlbmluZ0Jvb2sgewogICAgYm9vazsgIC8vIFpvYnJpc3QgaGFzaCAtPiBtb3ZlcwogICAgaGFzaGVyOwogICAgZW5hYmxlZDsKICAgIG1heFBseTsgIC8vIE1heGltdW0gcGx5IHRvIHVzZSBvcGVuaW5nIGJvb2sgKGUuZy4sIDIwKQoKICAgIGNvbnN0cnVjdG9yKG1heFBseSA9IDEyKSB7CiAgICAgICAgdGhpcy5ib29rID0gbmV3IE1hcCgpOwogICAgICAgIHRoaXMuaGFzaGVyID0gbmV3IFpvYnJpc3RIYXNoZXIoKTsKICAgICAgICB0aGlzLmVuYWJsZWQgPSB0cnVlOwogICAgICAgIHRoaXMubWF4UGx5ID0gbWF4UGx5OwogICAgICAgIHRoaXMuaW5pdGlhbGl6ZUJvb2soKTsKICAgIH0KCiAgICAvKioKICAgICAqIEluaXRpYWxpemUgd2l0aCBjb21tb24gQ2hpbmVzZSBDaGVzcyBvcGVuaW5ncwogICAgICovCiAgICBpbml0aWFsaXplQm9vaygpIHsKICAgICAgICAvLyBBZGQgY2xhc3NpYyBDaGluZXNlIENoZXNzIG9wZW5pbmdzIG1hbnVhbGx5CiAgICAgICAgCiAgICAgICAgLyoKICAgICAgICAvLyAxLiDkuK3ngq7ov4fmsrPovablr7nlsY/po47pqazlubPngq7lr7novaYgKENlbnRyYWwgQ2Fubm9uIHZzIFNjcmVlbiBIb3JzZXMpCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZShbCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA3LCBjOiA3IH0sIHRvOiB7IHI6IDcsIGM6IDQgfSB9LCAgLy8gMS4g54Ku5LqM5bmz5LqUCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiA3IH0sIHRvOiB7IHI6IDIsIGM6IDYgfSB9LCAgLy8gMS4uLiDpqaw46L+bNwogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogNyB9LCB0bzogeyByOiA3LCBjOiA2IH0gfSwgIC8vIDIuIOmprOS6jOi/m+S4iQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogOCB9LCB0bzogeyByOiAwLCBjOiA3IH0gfSwgIC8vIDIuLi4g6L2mOeW5szggICAgICAgICAgIAogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogOCB9LCB0bzogeyByOiA5LCBjOiA3IH0gfSwgIC8vIDMuIOi9puS4gOW5s+S6jAogICAgICAgICAgICB7IGZyb206IHsgcjogMywgYzogNiB9LCB0bzogeyByOiA0LCBjOiA2IH0gfSwgIC8vIDMuLi4g5Y2SN+i/mzEKICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDcgfSwgdG86IHsgcjogMywgYzogNyB9IH0sICAvLyA0LiDovabkuozov5vlha0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDEgfSwgdG86IHsgcjogMiwgYzogMiB9IH0sICAvLyA0Li4uIOmprDLov5szCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA2LCBjOiAyIH0sIHRvOiB7IHI6IDUsIGM6IDIgfSB9LCAgLy8gNS4g5YW15LiD6L+b5LiACiAgICAgICAgICAgIHsgZnJvbTogeyByOiAyLCBjOiA3IH0sIHRvOiB7IHI6IDIsIGM6IDggfSB9LCAgLy8gNS4uLiDngq445bmzOQogICAgICAgICAgICB7IGZyb206IHsgcjogMywgYzogNyB9LCB0bzogeyByOiAzLCBjOiA2IH0gfSwgIC8vIDYuIOi9puS6jOW5s+S4iQogICAgICAgICAgICB7IGZyb206IHsgcjogMiwgYzogOCB9LCB0bzogeyByOiAxLCBjOiA4IH0gfSwgIC8vIDYuLi4g54KuOemAgDEgICAgICAgICAgCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsKCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihbCiAgICAgICAgICAgICfngq7kuozlubPkupQnLCAn6amsOOi/mzcnLCAn6ams5LqM6L+b5LiJJywgJ+i9pjnlubM4JywgJ+i9puS4gOW5s+S6jCcsICfljZI36L+bMScsCiAgICAgICAgICAgICfovabkuozov5vlha0nLCAn6amsMui/mzMnLCAn5YW15LiD6L+b5LiAJywgJ+eCrjjlubM5JywgJ+i9puS6jOW5s+S4iScsICfngq456YCAMScsCiAgICAgICAgICAgIF0sIFs4NSwgODUsIDk1LCA5MCwgOTAsIDg1LCA4NSwgODAsIDg1LCA4NSwgODUsIDg1XSk7CgogICAgICAgICAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21TdHJpbmcoWwogICAgICAgICAgICAn54Ku5LqM5bmz5LqUIOmprDjov5s3IOmprOS6jOi/m+S4iSDovaY55bmzOCDovabkuIDlubPkuowg5Y2SN+i/mzEg6L2m5LqM6L+b5YWtIOmprDLov5szIOWFteS4g+i/m+S4gCDngq445bmzOSDovabkuozlubPkuIkg54KuOemAgDEnCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsKICAgICAgICAqLwogICAgfQoKICAgIC8qKgogICAgICogQWRkIGFuIG9wZW5pbmcgbGluZSB0byB0aGUgYm9vawogICAgICogQHBhcmFtIG1vdmVzIEFycmF5IG9mIG1vdmVzIHJlcHJlc2VudGluZyBhbiBvcGVuaW5nIGxpbmUKICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIHdlaWdodHMgZm9yIGVhY2ggbW92ZSAoZGVmYXVsdCAxMDAgZm9yIGFsbCkKICAgICAqLwogICAgYWRkT3BlbmluZ0xpbmUobW92ZXMsIHdlaWdodHMpIHsKICAgICAgICAvLyBTdGFydCB3aXRoIGluaXRpYWwgYm9hcmQgcG9zaXRpb24KICAgICAgICBjb25zdCBib2FyZCA9IHRoaXMuY3JlYXRlSW5pdGlhbEJvYXJkKCk7CiAgICAgICAgbGV0IGN1cnJlbnRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChib2FyZCk7CgogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW92ZXMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2ldOwogICAgICAgICAgICBjb25zdCB3ZWlnaHQgPSB3ZWlnaHRzPy5baV0gPz8gMTAwOwoKICAgICAgICAgICAgLy8gR2V0IG9yIGNyZWF0ZSBib29rIGVudHJ5IGZvciB0aGlzIHBvc2l0aW9uCiAgICAgICAgICAgIGxldCBlbnRyeSA9IHRoaXMuYm9vay5nZXQoY3VycmVudEhhc2gpOwogICAgICAgICAgICBpZiAoIWVudHJ5KSB7CiAgICAgICAgICAgICAgICBlbnRyeSA9IHsgbW92ZXM6IFtdIH07CiAgICAgICAgICAgICAgICB0aGlzLmJvb2suc2V0KGN1cnJlbnRIYXNoLCBlbnRyeSk7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIC8vIEFkZCBtb3ZlIGlmIG5vdCBhbHJlYWR5IHByZXNlbnQKICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdNb3ZlID0gZW50cnkubW92ZXMuZmluZCgKICAgICAgICAgICAgICAgIG0gPT4gbS5mcm9tLnIgPT09IG1vdmUuZnJvbS5yICYmIG0uZnJvbS5jID09PSBtb3ZlLmZyb20uYyAmJgogICAgICAgICAgICAgICAgICAgICBtLnRvLnIgPT09IG1vdmUudG8uciAmJiBtLnRvLmMgPT09IG1vdmUudG8uYwogICAgICAgICAgICApOwoKICAgICAgICAgICAgaWYgKCFleGlzdGluZ01vdmUpIHsKICAgICAgICAgICAgICAgIGVudHJ5Lm1vdmVzLnB1c2goewogICAgICAgICAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sCiAgICAgICAgICAgICAgICAgICAgdG86IHsgcjogbW92ZS50by5yLCBjOiBtb3ZlLnRvLmMgfSwKICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHdlaWdodAogICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgd2VpZ2h0IGlmIG1vdmUgYWxyZWFkeSBleGlzdHMgKHRha2UgbWF4aW11bSkKICAgICAgICAgICAgICAgIGV4aXN0aW5nTW92ZS53ZWlnaHQgPSBNYXRoLm1heChleGlzdGluZ01vdmUud2VpZ2h0LCB3ZWlnaHQpOwogICAgICAgICAgICB9CgogICAgICAgICAgICAvLyBNYWtlIHRoZSBtb3ZlIG9uIHRoZSBib2FyZAogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107CiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkID0gYm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdOwogICAgICAgICAgICAKICAgICAgICAgICAgaWYgKCFwaWVjZSkgYnJlYWs7IC8vIEludmFsaWQgbGluZQoKICAgICAgICAgICAgY29uc3QgcGllY2VLZXkgPSBgJHtwaWVjZS5jb2xvcn0tJHtwaWVjZS50eXBlfWA7CiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkS2V5ID0gY2FwdHVyZWQgPyBgJHtjYXB0dXJlZC5jb2xvcn0tJHtjYXB0dXJlZC50eXBlfWAgOiB1bmRlZmluZWQ7CgogICAgICAgICAgICAvLyBVcGRhdGUgaGFzaCBpbmNyZW1lbnRhbGx5CiAgICAgICAgICAgIGN1cnJlbnRIYXNoID0gdGhpcy5oYXNoZXIudXBkYXRlSGFzaChjdXJyZW50SGFzaCwgbW92ZSwgcGllY2VLZXksIGNhcHR1cmVkS2V5KTsKCiAgICAgICAgICAgIC8vIEFwcGx5IG1vdmUKICAgICAgICAgICAgYm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdID0gcGllY2U7CiAgICAgICAgICAgIGJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY10gPSBudWxsOwogICAgICAgIH0KICAgIH0KCiAgICAvKioKICAgICAqIEdldCBiZXN0IG1vdmUgZnJvbSBvcGVuaW5nIGJvb2sgZm9yIGN1cnJlbnQgcG9zaXRpb24KICAgICAqIEBwYXJhbSBib2FyZCBDdXJyZW50IGJvYXJkIHN0YXRlCiAgICAgKiBAcGFyYW0gcGx5IEN1cnJlbnQgcGx5IG51bWJlciAoMCA9IHN0YXJ0IG9mIGdhbWUpCiAgICAgKiBAcmV0dXJucyBNb3ZlIGZyb20gYm9vaywgb3IgbnVsbCBpZiBwb3NpdGlvbiBub3QgaW4gYm9vawogICAgICovCiAgICBnZXRCb29rTW92ZShib2FyZCwgcGx5KXsKICAgICAgICAvLyBEb24ndCB1c2UgYm9vayBpZiBkaXNhYmxlZCBvciBwYXN0IG1heCBwbHkKICAgICAgICBpZiAoIXRoaXMuZW5hYmxlZCB8fCBwbHkgPj0gdGhpcy5tYXhQbHkpIHsKICAgICAgICAgICAgY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBkaXNhYmxlZCBvciBwYXN0IG1heCBwbHknLCB7IGVuYWJsZWQ6IHRoaXMuZW5hYmxlZCwgbWF4UGx5OiB0aGlzLm1heFBseSwgcGx5OiBwbHkgfSk7CiAgICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgIH0KICAgICAgICAKICAgICAgICAvL2NvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgZ2V0Qm9va01vdmUgY2FsbGVkJywgeyBwbHkgfSk7CiAgICAgICAgCiAgICAgICAgLy8gVHJ5IHRvIGZpbmQgbW92ZSBmb3IgY3VycmVudCBwb3NpdGlvbgogICAgICAgIGNvbnN0IGhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKGJvYXJkKTsKICAgICAgICAvL2NvbnNvbGUubG9nKCdDdXJyZW50IHBvc2l0aW9uIGhhc2g6JywgaGFzaCk7CiAgICAgICAgCiAgICAgICAgbGV0IGVudHJ5ID0gdGhpcy5ib29rLmdldChoYXNoKTsKICAgICAgICAvL2NvbnNvbGUubG9nKCdFbnRyeSBmb3VuZCBmb3IgY3VycmVudCBoYXNoOicsIGVudHJ5ID8gZW50cnkubW92ZXMubGVuZ3RoICsgJyBtb3ZlcycgOiAnbnVsbCcpOwogICAgICAgIGlmIChlbnRyeSAmJiBlbnRyeS5tb3Zlcy5sZW5ndGggPiAwKSB7CiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdBbGwgcG9zc2libGUgYm9vayBtb3ZlcyB3aXRoIHdlaWdodHM6JywgSlNPTi5zdHJpbmdpZnkoZW50cnkubW92ZXMpKTsKICAgICAgICAgICAgLy8gQ2FsY3VsYXRlIHRvdGFsIHdlaWdodAogICAgICAgICAgICBjb25zdCB0b3RhbFdlaWdodCA9IGVudHJ5Lm1vdmVzLnJlZHVjZSgoc3VtLCBtb3ZlKSA9PiBzdW0gKyBtb3ZlLndlaWdodCwgMCk7CiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdUb3RhbCB3ZWlnaHQ6JywgdG90YWxXZWlnaHQpOwogICAgICAgIH0KICAgICAgICAKICAgICAgICBsZXQgbWlycm9yZWRNb3ZlID0gZmFsc2U7CgogICAgICAgIC8vIElmIG5vdCBmb3VuZCwgdHJ5IG1pcnJvcmVkIHBvc2l0aW9uCiAgICAgICAgaWYgKCFlbnRyeSB8fCBlbnRyeS5tb3Zlcy5sZW5ndGggPT09IDApIHsKICAgICAgICAgICAgY29uc3QgbWlycm9yZWRCb2FyZCA9IHRoaXMuaGFzaGVyLm1pcnJvckJvYXJkKGJvYXJkKTsKICAgICAgICAgICAgY29uc3QgbWlycm9yZWRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChtaXJyb3JlZEJvYXJkKTsKICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIGVudHJ5IGZvdW5kLCB0cnlpbmcgbWlycm9yZWQgcG9zaXRpb246JywgbWlycm9yZWRIYXNoKTsKICAgICAgICAgICAgCiAgICAgICAgICAgIGVudHJ5ID0gdGhpcy5ib29rLmdldChtaXJyb3JlZEhhc2gpOwogICAgICAgICAgICBpZiAoZW50cnkgJiYgZW50cnkubW92ZXMubGVuZ3RoID4gMCkgewogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnRW50cnkgZm91bmQgZm9yIG1pcnJvcmVkIGhhc2g6JywgZW50cnkubW92ZXMubGVuZ3RoICsgJyBtb3ZlcycpOwogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnT3JpZ2luYWwgbWlycm9yIG1vdmVzOicsIEpTT04uc3RyaW5naWZ5KGVudHJ5Lm1vdmVzKSk7CiAgICAgICAgICAgICAgICBtaXJyb3JlZE1vdmUgPSB0cnVlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnTm8gZW50cnkgZm91bmQgZm9yIG1pcnJvcmVkIGhhc2gnKTsKICAgICAgICAgICAgfQogICAgICAgIH0KCiAgICAgICAgaWYgKCFlbnRyeSB8fCBlbnRyeS5tb3Zlcy5sZW5ndGggPT09IDApIHsKICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnT3BlbmluZyBib29rIG1vdmUgbm90IGZvdW5kIGZvciBjdXJyZW50IHBvc2l0aW9uJyk7CiAgICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgIH0KCiAgICAgICAgLy8gU2VsZWN0IG1vdmUgYmFzZWQgb24gd2VpZ2h0cwogICAgICAgIGNvbnN0IHNlbGVjdGVkTW92ZSA9IHRoaXMuc2VsZWN0V2VpZ2h0ZWRNb3ZlKGVudHJ5Lm1vdmVzKTsKICAgICAgICBjb25zb2xlLmxvZygnT3BlbmluZyBib29rIG1vdmUgc2VsZWN0ZWQ6Jywgc2VsZWN0ZWRNb3ZlKTsKICAgICAgICAKICAgICAgICAvLyBJZiB3ZSB1c2VkIG1pcnJvcmVkIHBvc2l0aW9uLCBtaXJyb3IgdGhlIG1vdmUgYmFjawogICAgICAgIGlmIChzZWxlY3RlZE1vdmUgJiYgbWlycm9yZWRNb3ZlKSB7CiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdTZWxlY3RlZCBtaXJyb3IgbW92ZSBiZWZvcmUgY29udmVyc2lvbjonLCBKU09OLnN0cmluZ2lmeShzZWxlY3RlZE1vdmUpKTsKICAgICAgICAgICAgY29uc3QgbWlycm9yZWRNb3ZlQ29udmVydGVkID0gdGhpcy5oYXNoZXIubWlycm9yTW92ZShzZWxlY3RlZE1vdmUpOwogICAgICAgICAgICAvLyBjb25zb2xlLmxvZygnQ29udmVydGVkIG1pcnJvciBtb3ZlOicsIEpTT04uc3RyaW5naWZ5KG1pcnJvcmVkTW92ZUNvbnZlcnRlZCkpOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIG1pcnJvcmVkIG1vdmUgaGFzIHZhbGlkIHN0cnVjdHVyZQogICAgICAgICAgICBpZiAobWlycm9yZWRNb3ZlQ29udmVydGVkICYmIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tICYmIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50byAmJgogICAgICAgICAgICAgICAgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbS5jID09PSAnbnVtYmVyJyAmJgogICAgICAgICAgICAgICAgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvLmMgPT09ICdudW1iZXInKSB7CiAgICAgICAgICAgICAgICByZXR1cm4gbWlycm9yZWRNb3ZlQ29udmVydGVkOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ01pcnJvcmVkIG1vdmUgaGFzIGludmFsaWQgc3RydWN0dXJlLCByZXR1cm5pbmcgbnVsbCcpOwogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7CiAgICAgICAgICAgIH0KICAgICAgICB9IGVsc2UgaWYgKHNlbGVjdGVkTW92ZSkgewogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgc2VsZWN0ZWQgbW92ZSBoYXMgdmFsaWQgc3RydWN0dXJlCiAgICAgICAgICAgIGlmIChzZWxlY3RlZE1vdmUuZnJvbSAmJiBzZWxlY3RlZE1vdmUudG8gJiYKICAgICAgICAgICAgICAgIHR5cGVvZiBzZWxlY3RlZE1vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLmZyb20uYyA9PT0gJ251bWJlcicgJiYKICAgICAgICAgICAgICAgIHR5cGVvZiBzZWxlY3RlZE1vdmUudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIHNlbGVjdGVkTW92ZS50by5jID09PSAnbnVtYmVyJykgewogICAgICAgICAgICAgICAgcmV0dXJuIHNlbGVjdGVkTW92ZTsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZWxlY3RlZCBtb3ZlIGhhcyBpbnZhbGlkIHN0cnVjdHVyZSwgcmV0dXJuaW5nIG51bGwnKTsKICAgICAgICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIAogICAgICAgIHJldHVybiBudWxsOwogICAgfQoKICAgIC8qKgogICAgICogU2VsZWN0IGEgbW92ZSByYW5kb21seSBiYXNlZCBvbiB3ZWlnaHRzCiAgICAgKiBIaWdoZXIgd2VpZ2h0ID0gbW9yZSBsaWtlbHkgdG8gYmUgc2VsZWN0ZWQKICAgICAqLwogICAgc2VsZWN0V2VpZ2h0ZWRNb3ZlKG1vdmVzKSB7CiAgICAgICAgLy8gQ2FsY3VsYXRlIHRvdGFsIHdlaWdodAogICAgICAgIGNvbnN0IHRvdGFsV2VpZ2h0ID0gbW92ZXMucmVkdWNlKChzdW0sIG1vdmUpID0+IHN1bSArIG1vdmUud2VpZ2h0LCAwKTsKCiAgICAgICAgLy8gR2VuZXJhdGUgcmFuZG9tIG51bWJlcgogICAgICAgIGxldCByYW5kb20gPSBNYXRoLnJhbmRvbSgpICogdG90YWxXZWlnaHQ7CgogICAgICAgIC8vIFNlbGVjdCBtb3ZlCiAgICAgICAgZm9yIChjb25zdCBtb3ZlIG9mIG1vdmVzKSB7CiAgICAgICAgICAgIHJhbmRvbSAtPSBtb3ZlLndlaWdodDsKICAgICAgICAgICAgaWYgKHJhbmRvbSA8PSAwKSB7CiAgICAgICAgICAgICAgICByZXR1cm4gewogICAgICAgICAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmUudG8uciwgYzogbW92ZS50by5jIH0KICAgICAgICAgICAgICAgIH07CiAgICAgICAgICAgIH0KICAgICAgICB9CgogICAgICAgIC8vIEZhbGxiYWNrIChzaG91bGQgbmV2ZXIgcmVhY2ggaGVyZSkKICAgICAgICByZXR1cm4gewogICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmVzWzBdLmZyb20uciwgYzogbW92ZXNbMF0uZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmVzWzBdLnRvLnIsIGM6IG1vdmVzWzBdLnRvLmMgfQogICAgICAgIH07CiAgICB9CgogICAgLyoqCiAgICAgKiBIZWxwZXIgdG8gY3JlYXRlIGluaXRpYWwgYm9hcmQgKG5lZWRlZCBmb3IgYm9vayBpbml0aWFsaXphdGlvbikKICAgICAqLwogICAgY3JlYXRlSW5pdGlhbEJvYXJkKCkgewogICAgICAgIGNvbnN0IGJvYXJkID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkpOwogICAgICAgIAogICAgICAgIC8vIFJlZCBwaWVjZXMgKGJvdHRvbSAtIHI9MC0yKQogICAgICAgIGJvYXJkWzBdWzBdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAncmVkJyB9OwogICAgICAgIGJvYXJkWzBdWzFdID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFswXVsyXSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbMF1bM10gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbMF1bNF0gPSB7IHR5cGU6ICdnZW5lcmFsJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbMF1bNV0gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbMF1bNl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAncmVkJyB9OwogICAgICAgIGJvYXJkWzBdWzddID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFswXVs4XSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFsyXVsxXSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAncmVkJyB9OwogICAgICAgIGJvYXJkWzJdWzddID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbM11bMF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbM11bMl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbM11bNF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbM11bNl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbM11bOF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07CgogICAgICAgIC8vIEJsYWNrIHBpZWNlcyAodG9wIC0gcj03LTkpCiAgICAgICAgYm9hcmRbOV1bMF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVsxXSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVsyXSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVszXSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzldWzRdID0geyB0eXBlOiAnZ2VuZXJhbCcsIGNvbG9yOiAnYmxhY2snIH07CiAgICAgICAgYm9hcmRbOV1bNV0gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVs2XSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVs3XSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVs4XSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzddWzFdID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs3XVs3XSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAnYmxhY2snIH07CiAgICAgICAgYm9hcmRbNl1bMF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs2XVsyXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzZdWzRdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07CiAgICAgICAgYm9hcmRbNl1bNl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs2XVs4XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9OwoKICAgICAgICByZXR1cm4gYm9hcmQ7CiAgICB9CgogICAgLyoqCiAgICAgKiBFbmFibGUgb3IgZGlzYWJsZSBvcGVuaW5nIGJvb2sKICAgICAqLwogICAgc2V0RW5hYmxlZChlbmFibGVkKSB7CiAgICAgICAgdGhpcy5lbmFibGVkID0gZW5hYmxlZDsKICAgIH0KCiAgICAvKioKICAgICAqIENoZWNrIGlmIG9wZW5pbmcgYm9vayBpcyBlbmFibGVkCiAgICAgKi8KICAgIGlzRW5hYmxlZCgpIHsKICAgICAgICByZXR1cm4gdGhpcy5lbmFibGVkOwogICAgfQoKICAgIC8qKgogICAgICogR2V0IHN0YXRpc3RpY3MgYWJvdXQgdGhlIG9wZW5pbmcgYm9vawogICAgICovCiAgICBnZXRTdGF0cygpIHsKICAgICAgICBsZXQgdG90YWxNb3ZlcyA9IDA7CiAgICAgICAgdGhpcy5ib29rLmZvckVhY2goZW50cnkgPT4gewogICAgICAgICAgICB0b3RhbE1vdmVzICs9IGVudHJ5Lm1vdmVzLmxlbmd0aDsKICAgICAgICB9KTsKCiAgICAgICAgcmV0dXJuIHsKICAgICAgICAgICAgcG9zaXRpb25zOiB0aGlzLmJvb2suc2l6ZSwKICAgICAgICAgICAgdG90YWxNb3ZlcwogICAgICAgIH07CiAgICB9CgogICAgLyoqCiAgICAgKiBBZGQgb3BlbmluZyBsaW5lIGZyb20gdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbgogICAgICogQHBhcmFtIG5vdGF0aW9uIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbiAoZS5nLiwgWyfngq7kuozlubPkupQnLCAn6amsOOi/mzcnXSkKICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIGFycmF5IG9mIHdlaWdodHMgZm9yIGVhY2ggbW92ZQogICAgICovCiAgICBhZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihub3RhdGlvbiwgd2VpZ2h0cykgewogICAgICAgIC8vIENvbnZlcnQgdHJhZGl0aW9uYWwgbm90YXRpb24gdG8gY29vcmRpbmF0ZSBmb3JtYXQKICAgICAgICBjb25zdCBtb3ZlcyA9IHRoaXMubm90YXRpb25Ub01vdmVzKG5vdGF0aW9uKTsKICAgICAgICAvLyBBZGQgdGhlIG1vdmVzIHRvIHRoZSBvcGVuaW5nIGJvb2sKICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lKG1vdmVzLCB3ZWlnaHRzKTsKICAgIH0KCiAgICAvKioKICAgICAqIEFkZCBvcGVuaW5nIGxpbmUgZnJvbSBzdHJpbmcgd2l0aCBzcGFjZS1zZXBhcmF0ZWQgdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbgogICAgICogQHBhcmFtIG5vdGF0aW9uQXJyYXkgQXJyYXkgb2Ygc3RyaW5ncywgZWFjaCBjb250YWluaW5nIHNwYWNlLXNlcGFyYXRlZCBtb3ZlcyAoZS5nLiwgWyfngq7kuozlubPkupQg6amsOOi/mzcg6L2m5LiA5bmz5LqMJ10pCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCBhcnJheSBvZiB3ZWlnaHRzIGZvciBlYWNoIG1vdmUKICAgICAqLwogICAgYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKG5vdGF0aW9uQXJyYXksIHdlaWdodHMpIHsKICAgICAgICAvLyBQcm9jZXNzIGVhY2ggc3RyaW5nIGluIHRoZSBhcnJheQogICAgICAgIGlmICghbm90YXRpb25BcnJheSB8fCAhQXJyYXkuaXNBcnJheShub3RhdGlvbkFycmF5KSB8fCBub3RhdGlvbkFycmF5Lmxlbmd0aCA9PT0gMCkgewogICAgICAgICAgICByZXR1cm47CiAgICAgICAgfQogICAgICAgIG5vdGF0aW9uQXJyYXkuZm9yRWFjaChub3RhdGlvblN0cmluZyA9PiB7CiAgICAgICAgICAgIC8vIFNwbGl0IHRoZSBzdHJpbmcgYnkgc3BhY2VzIHRvIGdldCBpbmRpdmlkdWFsIG1vdmVzCiAgICAgICAgICAgIGNvbnN0IG5vdGF0aW9uID0gbm90YXRpb25TdHJpbmcuc3BsaXQoJyAnKS5maWx0ZXIobW92ZSA9PiBtb3ZlLnRyaW0oKSAhPT0gJycpOwogICAgICAgICAgICAvLyBDYWxsIGV4aXN0aW5nIGZ1bmN0aW9uIHRvIGFkZCB0aGUgbGluZQogICAgICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKG5vdGF0aW9uLCB3ZWlnaHRzKTsKICAgICAgICB9KTsKICAgIH0KCiAgICAvKioKICAgICAqIENvbnZlcnQgY29vcmRpbmF0ZS1iYXNlZCBtb3ZlcyB0byB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uCiAgICAgKiBAcGFyYW0gYm9hcmRIaXN0b3J5IEFycmF5IG9mIGJvYXJkIHN0YXRlcyByZXByZXNlbnRpbmcgdGhlIGdhbWUgaGlzdG9yeQogICAgICogQHBhcmFtIG1vdmVIaXN0b3J5IEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0CiAgICAgKiBAcmV0dXJucyBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24KICAgICAqLwogICAgbW92ZXNUb05vdGF0aW9uKGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkpIHsKICAgICAgICBjb25zdCBub3RhdGlvbiA9IFtdOwogICAgICAgIGxldCBjdXJyZW50Q29sb3IgPSAncmVkJzsgLy8gUmVkIG1vdmVzIGZpcnN0CgogICAgICAgIC8vIFR5cGUgdG8gcGllY2UgY2hhcmFjdGVyIG1hcHBpbmcKICAgICAgICBjb25zdCB0eXBlVG9QaWVjZSA9IHsKICAgICAgICAgICAgJ2dlbmVyYWwnOiB7ICdyZWQnOiAn5biFJywgJ2JsYWNrJzogJ+WwhicgfSwKICAgICAgICAgICAgJ2Fkdmlzb3InOiB7ICdyZWQnOiAn5LuVJywgJ2JsYWNrJzogJ+WjqycgfSwKICAgICAgICAgICAgJ2VsZXBoYW50JzogeyAncmVkJzogJ+ebuCcsICdibGFjayc6ICfosaEnIH0sCiAgICAgICAgICAgICdob3JzZSc6IHsgJ3JlZCc6ICfpqawnLCAnYmxhY2snOiAn6amsJyB9LAogICAgICAgICAgICAnY2hhcmlvdCc6IHsgJ3JlZCc6ICfovaYnLCAnYmxhY2snOiAn6L2mJyB9LAogICAgICAgICAgICAnY2Fubm9uJzogeyAncmVkJzogJ+eCricsICdibGFjayc6ICfngq4nIH0sCiAgICAgICAgICAgICdzb2xkaWVyJzogeyAncmVkJzogJ+WFtScsICdibGFjayc6ICfljZInIH0KICAgICAgICB9OwoKICAgICAgICAvLyBDb2x1bW4gbWFwcGluZyAoY29vcmRpbmF0ZSAwLTggdG8gdHJhZGl0aW9uYWwg5LmdLeS4gCBmb3IgcmVkLCA5LTEgZm9yIGJsYWNrKQogICAgICAgIGNvbnN0IGNvbFRvQ2hpbmVzZSA9IFsn5LmdJywgJ+WFqycsICfkuIMnLCAn5YWtJywgJ+S6lCcsICflm5snLCAn5LiJJywgJ+S6jCcsICfkuIAnXTsKICAgICAgICBjb25zdCBjb2xUb0FyYWJpYyA9IFsnOScsICc4JywgJzcnLCAnNicsICc1JywgJzQnLCAnMycsICcyJywgJzEnXTsKCiAgICAgICAgLy8gRGlnaXQgdG8gQ2hpbmVzZSBudW1iZXIgbWFwcGluZyBmb3Igc3RlcHMKICAgICAgICBjb25zdCBkaWdpdFRvQ2hpbmVzZSA9IFsnJywgJ+S4gCcsICfkuownLCAn5LiJJywgJ+WbmycsICfkupQnLCAn5YWtJywgJ+S4gycsICflhasnLCAn5LmdJ107CgogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiB0aGVyZSBhcmUgbXVsdGlwbGUgc2FtZS10eXBlIHBpZWNlcyBpbiB0aGUgc2FtZSBjb2x1bW4KICAgICAgICBjb25zdCBoYXNTYW1lVHlwZUluQ29sdW1uID0gKGJvYXJkLCBwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGV4Y2x1ZGVSb3cpID0+IHsKICAgICAgICAgICAgbGV0IGNvdW50ID0gMDsKICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NvbF07CiAgICAgICAgICAgICAgICBpZiAociA9PT0gZXhjbHVkZVJvdykgY29udGludWU7CiAgICAgICAgICAgICAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gcGllY2VUeXBlICYmIHBpZWNlLmNvbG9yID09PSBjb2xvcikgewogICAgICAgICAgICAgICAgICAgIGNvdW50Kys7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgcmV0dXJuIGNvdW50ID4gMDsKICAgICAgICB9OwoKICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZGV0ZXJtaW5lIGZyb250L2JhY2sgbWFya2VyCiAgICAgICAgY29uc3QgZ2V0RnJvbnRCYWNrTWFya2VyID0gKGJvYXJkLCBwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGN1cnJlbnRSb3cpID0+IHsKICAgICAgICAgICAgY29uc3Qgc2FtZVR5cGVQaWVjZXMgPSBbXTsKICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NvbF07CiAgICAgICAgICAgICAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gcGllY2VUeXBlICYmIHBpZWNlLmNvbG9yID09PSBjb2xvcikgewogICAgICAgICAgICAgICAgICAgIHNhbWVUeXBlUGllY2VzLnB1c2gocik7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgaWYgKHNhbWVUeXBlUGllY2VzLmxlbmd0aCA8PSAxKSByZXR1cm4gJyc7CiAgICAgICAgICAgIGlmIChjb2xvciA9PT0gJ3JlZCcpIHsKICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8iHI9Ny0577yJ77yMcuWAvOi2iuWkp+i2iumdoOi/keaVjOaWue+8jOaYryLliY0iCiAgICAgICAgICAgICAgICBjb25zdCBzb3J0ZWRSb3dzID0gWy4uLnNhbWVUeXBlUGllY2VzXS5zb3J0KChhLCBiKSA9PiBiIC0gYSk7IC8vIEhpZ2hlciByb3dzIGZpcnN0ID0gY2xvc2VyIHRvIG9wcG9uZW50CiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkUm93c1swXSA9PT0gY3VycmVudFJvdyA/ICfliY0nIDogJ+WQjic7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIhyPTAtMu+8ie+8jHLlgLzotorlsI/otorpnaDov5HmlYzmlrnvvIzmmK8i5YmNIgogICAgICAgICAgICAgICAgY29uc3Qgc29ydGVkUm93cyA9IFsuLi5zYW1lVHlwZVBpZWNlc10uc29ydCgoYSwgYikgPT4gYSAtIGIpOyAvLyBMb3dlciByb3dzIGZpcnN0ID0gY2xvc2VyIHRvIG9wcG9uZW50CiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkUm93c1swXSA9PT0gY3VycmVudFJvdyA/ICfliY0nIDogJ+WQjic7CiAgICAgICAgICAgIH0KICAgICAgICB9OwoKICAgICAgICAvLyBQcm9jZXNzIGVhY2ggbW92ZQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW92ZUhpc3RvcnkubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVIaXN0b3J5W2ldOwogICAgICAgICAgICBjb25zdCBib2FyZEJlZm9yZSA9IGJvYXJkSGlzdG9yeVtpXTsKICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZEJlZm9yZVttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOwogICAgICAgICAgICAKICAgICAgICAgICAgaWYgKCFwaWVjZSkgewogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gcGllY2UgZm91bmQgYXQgZnJvbSBwb3NpdGlvbjonLCBtb3ZlLmZyb20pOwogICAgICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlLnR5cGU7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlQ2hhciA9IHR5cGVUb1BpZWNlW3BpZWNlVHlwZV1bcGllY2UuY29sb3JdOwogICAgICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlIGFyZSBtdWx0aXBsZSBzYW1lLXR5cGUgcGllY2VzIGluIHRoZSBzYW1lIGNvbHVtbgogICAgICAgICAgICBjb25zdCBoYXNEdXBsaWNhdGUgPSBoYXNTYW1lVHlwZUluQ29sdW1uKGJvYXJkQmVmb3JlLCBwaWVjZVR5cGUsIHBpZWNlLmNvbG9yLCBtb3ZlLmZyb20uYywgbW92ZS5mcm9tLnIpOwogICAgICAgICAgICAvLyBHZXQgZnJvbnQvYmFjayBtYXJrZXIgaWYgbmVlZGVkCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uTWFya2VyID0gaGFzRHVwbGljYXRlID8gZ2V0RnJvbnRCYWNrTWFya2VyKGJvYXJkQmVmb3JlLCBwaWVjZVR5cGUsIHBpZWNlLmNvbG9yLCBtb3ZlLmZyb20uYywgbW92ZS5mcm9tLnIpIDogJyc7CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBEZXRlcm1pbmUgbm90YXRpb24gYmFzZWQgb24gcGllY2UgdHlwZSBhbmQgbW92ZSBkaXJlY3Rpb24KICAgICAgICAgICAgbGV0IG5vdGF0aW9uU3RyOwogICAgICAgICAgICAKICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2hvcnNlJyB8fCBwaWVjZVR5cGUgPT09ICdhZHZpc29yJyB8fCBwaWVjZVR5cGUgPT09ICdlbGVwaGFudCcpIHsKICAgICAgICAgICAgICAgIC8vIERpYWdvbmFsIG1vdmluZyBwaWVjZXMgLSBvbmx5IHVzZSDov5sv6YCALCByZWNvcmQgdGFyZ2V0IGNvbHVtbgogICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY10gfHwgJyc7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS50by5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6L+b77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+mAgAogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IG1vdmUudG8uciA+IG1vdmUuZnJvbS5yID8gJ+i/mycgOiAn6YCAJzsKICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3RvQ29sfWA7CiAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhAogICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdIHx8ICcnOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUudG8uY10gfHwgJyc7CiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yIcj0w77yJ77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+i/m++8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/pgIAKICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSBtb3ZlLnRvLnIgPCBtb3ZlLmZyb20uciA/ICfov5snIDogJ+mAgCc7CiAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt0b0NvbH1gOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnIHx8IHBpZWNlVHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHBpZWNlVHlwZSA9PT0gJ2Nhbm5vbicgfHwgcGllY2VUeXBlID09PSAnc29sZGllcicpIHsKICAgICAgICAgICAgICAgIC8vIFN0cmFpZ2h0IG1vdmluZyBwaWVjZXMgLSDov5sv6YCAL+W5swogICAgICAgICAgICAgICAgaWYgKG1vdmUuZnJvbS5jID09PSBtb3ZlLnRvLmMpIHsKICAgICAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBtb3ZlIC0g6L+bL+mAgAogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXBzID0gTWF0aC5hYnMobW92ZS50by5yIC0gbW92ZS5mcm9tLnIpOwogICAgICAgICAgICAgICAgICAgIC8vIOi/m+aYr+mdoOi/keaVjOaWueeahOaWueWQke+8jOmAgOaYr+i/nOemu+aVjOaWueeahOaWueWQkQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/ov5vvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6YCACiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+i/m++8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/pgIAKICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSAoaXNSZWQgPyBtb3ZlLnRvLnIgPiBtb3ZlLmZyb20uciA6IG1vdmUudG8uciA8IG1vdmUuZnJvbS5yKSA/ICfov5snIDogJ+mAgCc7CiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdOwogICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgc3RlcHMgaXMgYSB2YWxpZCBudW1iZXIgYmV0d2VlbiAxLTkKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsaWRTdGVwcyA9IE1hdGgubWF4KDEsIE1hdGgubWluKDksIE1hdGgucm91bmQoc3RlcHMgfHwgMSkpKTsKICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHtkaWdpdFRvQ2hpbmVzZVt2YWxpZFN0ZXBzXSB8fCAnJ31gOwogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhAogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXTsKICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHN0ZXBzIGlzIGEgdmFsaWQgbnVtYmVyCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkU3RlcHMgPSBNYXRoLnJvdW5kKHN0ZXBzIHx8IDEpOwogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3ZhbGlkU3RlcHN9YDsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgbW92ZSAtIOW5swogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS50by5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x95bmzJHt0b0NvbH1gOwogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhAogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS50by5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x95bmzJHt0b0NvbH1gOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1Vua25vd24gcGllY2UgdHlwZTonLCBwaWVjZVR5cGUpOwogICAgICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgICAgIG5vdGF0aW9uLnB1c2gobm90YXRpb25TdHIpOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8gU3dpdGNoIGNvbG9yIGZvciBuZXh0IG1vdmUKICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgICAgICB9CiAgICAgICAgCiAgICAgICAgcmV0dXJuIG5vdGF0aW9uOwogICAgfQoKICAgIC8qKgogICAgICogQ29udmVydCB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uIHRvIGNvb3JkaW5hdGUgbW92ZXMKICAgICAqIEBwYXJhbSBub3RhdGlvbiBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24KICAgICAqIEByZXR1cm5zIEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0CiAgICAgKi8KICAgIG5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvbiwgaW5pdGlhbEJvYXJkID0gbnVsbCkgewogICAgICAgIC8vIOehruS/nW5vdGF0aW9u5piv5pWw57uE5LiU5LiN5Li656m6CiAgICAgICAgaWYgKCFub3RhdGlvbiB8fCAhQXJyYXkuaXNBcnJheShub3RhdGlvbikgfHwgbm90YXRpb24ubGVuZ3RoID09PSAwKSB7CiAgICAgICAgICAgIHJldHVybiBbXTsKICAgICAgICB9CiAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsKICAgICAgICBsZXQgY3VycmVudENvbG9yID0gJ3JlZCc7IC8vIFJlZCBtb3ZlcyBmaXJzdAoKICAgICAgICAvLyBQaWVjZSBjaGFyYWN0ZXIgdG8gdHlwZSBtYXBwaW5nCiAgICAgICAgY29uc3QgcGllY2VNYXAgPSB7CiAgICAgICAgICAgICflsIYnOiAnZ2VuZXJhbCcsICfluIUnOiAnZ2VuZXJhbCcsCiAgICAgICAgICAgICflo6snOiAnYWR2aXNvcicsICfku5UnOiAnYWR2aXNvcicsCiAgICAgICAgICAgICfosaEnOiAnZWxlcGhhbnQnLCAn55u4JzogJ2VsZXBoYW50JywKICAgICAgICAgICAgJ+mprCc6ICdob3JzZScsCiAgICAgICAgICAgICfovaYnOiAnY2hhcmlvdCcsCiAgICAgICAgICAgICfngq4nOiAnY2Fubm9uJywKICAgICAgICAgICAgJ+WNkic6ICdzb2xkaWVyJywgJ+WFtSc6ICdzb2xkaWVyJwogICAgICAgIH07CgogICAgICAgIC8vIENvbHVtbiBtYXBwaW5nICh0cmFkaXRpb25hbCBub3RhdGlvbiB1c2VzIDEtOSBmcm9tIHJpZ2h0IHRvIGxlZnQpCiAgICAgICAgY29uc3QgY29sTWFwID0gewogICAgICAgICAgICAn5LiAJzogOCwgJzEnOiA4LAogICAgICAgICAgICAn5LqMJzogNywgJzInOiA3LAogICAgICAgICAgICAn5LiJJzogNiwgJzMnOiA2LAogICAgICAgICAgICAn5ZubJzogNSwgJzQnOiA1LAogICAgICAgICAgICAn5LqUJzogNCwgJzUnOiA0LAogICAgICAgICAgICAn5YWtJzogMywgJzYnOiAzLAogICAgICAgICAgICAn5LiDJzogMiwgJzcnOiAyLAogICAgICAgICAgICAn5YWrJzogMSwgJzgnOiAxLAogICAgICAgICAgICAn5LmdJzogMCwgJzknOiAwCiAgICAgICAgfTsKCiAgICAgICAgLy8gQ2hpbmVzZSBudW1iZXIgdG8gZGlnaXQgbWFwcGluZwogICAgICAgIGNvbnN0IGNoaW5lc2VOdW1iZXJNYXAgPSB7CiAgICAgICAgICAgICfkuIAnOiAxLCAnMSc6IDEsCiAgICAgICAgICAgICfkuownOiAyLCAnMic6IDIsCiAgICAgICAgICAgICfkuIknOiAzLCAnMyc6IDMsCiAgICAgICAgICAgICflm5snOiA0LCAnNCc6IDQsCiAgICAgICAgICAgICfkupQnOiA1LCAnNSc6IDUsCiAgICAgICAgICAgICflha0nOiA2LCAnNic6IDYsCiAgICAgICAgICAgICfkuIMnOiA3LCAnNyc6IDcsCiAgICAgICAgICAgICflhasnOiA4LCAnOCc6IDgsCiAgICAgICAgICAgICfkuZ0nOiA5LCAnOSc6IDkKICAgICAgICB9OwoKICAgICAgICAvLyBJbml0aWFsIHBvc2l0aW9ucyBvZiBwaWVjZXMgKHJlZCBhbmQgYmxhY2spCiAgICAgICAgLy8g5L+u5aSN77ya5LiO5paw5Z2Q5qCH57O757uf5L+d5oyB5LiA6Ie077yM57qi5pa55Zyo5bqV6YOo77yIcj0wLTLvvInvvIzpu5HmlrnlnKjpobbpg6jvvIhyPTctOe+8iQogICAgICAgIGNvbnN0IGRlZmF1bHRJbml0aWFsUG9zaXRpb25zID0gewogICAgICAgICAgICAncmVkLWdlbmVyYWwnOiB7IHI6IDAsIGM6IDQgfSwKICAgICAgICAgICAgJ3JlZC1hZHZpc29yJzogW3sgcjogMCwgYzogMyB9LCB7IHI6IDAsIGM6IDUgfV0sCiAgICAgICAgICAgICdyZWQtZWxlcGhhbnQnOiBbeyByOiAwLCBjOiAyIH0sIHsgcjogMCwgYzogNiB9XSwKICAgICAgICAgICAgJ3JlZC1ob3JzZSc6IFt7IHI6IDAsIGM6IDEgfSwgeyByOiAwLCBjOiA3IH1dLAogICAgICAgICAgICAncmVkLWNoYXJpb3QnOiBbeyByOiAwLCBjOiAwIH0sIHsgcjogMCwgYzogOCB9XSwKICAgICAgICAgICAgJ3JlZC1jYW5ub24nOiBbeyByOiAyLCBjOiAxIH0sIHsgcjogMiwgYzogNyB9XSwKICAgICAgICAgICAgJ3JlZC1zb2xkaWVyJzogW3sgcjogMywgYzogMCB9LCB7IHI6IDMsIGM6IDIgfSwgeyByOiAzLCBjOiA0IH0sIHsgcjogMywgYzogNiB9LCB7IHI6IDMsIGM6IDggfV0sCiAgICAgICAgICAgICdibGFjay1nZW5lcmFsJzogeyByOiA5LCBjOiA0IH0sCiAgICAgICAgICAgICdibGFjay1hZHZpc29yJzogW3sgcjogOSwgYzogMyB9LCB7IHI6IDksIGM6IDUgfV0sCiAgICAgICAgICAgICdibGFjay1lbGVwaGFudCc6IFt7IHI6IDksIGM6IDIgfSwgeyByOiA5LCBjOiA2IH1dLAogICAgICAgICAgICAnYmxhY2staG9yc2UnOiBbeyByOiA5LCBjOiAxIH0sIHsgcjogOSwgYzogNyB9XSwKICAgICAgICAgICAgJ2JsYWNrLWNoYXJpb3QnOiBbeyByOiA5LCBjOiAwIH0sIHsgcjogOSwgYzogOCB9XSwKICAgICAgICAgICAgJ2JsYWNrLWNhbm5vbic6IFt7IHI6IDcsIGM6IDEgfSwgeyByOiA3LCBjOiA3IH1dLAogICAgICAgICAgICAnYmxhY2stc29sZGllcic6IFt7IHI6IDYsIGM6IDAgfSwgeyByOiA2LCBjOiAyIH0sIHsgcjogNiwgYzogNCB9LCB7IHI6IDYsIGM6IDYgfSwgeyByOiA2LCBjOiA4IH1dCiAgICAgICAgfTsKCiAgICAgICAgLy8gVHJhY2sgcGllY2UgcG9zaXRpb25zIGFzIG1vdmVzIGFyZSBtYWRlCiAgICAgICAgbGV0IHBpZWNlUG9zaXRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShkZWZhdWx0SW5pdGlhbFBvc2l0aW9ucykpOwogICAgICAgIAogICAgICAgIC8vIElmIGluaXRpYWwgYm9hcmQgaXMgcHJvdmlkZWQsIGluaXRpYWxpemUgcGllY2UgcG9zaXRpb25zIGZyb20gaXQKICAgICAgICBpZiAoaW5pdGlhbEJvYXJkKSB7CiAgICAgICAgICAgIC8vIFJlc2V0IHBpZWNlIHBvc2l0aW9ucyBiYXNlZCBvbiBpbml0aWFsIGJvYXJkCiAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zID0gewogICAgICAgICAgICAgICAgJ3JlZC1nZW5lcmFsJzogeyByOiAtMSwgYzogLTEgfSwKICAgICAgICAgICAgICAgICdyZWQtYWR2aXNvcic6IFtdLAogICAgICAgICAgICAgICAgJ3JlZC1lbGVwaGFudCc6IFtdLAogICAgICAgICAgICAgICAgJ3JlZC1ob3JzZSc6IFtdLAogICAgICAgICAgICAgICAgJ3JlZC1jaGFyaW90JzogW10sCiAgICAgICAgICAgICAgICAncmVkLWNhbm5vbic6IFtdLAogICAgICAgICAgICAgICAgJ3JlZC1zb2xkaWVyJzogW10sCiAgICAgICAgICAgICAgICAnYmxhY2stZ2VuZXJhbCc6IHsgcjogLTEsIGM6IC0xIH0sCiAgICAgICAgICAgICAgICAnYmxhY2stYWR2aXNvcic6IFtdLAogICAgICAgICAgICAgICAgJ2JsYWNrLWVsZXBoYW50JzogW10sCiAgICAgICAgICAgICAgICAnYmxhY2staG9yc2UnOiBbXSwKICAgICAgICAgICAgICAgICdibGFjay1jaGFyaW90JzogW10sCiAgICAgICAgICAgICAgICAnYmxhY2stY2Fubm9uJzogW10sCiAgICAgICAgICAgICAgICAnYmxhY2stc29sZGllcic6IFtdCiAgICAgICAgICAgIH07CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBQb3B1bGF0ZSBwaWVjZSBwb3NpdGlvbnMgZnJvbSBpbml0aWFsIGJvYXJkCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgewogICAgICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGluaXRpYWxCb2FyZFtyXVtjXTsKICAgICAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7cGllY2UuY29sb3J9LSR7cGllY2UudHlwZX1gOwogICAgICAgICAgICAgICAgICAgICAgICBpZiAocGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1trZXldID0geyByLCBjIH07CiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1trZXldLnB1c2goeyByLCBjIH0pOwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQoKICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZmluZCBwaWVjZSBwb3NpdGlvbgogICAgICAgIGNvbnN0IGZpbmRQaWVjZVBvc2l0aW9uID0gKHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgZGlyZWN0aW9uLCBmcm9udEJhY2tNYXJrZXIgPSBudWxsKSA9PiB7CiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbG9yfS0ke3BpZWNlVHlwZX1gOwogICAgICAgICAgICBjb25zdCBwb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1trZXldOwoKICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcG9zaXRpb25zIGV4aXN0IGFuZCBhcmUgdmFsaWQKICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnMpIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIHBvc2l0aW9ucyBmb3VuZCBmb3IgcGllY2U6Jywga2V5KTsKICAgICAgICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgICAgICB9CgogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcpIHsKICAgICAgICAgICAgICAgIHJldHVybiBwb3NpdGlvbnM7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIC8vIEZpbmQgcGllY2VzIG9uIHRoZSBzcGVjaWZpZWQgY29sdW1uCiAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBwb3NpdGlvbnMuZmlsdGVyKHBvcyA9PiBwb3MuYyA9PT0gY29sKTsKCiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkgewogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gY2FuZGlkYXRlcyBmb3VuZCBmb3IgcGllY2U6Jywga2V5LCAnb24gY29sdW1uOicsIGNvbCk7CiAgICAgICAgICAgICAgICAvLyBBZGRpdGlvbmFsIGRlYnVnIGluZm8gZm9yIGNhbm5vbgogICAgICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2Nhbm5vbicgJiYgY29sb3IgPT09ICdibGFjaycpIHsKICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnREVCVUc6IENhbmRpZGF0ZXMgYWZ0ZXIgZmlsdGVyOicsIGNhbmRpZGF0ZXMpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMSkgewogICAgICAgICAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZXNbMF07CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIC8vIElmIGZyb250L2JhY2sgbWFya2VyIGlzIHByb3ZpZGVkLCB1c2UgaXQgdG8gZGV0ZXJtaW5lIHRoZSBwaWVjZQogICAgICAgICAgICBpZiAoZnJvbnRCYWNrTWFya2VyID09PSAn5YmNJykgewogICAgICAgICAgICAgICAgLy8g5YmN54Ku77ya6Z2g6L+R5pWM5pa555qE5qOL5a2QCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJpy5YC86L6D5aSn55qE5pu06Z2g6L+R5pWM5pa577yI5YmN77yJCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJpy5YC86L6D5bCP55qE5pu06Z2g6L+R5pWM5pa577yI5YmN77yJCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6CiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsKICAgICAgICAgICAgfSBlbHNlIGlmIChmcm9udEJhY2tNYXJrZXIgPT09ICflkI4nKSB7CiAgICAgICAgICAgICAgICAvLyDlkI7ngq7vvJrpnaDov5Hlt7HmlrnnmoTmo4vlrZAKICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8mnLlgLzovoPlsI/nmoTmm7TpnaDov5Hlt7HmlrnvvIjlkI7vvIkKICAgICAgICAgICAgICAgIC8vIOm7keaWue+8mnLlgLzovoPlpKfnmoTmm7TpnaDov5Hlt7HmlrnvvIjlkI7vvIkKICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyAKICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoKICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOwogICAgICAgICAgICB9CgogICAgICAgICAgICAvLyBJZiBtdWx0aXBsZSBwaWVjZXMgb24gdGhlIHNhbWUgY29sdW1uIGFuZCBubyBtYXJrZXIsIGRldGVybWluZSBiYXNlZCBvbiBkaXJlY3Rpb24KICAgICAgICAgICAgLy8g5a+55LqO5ZCM5LiA5YiX55qE5qOL5a2Q77yM6YCa6L+H5q+U6L6DcuWAvOadpeWMuuWIhgogICAgICAgICAgICBpZiAoZGlyZWN0aW9uID09PSAn6L+bJykgewogICAgICAgICAgICAgICAgLy8g6L+b5piv5ZCR5pWM5pa55pa55ZCR56e75Yqo77yM5omA5Lul6YCJ5oup5pu06Z2g6L+R5bex5pa555qE5qOL5a2Q77yI5ZCO77yJCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6CiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsKICAgICAgICAgICAgfSBlbHNlIGlmIChkaXJlY3Rpb24gPT09ICfpgIAnKSB7CiAgICAgICAgICAgICAgICAvLyDpgIDmmK/lkJHlt7HmlrnmlrnlkJHnp7vliqjvvIzmiYDku6XpgInmi6nmm7TpnaDov5HmlYzmlrnnmoTmo4vlrZDvvIjliY3vvIkKICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyAKICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoKICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOwogICAgICAgICAgICB9CgogICAgICAgICAgICByZXR1cm4gY2FuZGlkYXRlc1swXTsgLy8gRGVmYXVsdCB0byBmaXJzdCBpZiBkaXJlY3Rpb24gaXMgJ+W5sycgYW5kIG5vIG1hcmtlcgogICAgICAgIH07CgogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byB1cGRhdGUgcGllY2UgcG9zaXRpb24KICAgICAgICBjb25zdCB1cGRhdGVQaWVjZVBvc2l0aW9uID0gKHBpZWNlVHlwZSwgY29sb3IsIG9sZFBvcywgbmV3UG9zKSA9PiB7CiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbG9yfS0ke3BpZWNlVHlwZX1gOwogICAgICAgICAgICBjb25zdCBwb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1trZXldOwoKICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcG9zaXRpb25zIGV4aXN0IGFuZCBhcmUgdmFsaWQKICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnMpIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogTm8gcG9zaXRpb25zIGZvdW5kIGZvciBwaWVjZTonLCBrZXkpOwogICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICB9CgogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcpIHsKICAgICAgICAgICAgICAgIHBvc2l0aW9ucy5yID0gbmV3UG9zLnI7CiAgICAgICAgICAgICAgICBwb3NpdGlvbnMuYyA9IG5ld1Bvcy5jOwogICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICB9CgogICAgICAgICAgICBjb25zdCBpbmRleCA9IHBvc2l0aW9ucy5maW5kSW5kZXgocG9zID0+IHBvcy5yID09PSBvbGRQb3MuciAmJiBwb3MuYyA9PT0gb2xkUG9zLmMpOwogICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKSB7CiAgICAgICAgICAgICAgICBwb3NpdGlvbnNbaW5kZXhdLnIgPSBuZXdQb3MucjsKICAgICAgICAgICAgICAgIHBvc2l0aW9uc1tpbmRleF0uYyA9IG5ld1Bvcy5jOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBDb3VsZCBub3QgZmluZCBwaWVjZSBwb3NpdGlvbiB0byB1cGRhdGU6Jywgb2xkUG9zLCAnaW4nLCBwb3NpdGlvbnMpOwogICAgICAgICAgICB9CiAgICAgICAgfTsKCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIHBvc2l0aW9uIGlzIHZhbGlkCiAgICAgICAgY29uc3QgaXNWYWxpZFBvcyA9IChyLCBjKSA9PiByID49IDAgJiYgciA8IDEwICYmIGMgPj0gMCAmJiBjIDwgOTsKCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBob3JzZSBtb3ZlcwogICAgICAgIGNvbnN0IGdldEhvcnNlTW92ZXMgPSAocG9zKSA9PiB7CiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107CiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107CiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOwogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWwogICAgICAgICAgICAgICAgeyBkcjogLTIsIGRjOiAtMSB9LCB7IGRyOiAtMiwgZGM6IDEgfSwKICAgICAgICAgICAgICAgIHsgZHI6IC0xLCBkYzogLTIgfSwgeyBkcjogLTEsIGRjOiAyIH0sCiAgICAgICAgICAgICAgICB7IGRyOiAxLCBkYzogLTIgfSwgeyBkcjogMSwgZGM6IDIgfSwKICAgICAgICAgICAgICAgIHsgZHI6IDIsIGRjOiAtMSB9LCB7IGRyOiAyLCBkYzogMSB9CiAgICAgICAgICAgIF07CgogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgaG9yc2UgY2FuIG1vdmUgaW4gdGhlIGRpcmVjdGlvbgogICAgICAgICAgICBjb25zdCBjYW5Nb3ZlID0gKGJsb2NrZWRSLCBibG9ja2VkQykgPT4gewogICAgICAgICAgICAgICAgaWYgKCFpc1ZhbGlkUG9zKHIgKyBibG9ja2VkUiwgYyArIGJsb2NrZWRDKSkgcmV0dXJuIGZhbHNlOwogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7CiAgICAgICAgICAgIH07CgogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0sIGluZGV4KSA9PiB7CiAgICAgICAgICAgICAgICBjb25zdCBibG9ja2VkUiA9IGRyID4gMCA/IDEgOiBkciA8IDAgPyAtMSA6IDA7CiAgICAgICAgICAgICAgICBjb25zdCBibG9ja2VkQyA9IGRjID4gMCA/IDEgOiBkYyA8IDAgPyAtMSA6IDA7CiAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBwYXRoIGlzIGJsb2NrZWQKICAgICAgICAgICAgICAgIGlmICgoaW5kZXggPCAyIHx8IGluZGV4ID49IDYpICYmIGJsb2NrZWRSICE9PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgLy8gVmVydGljYWwgYmxvY2tlZAogICAgICAgICAgICAgICAgICAgIGlmICghY2FuTW92ZShibG9ja2VkUiwgMCkpIHJldHVybjsKICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoYmxvY2tlZEMgIT09IDApIHsKICAgICAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIGJsb2NrZWQKICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbk1vdmUoMCwgYmxvY2tlZEMpKSByZXR1cm47CiAgICAgICAgICAgICAgICB9CgogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsKICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7CiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSkgewogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9KTsKCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsKICAgICAgICB9OwoKICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGVsZXBoYW50IG1vdmVzCiAgICAgICAgY29uc3QgZ2V0RWxlcGhhbnRNb3ZlcyA9IChwb3MsIGNvbG9yKSA9PiB7CiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107CiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107CiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOwogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWwogICAgICAgICAgICAgICAgeyBkcjogLTIsIGRjOiAtMiB9LCB7IGRyOiAtMiwgZGM6IDIgfSwKICAgICAgICAgICAgICAgIHsgZHI6IDIsIGRjOiAtMiB9LCB7IGRyOiAyLCBkYzogMiB9CiAgICAgICAgICAgIF07CgogICAgICAgICAgICAvLyBFbGVwaGFudCdzIHRlcnJpdG9yeSAtIHJlZCBlbGVwaGFudHMgY2FuIG9ubHkgYmUgaW4gcjw9NCwgYmxhY2sgZWxlcGhhbnRzIGluIHI+PTUKICAgICAgICAgICAgY29uc3QgaXNJblRlcnJpdG9yeSA9IChyKSA9PiB7CiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gciA8PSA0IDogciA+PSA1OwogICAgICAgICAgICB9OwoKICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9KSA9PiB7CiAgICAgICAgICAgICAgICBjb25zdCBtaWRSID0gciArIGRyIC8gMjsKICAgICAgICAgICAgICAgIGNvbnN0IG1pZEMgPSBjICsgZGMgLyAyOwogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsKICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7CgogICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgbWlkIHBvc2l0aW9uIGlzIGVtcHR5IGFuZCBuZXcgcG9zaXRpb24gaXMgdmFsaWQKICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG1pZFIsIG1pZEMpICYmIGlzVmFsaWRQb3MobmV3UiwgbmV3QykgJiYgaXNJblRlcnJpdG9yeShuZXdSKSkgewogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9KTsKCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsKICAgICAgICB9OwoKICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGFkdmlzb3IgbW92ZXMKICAgICAgICBjb25zdCBnZXRBZHZpc29yTW92ZXMgPSAocG9zLCBjb2xvcikgPT4gewogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOwogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOwogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsKICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsKICAgICAgICAgICAgICAgIHsgZHI6IC0xLCBkYzogLTEgfSwgeyBkcjogLTEsIGRjOiAxIH0sCiAgICAgICAgICAgICAgICB7IGRyOiAxLCBkYzogLTEgfSwgeyBkcjogMSwgZGM6IDEgfQogICAgICAgICAgICBdOwoKICAgICAgICAgICAgLy8gQWR2aXNvcidzIHRlcnJpdG9yeSAocGFsYWNlKSAtIHJlZCBhZHZpc29ycyBpbiByPTAtMixjPTMtNSwgYmxhY2sgYWR2aXNvcnMgaW4gcj03LTksYz0zLTUKICAgICAgICAgICAgY29uc3QgaXNJblBhbGFjZSA9IChyLCBjKSA9PiB7CiAgICAgICAgICAgICAgICBjb25zdCByUmFuZ2UgPSBjb2xvciA9PT0gJ3JlZCcgPyBbMCwgMl0gOiBbNywgOV07CiAgICAgICAgICAgICAgICByZXR1cm4gciA+PSByUmFuZ2VbMF0gJiYgciA8PSByUmFuZ2VbMV0gJiYgYyA+PSAzICYmIGMgPD0gNTsKICAgICAgICAgICAgfTsKCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSkgPT4gewogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsKICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7CiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSAmJiBpc0luUGFsYWNlKG5ld1IsIG5ld0MpKSB7CiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0pOwoKICAgICAgICAgICAgcmV0dXJuIG1vdmVzOwogICAgICAgIH07CgogICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBib2FyZCB0byB0cmFjayBtb3ZlcwogICAgICAgIGxldCB0ZW1wQm9hcmQgPSB0aGlzLmNyZWF0ZUluaXRpYWxCb2FyZCgpOwogICAgICAgIAogICAgICAgIC8vIEVuc3VyZSB0ZW1wQm9hcmQgaXMgcHJvcGVybHkgaW5pdGlhbGl6ZWQKICAgICAgICBpZiAoIXRlbXBCb2FyZCB8fCB0ZW1wQm9hcmQubGVuZ3RoICE9PSAxMCkgewogICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIGJvYXJkIGluaXRpYWxpemF0aW9uJyk7CiAgICAgICAgICAgIHJldHVybiBbXTsKICAgICAgICB9CiAgICAgICAgCiAgICAgICAgLy8gVmVyaWZ5IGFsbCByb3dzIGhhdmUgOSBjb2x1bW5zCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDsgaSsrKSB7CiAgICAgICAgICAgIGlmICghdGVtcEJvYXJkW2ldIHx8IHRlbXBCb2FyZFtpXS5sZW5ndGggIT09IDkpIHsKICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtpXSA9IEFycmF5KDkpLmZpbGwobnVsbCk7CiAgICAgICAgICAgIH0KICAgICAgICB9CgogICAgICAgIGNvbnNvbGUubG9nKCdUb3RhbCBtb3ZlczonLCBub3RhdGlvbi5sZW5ndGgpOwogICAgICAgIG5vdGF0aW9uLmZvckVhY2gobW92ZU5vdGF0aW9uID0+IHsKCgogICAgICAgICAgICAKICAgICAgICAgICAgLy8gUGFyc2UgdGhlIG1vdmUgbm90YXRpb24gLSBrZWVwIGxhc3QgZ3JvdXAgb3B0aW9uYWwKICAgICAgICAgICAgY29uc3QgcmVnZXggPSAvKFvliY3lkI5dKT8oW+WwhuW4heWjq+S7leixoeebuOmprOi9pueCruWFteWNkl0pKFvkuIDkuozkuInlm5vkupTlha3kuIPlhavkuZ0xMjM0NTY3ODldKShb6L+b6YCA5bmzXSkoW+S4gOS6jOS4ieWbm+S6lOWFreS4g+WFq+S5nTEyMzQ1Njc4OV0pPy87CiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gbW92ZU5vdGF0aW9uLm1hdGNoKHJlZ2V4KTsKCiAgICAgICAgICAgIGlmICghbWF0Y2gpIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgbW92ZSBub3RhdGlvbjonLCBtb3ZlTm90YXRpb24pOwogICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICB9CgogICAgICAgICAgICBjb25zdCBbLCBmcm9udEJhY2tNYXJrZXIsIHBpZWNlQ2hhciwgZnJvbUNvbE5vdGF0aW9uLCBkaXJlY3Rpb24sIHRvQ29sT3JTdGVwTm90YXRpb25dID0gbWF0Y2g7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlTWFwW3BpZWNlQ2hhcl07CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBHZXQgY29sdW1uIG1hcHBpbmcgYmFzZWQgb24gY3VycmVudCBjb2xvciAoYmxhY2sgc2VlcyBjb2x1bW5zIG1pcnJvcmVkKQogICAgICAgICAgICBsZXQgZnJvbUNvbCA9IGNvbE1hcFtmcm9tQ29sTm90YXRpb25dOwogICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7CiAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sgKGZyb20gYmxhY2sncyBwZXJzcGVjdGl2ZSkKICAgICAgICAgICAgICAgIGZyb21Db2wgPSA4IC0gZnJvbUNvbDsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgLy8gRmluZCB0aGUgY3VycmVudCBwb3NpdGlvbiBvZiB0aGUgcGllY2UKICAgICAgICAgICAgY29uc3QgZnJvbVBvcyA9IGZpbmRQaWVjZVBvc2l0aW9uKHBpZWNlVHlwZSwgY3VycmVudENvbG9yLCBmcm9tQ29sLCBkaXJlY3Rpb24sIGZyb250QmFja01hcmtlcik7CgogICAgICAgICAgICBpZiAoIWZyb21Qb3MpIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBmaW5kIHBpZWNlIHBvc2l0aW9uIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIGxldCB0b1BvczsKCiAgICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT09ICflubMnKSB7CiAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIG1vdmVtZW50CiAgICAgICAgICAgICAgICBsZXQgdG9Db2wgPSBjb2xNYXBbdG9Db2xPclN0ZXBOb3RhdGlvbl07CiAgICAgICAgICAgICAgICBpZiAodG9Db2wgPT09IHVuZGVmaW5lZCkgewogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbjonLCB0b0NvbE9yU3RlcE5vdGF0aW9uLCAnZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsKICAgICAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjayB3aGVuIG1vdmluZyBob3Jpem9udGFsbHkKICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsKICAgICAgICAgICAgICAgICAgICB0b0NvbCA9IDggLSB0b0NvbDsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgdG9Qb3MgPSB7IHI6IGZyb21Qb3MuciwgYzogdG9Db2wgfTsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIG9yIGRpYWdvbmFsIG1vdmVtZW50CiAgICAgICAgICAgICAgICBjb25zdCBzdGVwcyA9IGNoaW5lc2VOdW1iZXJNYXBbdG9Db2xPclN0ZXBOb3RhdGlvbl07CiAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgaWYgKHN0ZXBzID09PSB1bmRlZmluZWQpIHsKICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHN0ZXAgY291bnQ6JywgdG9Db2xPclN0ZXBOb3RhdGlvbiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdob3JzZScpIHsKICAgICAgICAgICAgICAgICAgICAvLyBIb3JzZSBtb3ZlcyBpbiBMLXNoYXBlCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEhvcnNlTW92ZXMoZnJvbVBvcyk7CiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOwogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOwogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGhvcnNlOicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOwogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjawogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsKICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsKICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZGlyZWN0aW9uIChyb3cpCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbk1hdGNoID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IAogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoKICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsKICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgY29sdW1uCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsKICAgICAgICAgICAgICAgICAgICB9KTsKICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnZWxlcGhhbnQnKSB7CiAgICAgICAgICAgICAgICAgICAgLy8gRWxlcGhhbnQgbW92ZXMgZGlhZ29uYWxseSAyIHN0ZXBzCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEVsZXBoYW50TW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsKICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247CiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07CiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgZWxlcGhhbnQ6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgewogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbgogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gewogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykKICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOgogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOwogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOwogICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdhZHZpc29yJykgewogICAgICAgICAgICAgICAgICAgIC8vIEFkdmlzb3IgbW92ZXMgZGlhZ29uYWxseSAxIHN0ZXAKICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0QWR2aXNvck1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7CiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOwogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOwogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGFkdmlzb3I6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgewogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbgogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gewogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykKICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOgogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOwogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOwogICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAvLyBTdHJhaWdodCBsaW5lIG1vdmVtZW50IChjaGFyaW90LCBjYW5ub24sIHNvbGRpZXIpCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXAgPSBkaXJlY3Rpb24gPT09ICfov5snID8gKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAxIDogLTEpICogc3RlcHMgOgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IC0xIDogMSkgKiBzdGVwczsKICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gZnJvbVBvcy5yICsgc3RlcDsKICAgICAgICAgICAgICAgICAgICBpZiAobmV3UiA8IDAgfHwgbmV3UiA+PSAxMCkgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHJvdyBwb3NpdGlvbiBhZnRlciBtb3ZlOicsIG5ld1IsICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOwogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0geyByOiBuZXdSLCBjOiBmcm9tUG9zLmMgfTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQoKICAgICAgICAgICAgaWYgKCF0b1BvcykgewogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignQ291bGQgbm90IGRldGVybWluZSB0YXJnZXQgcG9zaXRpb24gZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsKICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgLy8gQWRkIHRoZSBtb3ZlIHRvIHRoZSBsaXN0CiAgICAgICAgICAgIG1vdmVzLnB1c2goeyBmcm9tOiB7IHI6IGZyb21Qb3MuciwgYzogZnJvbVBvcy5jIH0sIHRvOiB7IHI6IHRvUG9zLnIsIGM6IHRvUG9zLmMgfSB9KTsKCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlJ3MgYSBjYXB0dXJlZCBwaWVjZQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZFBpZWNlID0gdGVtcEJvYXJkW3RvUG9zLnJdW3RvUG9zLmNdOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8gSWYgdGhlcmUncyBhIGNhcHR1cmVkIHBpZWNlLCByZW1vdmUgaXQgZnJvbSBwaWVjZVBvc2l0aW9ucwogICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgewogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBgJHtjYXB0dXJlZFBpZWNlLmNvbG9yfS0ke2NhcHR1cmVkUGllY2UudHlwZX1gOwogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07CiAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgIGlmIChjYXB0dXJlZFBvc2l0aW9ucykgewogICAgICAgICAgICAgICAgICAgIC8vIOWwhi/luIXkuI3kvJrooqvlkIPmjonvvIzmiYDku6Xlj6rlpITnkIblhbbku5bmo4vlrZAKICAgICAgICAgICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZS50eXBlICE9PSAnZ2VuZXJhbCcpIHsKICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmVtb3ZlIHRoZSBjYXB0dXJlZCBwb3NpdGlvbiBmcm9tIHRoZSBhcnJheQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjYXB0dXJlZFBvc2l0aW9ucykpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHVwZGF0ZWRQb3NpdGlvbnMgPSBjYXB0dXJlZFBvc2l0aW9ucy5maWx0ZXIocG9zID0+IAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiAocG9zLnIgIT09IHRvUG9zLnIgfHwgcG9zLmMgIT09IHRvUG9zLmMpCiAgICAgICAgICAgICAgICAgICAgICAgICAgICApOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgcGllY2VQb3NpdGlvbnNbY2FwdHVyZWRLZXldID0gdXBkYXRlZFBvc2l0aW9uczsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVmVyaWZ5IHJlbW92YWwgd2FzIHN1Y2Nlc3NmdWwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0aWxsRXhpc3RzID0gdXBkYXRlZFBvc2l0aW9ucy5zb21lKHBvcyA9PiAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgcG9zLnIgPT09IHRvUG9zLnIgJiYgcG9zLmMgPT09IHRvUG9zLmMKICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoc3RpbGxFeGlzdHMpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IENhcHR1cmVkIHBpZWNlIHN0aWxsIGV4aXN0cyBpbiBwaWVjZVBvc2l0aW9ucyEnKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ+KchSBTVUNDRVNTOiBDYXB0dXJlZCBwaWVjZSByZW1vdmVkIGZyb20gcGllY2VQb3NpdGlvbnMnKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogVW5leHBlY3RlZCBub24tYXJyYXkgcG9zaXRpb25zIGZvciBwaWVjZTonLCBjYXB0dXJlZEtleSk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogTm8gcG9zaXRpb25zIGZvdW5kIGZvciBjYXB0dXJlZCBwaWVjZTonLCBjYXB0dXJlZEtleSk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIFZlcmlmeSB0aGUgY2FwdHVyZWQgcGllY2UgaGFzIGJlZW4gcmVtb3ZlZAogICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgewogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBgJHtjYXB0dXJlZFBpZWNlLmNvbG9yfS0ke2NhcHR1cmVkUGllY2UudHlwZX1gOwogICAgICAgICAgICAgICAgY29uc3QgZmluYWxQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07CiAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaW5hbFBvc2l0aW9ucykpIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGlsbEV4aXN0cyA9IGZpbmFsUG9zaXRpb25zLnNvbWUocG9zID0+IAogICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgcG9zLnIgPT09IHRvUG9zLnIgJiYgcG9zLmMgPT09IHRvUG9zLmMKICAgICAgICAgICAgICAgICAgICApOwogICAgICAgICAgICAgICAgICAgIGlmIChzdGlsbEV4aXN0cykgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFUlJPUjogQ2FwdHVyZWQgcGllY2Ugc3RpbGwgZXhpc3RzIGluIHBpZWNlUG9zaXRpb25zOicsIGNhcHR1cmVkUGllY2UsICdhdCcsIHRvUG9zKTsKICAgICAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU1VDQ0VTUzogQ2FwdHVyZWQgcGllY2UgcmVtb3ZlZCBmcm9tIHBpZWNlUG9zaXRpb25zJyk7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBNYWtlIHRoZSBtb3ZlIG9uIHRoZSB0ZW1wb3JhcnkgYm9hcmQgZmlyc3QgYmVmb3JlIHVwZGF0aW5nIHBpZWNlIHBvc2l0aW9ucwogICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhmcm9tUG9zLnIsIGZyb21Qb3MuYykgJiYgaXNWYWxpZFBvcyh0b1Bvcy5yLCB0b1Bvcy5jKSAmJiAKICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtmcm9tUG9zLnJdICYmIHRlbXBCb2FyZFt0b1Bvcy5yXSkgewogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSB0ZW1wQm9hcmRbZnJvbVBvcy5yXVtmcm9tUG9zLmNdOwogICAgICAgICAgICAgICAgdGVtcEJvYXJkW3RvUG9zLnJdW3RvUG9zLmNdID0gcGllY2U7CiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbZnJvbVBvcy5yXVtmcm9tUG9zLmNdID0gbnVsbDsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogSW52YWxpZCBwb3NpdGlvbnMgZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uLCBmcm9tUG9zLCB0b1Bvcyk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgcGllY2UgcG9zaXRpb24gaW4gcGllY2VQb3NpdGlvbnMKICAgICAgICAgICAgdXBkYXRlUGllY2VQb3NpdGlvbihwaWVjZVR5cGUsIGN1cnJlbnRDb2xvciwgZnJvbVBvcywgdG9Qb3MpOwogICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgLy8gU3dpdGNoIGNvbG9yIGZvciBuZXh0IG1vdmUKICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgICAgICB9KTsKCiAgICAgICAgcmV0dXJuIG1vdmVzOwogICAgfQp9CgovLyAtLS0gQ29uc3RhbnRzIC0tLQoKLy8gSW5pdGlhbGl6ZSBPcGVuaW5nIEJvb2sKY29uc3Qgb3BlbmluZ0Jvb2sgPSBuZXcgT3BlbmluZ0Jvb2soMTIpOwoKY29uc3QgaXNWYWxpZFBvcyA9IChyLCBjKSA9PiByID49IDAgJiYgciA8IFJPV1MgJiYgYyA+PSAwICYmIGMgPCBDT0xTOwoKLy8g5qih5Z2X57qn5Lyq5ZCI5rOV6JC954K577yI6YG/5YWNIGdldFBpZWNlTW92ZXMg5q+P6LCD55So5paw5bu66Zet5YyF77yJCmNvbnN0IHB1c2hQc2V1ZG9EZXN0ID0gKGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCB0ciwgdGMpID0+IHsKICBpZiAodHIgPCAwIHx8IHRyID49IFJPV1MgfHwgdGMgPCAwIHx8IHRjID49IENPTFMpIHJldHVybjsKICBjb25zdCB0YXJnZXQgPSBib2FyZFt0cl1bdGNdOwogIGlmICghdGFyZ2V0IHx8IHRhcmdldC5jb2xvciAhPT0gcGllY2VDb2xvcikgewogICAgbW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsKICB9IGVsc2UgaWYgKGFsbGllc091dCAmJiB0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7CiAgICBhbGxpZXNPdXQucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsKICB9Cn07CgovLyBhbGxpZXNPdXQ6IOWPr+mAie+8jOaUtumbhuWPr+S/neaKpOeahOW3seaWueiQveeCue+8iOS4jeWQq+WwhuW4he+8ie+8jOS+m+WFs+ezu+iuoeeul+WkjeeUqO+8jOmBv+WFjeS6jOasoeWwhOe6vwpjb25zdCBnZXRQaWVjZU1vdmVzID0gKGJvYXJkLCBwb3MsIHBpZWNlLCBhbGxpZXNPdXQgPSBudWxsKSA9PiB7CiAgY29uc3QgbW92ZXMgPSBbXTsKICBjb25zdCB7IHIsIGMgfSA9IHBvczsKICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsKICBjb25zdCBwaWVjZUNvbG9yID0gcGllY2UuY29sb3I7CiAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOwogIGNvbnN0IGZyb21TcSA9IHIgKiA5ICsgYzsKCiAgc3dpdGNoIChwaWVjZS50eXBlKSB7CiAgICBjYXNlICdnZW5lcmFsJzogewogICAgICBjb25zdCBkZXN0cyA9IEdFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsKICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOwogICAgICB9CiAgICAgIGJyZWFrOwogICAgfQogICAgY2FzZSAnYWR2aXNvcic6IHsKICAgICAgY29uc3QgZGVzdHMgPSBBRFZJU09SX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07CiAgICAgICAgcHVzaFBzZXVkb0Rlc3QoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIGQuciwgZC5jKTsKICAgICAgfQogICAgICBicmVhazsKICAgIH0KICAgIGNhc2UgJ2VsZXBoYW50JzogewogICAgICBjb25zdCBkZXN0cyA9IEVMRVBIQU5UX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07CiAgICAgICAgaWYgKGJvYXJkW2QuYnJdW2QuYmNdID09PSBudWxsKSB7CiAgICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOwogICAgICAgIH0KICAgICAgfQogICAgICBicmVhazsKICAgIH0KICAgIGNhc2UgJ2hvcnNlJzogewogICAgICBjb25zdCBkZXN0cyA9IEhPUlNFX0RFU1RbZnJvbVNxXTsKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsKICAgICAgICBpZiAoYm9hcmRbZC5icl1bZC5iY10gPT09IG51bGwpIHsKICAgICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7CiAgICAgICAgfQogICAgICB9CiAgICAgIGJyZWFrOwogICAgfQogICAgY2FzZSAnY2hhcmlvdCc6CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOwogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7CiAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTKSB7CiAgICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFtucl1bbmNdOwogICAgICAgICAgaWYgKHRhcmdldCA9PT0gbnVsbCkgewogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgaWYgKHRhcmdldC5jb2xvciAhPT0gcGllY2VDb2xvcikgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgZWxzZSBpZiAoYWxsaWVzT3V0ICYmIHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIGFsbGllc091dC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICAgIH0KICAgICAgICAgIG5yICs9IGRyOyBuYyArPSBkYzsKICAgICAgICB9CiAgICAgIH0KICAgICAgYnJlYWs7CiAgICBjYXNlICdjYW5ub24nOgogICAgICAvLyDnnYDms5Xku43lj6rlkKvmlYzmlrnpmpTmiZPvvJvlt7HmlrnpmpTmiZPkv53miqTnlLEgZmlsbENhbm5vblJlbGF0aW9ucyDnu5/kuIDlpITnkIYKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07CiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsKICAgICAgICBsZXQgc2NyZWVuRm91bmQgPSBmYWxzZTsKICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMpIHsKICAgICAgICAgIGlmICghc2NyZWVuRm91bmQpIHsKICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIHsKICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgIHNjcmVlbkZvdW5kID0gdHJ1ZTsKICAgICAgICAgICAgfQogICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gIT09IG51bGwpIHsKICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXS5jb2xvciAhPT0gcGllY2VDb2xvcikgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgfQogICAgICAgICAgfQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOwogICAgICAgIH0KICAgICAgfQogICAgICBicmVhazsKICAgIGNhc2UgJ3NvbGRpZXInOiB7CiAgICAgIGNvbnN0IGRlc3RzID0gU09MRElFUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOwogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOwogICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7CiAgICAgIH0KICAgICAgYnJlYWs7CiAgICB9CiAgfQogIHJldHVybiBtb3ZlczsKfTsKCmNvbnN0IGlzRmx5aW5nR2VuZXJhbCA9IChib2FyZCkgPT4gewogIGNvbnN0IHJlZEcgPSBnZXRHZW5lcmFsUG9zKGJvYXJkLCAncmVkJyk7CiAgY29uc3QgYmxhY2tHID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgJ2JsYWNrJyk7CiAgaWYgKCFyZWRHIHx8ICFibGFja0cgfHwgcmVkRy5jICE9PSBibGFja0cuYykgcmV0dXJuIGZhbHNlOwogIAogIC8vIOehruS/neW+queOr+aWueWQkeato+ehru+8jOS7jui+g+Wwj+eahHLliLDovoPlpKfnmoRyCiAgY29uc3Qgc3RhcnRSID0gTWF0aC5taW4oYmxhY2tHLnIsIHJlZEcucikgKyAxOwogIGNvbnN0IGVuZFIgPSBNYXRoLm1heChibGFja0cuciwgcmVkRy5yKSAtIDE7CiAgCiAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsKICAgIGlmIChib2FyZFtyXVtyZWRHLmNdICE9PSBudWxsKSByZXR1cm4gZmFsc2U7CiAgfQogIHJldHVybiB0cnVlOwp9OwoKLy8g5pegIGJvYXJkSW5mbyDml7bnmoTlv6vpgJ/lsIblhpvmo4DmtYvvvJrlsIbkvY3nvJPlrZggKyDku47lsIbkvY3lm5vlkJHlsITnur/vvIjovaYv5bCGL+eCruWQiOW5tu+8iQpjb25zdCBpc0NoZWNrUmF3ID0gKGJvYXJkLCBjb2xvcikgPT4gewogICAgY29uc3QgZ2VuZXJhbFBvcyA9IGdldEdlbmVyYWxQb3MoYm9hcmQsIGNvbG9yKTsKICAgIGlmICghZ2VuZXJhbFBvcykgcmV0dXJuIHRydWU7CgogICAgY29uc3QgZW5lbXlDb2xvciA9IGNvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgIGNvbnN0IHsgcjogZ3IsIGM6IGdjIH0gPSBnZW5lcmFsUG9zOwoKICAgIC8vIOebtOe6v++8muesrOS4gOWtkOS4uuaVjOi9pi/lsIbliJnlsIblhpvvvJvotorov4fngq7mnrblkI7nrKzkuozlrZDkuLrmlYzngq7liJnlsIblhpsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOwogICAgICAgIGxldCBuciA9IGdyICsgZHI7CiAgICAgICAgbGV0IG5jID0gZ2MgKyBkYzsKICAgICAgICBsZXQgc2VlbiA9IDA7CgogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsKICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107CiAgICAgICAgICAgIGlmIChwKSB7CiAgICAgICAgICAgICAgICBzZWVuKys7CiAgICAgICAgICAgICAgICBpZiAoc2VlbiA9PT0gMSkgewogICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIChwLnR5cGUgPT09ICdjaGFyaW90JyB8fCBwLnR5cGUgPT09ICdnZW5lcmFsJykpIHsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdjYW5ub24nKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICBuciArPSBkcjsKICAgICAgICAgICAgbmMgKz0gZGM7CiAgICAgICAgfQogICAgfQoKICAgIC8vIOmprO+8muS7juWwhuS9jeWPjeaOqO+8jOmprOiFv+WcqOmprOS4gOS+p++8iOS4jiBnZXRQaWVjZU1vdmVzIC8gSE9SU0VfRElSUyDkuIDoh7TvvIkKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgSE9SU0VfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGQgPSBIT1JTRV9ESVJTW2ldOwogICAgICAgIGNvbnN0IG5yID0gZ3IgKyBkLmRyOwogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkLmRjOwogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsKICAgICAgICAgICAgY29uc3QgbGVnUiA9IG5yIC0gZC5sZWdEcjsKICAgICAgICAgICAgY29uc3QgbGVnQyA9IG5jIC0gZC5sZWdEYzsKICAgICAgICAgICAgaWYgKGJvYXJkW2xlZ1JdW2xlZ0NdID09PSBudWxsKSB7CiAgICAgICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsKICAgICAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnaG9yc2UnKSB7CiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CgogICAgLy8g5aOr77yI5Lmd5a6r5YaF77yJCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IERJQUdfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGRyID0gRElBR19ESVJTW2ldWzBdLCBkYyA9IERJQUdfRElSU1tpXVsxXTsKICAgICAgICBjb25zdCBuciA9IGdyICsgZHI7CiAgICAgICAgY29uc3QgbmMgPSBnYyArIGRjOwogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYKICAgICAgICAgICAgKChjb2xvciA9PT0gJ3JlZCcgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSB8fCAoY29sb3IgPT09ICdibGFjaycgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSkgJiYKICAgICAgICAgICAgbmMgPj0gMyAmJiBuYyA8PSA1KSB7CiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOwogICAgICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ2Fkdmlzb3InKSB7CiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KCiAgICAvLyDlhbXvvJrmraPliY3mlrnlp4vnu4jlj6/mlLvvvJvlt6blj7Pku4Xov4fmsrPlhbUKICAgIGNvbnN0IGVuZW15Rm9yd2FyZCA9IGVuZW15Q29sb3IgPT09ICdyZWQnID8gMSA6IC0xOwogICAgY29uc3QgZm9yd2FyZEZyb21SID0gZ3IgLSBlbmVteUZvcndhcmQ7CiAgICBpZiAoaXNWYWxpZFBvcyhmb3J3YXJkRnJvbVIsIGdjKSkgewogICAgICAgIGNvbnN0IHAgPSBib2FyZFtmb3J3YXJkRnJvbVJdW2djXTsKICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7CiAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgIH0KICAgIH0KICAgIGZvciAoY29uc3QgZGMgb2YgWzEsIC0xXSkgewogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkYzsKICAgICAgICBpZiAoaXNWYWxpZFBvcyhnciwgbmMpKSB7CiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtncl1bbmNdOwogICAgICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7CiAgICAgICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBlbmVteUNvbG9yID09PSAncmVkJyA/IGdyID49IDUgOiBnciA8PSA0OwogICAgICAgICAgICAgICAgaWYgKGNyb3NzZWRSaXZlcikgewogICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIHJldHVybiBmYWxzZTsKfTsKCmNvbnN0IGlzQ2hlY2sgPSAoYm9hcmQsIGNvbG9yLCBwaWVjZXNJbmZvID0gbnVsbCwgYm9hcmRJbmZvID0gbnVsbCkgPT4gewogICAgLy8g5LyY5YWI5L2/55So6aKE6K6h566X55qE5bCG5Yab54q25oCBCiAgICBpZiAoYm9hcmRJbmZvKSB7CiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRJc0luQ2hlY2sgOiBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2s7CiAgICB9CgogICAgLy8g5aaC5p6c5pyJcGllY2VzSW5mb++8jOS5n+WPr+S7peS7juS4reiOt+WPluWwhuWGm+eKtuaAgQogICAgaWYgKHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7CiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IHBpZWNlc0luZm9bMF0ucmVkSXNJbkNoZWNrIDogcGllY2VzSW5mb1swXS5ibGFja0lzSW5DaGVjazsKICAgIH0KCiAgICByZXR1cm4gaXNDaGVja1Jhdyhib2FyZCwgY29sb3IpOwp9OwoKLy8g5ZCI5rOV552A5rOV77ya5Lyq5ZCI5rOVICsg5LiN6YCB5bCGL+S4jemjnuWwhu+8iG1ha2UvdW5tYWtl77yJCmNvbnN0IGdldFZhbGlkTW92ZXMgPSAoYm9hcmQsIHBvcykgPT4gewogIGNvbnN0IHBpZWNlID0gYm9hcmRbcG9zLnJdW3Bvcy5jXTsKICBpZiAoIXBpZWNlKSByZXR1cm4gW107CiAgY29uc3QgcHNldWRvTW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCBwb3MsIHBpZWNlKTsKICByZXR1cm4gZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgcG9zLCBwaWVjZSwgcHNldWRvTW92ZXMpOwp9OwoKY29uc3QgaXNWYWxpZFBsYWNlbWVudCA9ICh0eXBlLCBjb2xvciwgciwgYykgPT4gewogICAgY29uc3QgaXNSZWQgPSBjb2xvciA9PT0gJ3JlZCc7CiAgICBzd2l0Y2godHlwZSkgewogICAgICAgIGNhc2UgJ2dlbmVyYWwnOgogICAgICAgICAgICAvLyDluIXlsIblj6rog73lnKjkuZ3lrqvkuK3lv4PnmoTkuIDmnaHnur/kuIoKICAgICAgICAgICAgaWYgKGMgPCAzIHx8IGMgPiA1KSByZXR1cm4gZmFsc2U7CiAgICAgICAgICAgIGlmIChpc1JlZCkgcmV0dXJuIHIgPj0gMCAmJiByIDw9IDI7CiAgICAgICAgICAgIGVsc2UgcmV0dXJuIHIgPj0gNyAmJiByIDw9IDk7CiAgICAgICAgY2FzZSAnYWR2aXNvcic6CiAgICAgICAgICAgIC8vIOWjq+WPquiDveWcqOS5neWuq+eahDXkuKrngrnkuYvkuIAKICAgICAgICAgICAgY29uc3QgdmFsaWRBZHZpc29yUG9zaXRpb25zID0gewogICAgICAgICAgICAgICAgcmVkOiBbWzAsIDNdLCBbMCwgNV0sIFsxLCA0XSwgWzIsIDNdLCBbMiwgNV1dLAogICAgICAgICAgICAgICAgYmxhY2s6IFtbNywgM10sIFs3LCA1XSwgWzgsIDRdLCBbOSwgM10sIFs5LCA1XV0KICAgICAgICAgICAgfTsKICAgICAgICAgICAgcmV0dXJuIHZhbGlkQWR2aXNvclBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ10uc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7CiAgICAgICAgY2FzZSAnZWxlcGhhbnQnOgogICAgICAgICAgICAvLyDnm7jlj6rog73lnKjlt7HmlrnljYrlnLrnmoQ35Liq54K55LmL5LiACiAgICAgICAgICAgIGNvbnN0IHZhbGlkRWxlcGhhbnRQb3NpdGlvbnMgPSB7CiAgICAgICAgICAgICAgICByZWQ6IFtbMCwgMl0sIFswLCA2XSwgWzIsIDBdLCBbMiwgNF0sIFsyLCA4XSwgWzQsIDJdLCBbNCwgNl1dLAogICAgICAgICAgICAgICAgYmxhY2s6IFtbNSwgMl0sIFs1LCA2XSwgWzcsIDBdLCBbNywgNF0sIFs3LCA4XSwgWzksIDJdLCBbOSwgNl1dCiAgICAgICAgICAgIH07CiAgICAgICAgICAgIHJldHVybiB2YWxpZEVsZXBoYW50UG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXS5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsKICAgICAgICBjYXNlICdzb2xkaWVyJzoKICAgICAgICAgICAgLy8g5YW155qE5L2N572u6ZmQ5Yi277ya6L+H5rKz5YmN5Y+q6IO95Zyo5YG25pWw5YiX77yM6L+H5rKz5ZCO5Y+v5Lul5Zyo5Lu75L2V5YiXCiAgICAgICAgICAgIC8vIOe6ouaWueWFtei/h+ays+adoeS7tuaYr3IgPj0gNe+8jOm7keaWueWFtei/h+ays+adoeS7tuaYr3IgPD0gNAogICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBpc1JlZCA/IHIgPj0gNSA6IHIgPD0gNDsKICAgICAgICAgICAgCiAgICAgICAgICAgIGlmICghY3Jvc3NlZFJpdmVyKSB7CiAgICAgICAgICAgICAgICAvLyDov4fmsrPliY3lj6rog73lnKjlgbbmlbDliJfvvIhjPTAsMiw0LDYsOO+8iQogICAgICAgICAgICAgICAgaWYgKCFbMCwgMiwgNCwgNiwgOF0uaW5jbHVkZXMoYykpIHJldHVybiBmYWxzZTsKICAgICAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICAgICAgLy8g5YW155qE5L2N572u6ZmQ5Yi277ya6L+H5rKz5YmN5Y+q6IO95Zyo5YW15L2N5ZKM5YW15L2N5YmN5pa577yM6L+H5rKz5ZCO5pWM5pa55Y2K5Zy66YO95ZCI5rOVCiAgICAgICAgICAgIGNvbnN0IHZhbGlkU29sZGllclBvc2l0aW9ucyA9IHsKICAgICAgICAgICAgICAgIHJlZDogewogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWueWIneWni+WFteS9je+8mnI9MywgYz0wLDIsNCw2LDgKICAgICAgICAgICAgICAgICAgICBpbml0aWFsOiBbWzMsIDBdLCBbMywgMl0sIFszLCA0XSwgWzMsIDZdLCBbMywgOF1dLAogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWueWFteS9jeWJjeaWue+8mnI9NCwgYz0wLDIsNCw2LDgKICAgICAgICAgICAgICAgICAgICBmb3J3YXJkOiBbWzQsIDBdLCBbNCwgMl0sIFs0LCA0XSwgWzQsIDZdLCBbNCwgOF1dLAogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/h+ays+e6v++8mnI+PTUKICAgICAgICAgICAgICAgICAgICBjcm9zc2VkUml2ZXI6IHIgPj0gNQogICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgIGJsYWNrOiB7CiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55Yid5aeL5YW15L2N77yacj02LCBjPTAsMiw0LDYsOAogICAgICAgICAgICAgICAgICAgIGluaXRpYWw6IFtbNiwgMF0sIFs2LCAyXSwgWzYsIDRdLCBbNiwgNl0sIFs2LCA4XV0sCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55YW15L2N5YmN5pa577yacj01LCBjPTAsMiw0LDYsOAogICAgICAgICAgICAgICAgICAgIGZvcndhcmQ6IFtbNSwgMF0sIFs1LCAyXSwgWzUsIDRdLCBbNSwgNl0sIFs1LCA4XV0sCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+H5rKz57q/77yacjw9NAogICAgICAgICAgICAgICAgICAgIGNyb3NzZWRSaXZlcjogciA8PSA0CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH07CiAgICAgICAgICAgIAogICAgICAgICAgICBjb25zdCBzb2xkaWVySW5mbyA9IHZhbGlkU29sZGllclBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ107CiAgICAgICAgICAgIGNvbnN0IGlzSW5pdGlhbFBvcyA9IHNvbGRpZXJJbmZvLmluaXRpYWwuc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7CiAgICAgICAgICAgIGNvbnN0IGlzRm9yd2FyZFBvcyA9IHNvbGRpZXJJbmZvLmZvcndhcmQuc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7CiAgICAgICAgICAgIAogICAgICAgICAgICBpZiAoc29sZGllckluZm8uY3Jvc3NlZFJpdmVyKSB7CiAgICAgICAgICAgICAgICAvLyDov4fmsrPlkI7mlYzmlrnljYrlnLrpg73lkIjms5UKICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgLy8g6L+H5rKz5YmN5Y+q6IO95Zyo5YW15L2N5ZKM5YW15L2N5YmN5pa5CiAgICAgICAgICAgICAgICByZXR1cm4gaXNJbml0aWFsUG9zIHx8IGlzRm9yd2FyZFBvczsKICAgICAgICAgICAgfQogICAgICAgIGRlZmF1bHQ6CiAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgfQp9OwoKY29uc3QgY2hlY2tHYW1lU3RhdGUgPSAoYm9hcmQsIHR1cm4sIHBpZWNlc0luZm8gPSBudWxsLCBib2FyZEluZm8gPSBudWxsKSA9PiB7CiAgICAvLyDkvJjlhYjkvb/nlKjpooTorqHnrpfnmoRnYW1lU3RhdGUKICAgIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLmdhbWVTdGF0ZSkgewogICAgICAgIHJldHVybiBib2FyZEluZm8uZ2FtZVN0YXRlOwogICAgfQogICAgCiAgICAvLyDmsqHmnInpooTorqHnrpfnu5Pmnpzml7bvvIzmiafooYzljp/lp4vorqHnrpcKICAgIGxldCBoYXNNb3ZlcyA9IGZhbHNlOwogICAgZm9yKGxldCByPTA7IHI8Uk9XUzsgcisrKSB7CiAgICAgICAgZm9yKGxldCBjPTA7IGM8Q09MUzsgYysrKSB7CiAgICAgICAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsKICAgICAgICAgICAgICAgIGlmIChnZXRWYWxpZE1vdmVzKGJvYXJkLCB7cixjfSkubGVuZ3RoID4gMCkgewogICAgICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsKICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICBpZiAoaGFzTW92ZXMpIGJyZWFrOwogICAgfQoKICAgIGlmIChoYXNNb3ZlcykgcmV0dXJuIHsgc3RhdHVzOiAncGxheWluZycgfTsKCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVjayhib2FyZCwgdHVybiwgcGllY2VzSW5mbywgYm9hcmRJbmZvKTsKICAgIGNvbnN0IG9wcG9uZW50ID0gdHVybiA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7CiAgICAKICAgIGlmIChpbkNoZWNrKSB7CiAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnY2hlY2ttYXRlJywgd2lubmVyOiBvcHBvbmVudCB9OwogICAgfSBlbHNlIHsKICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07CiAgICB9Cn07CgoKCmNvbnN0IGdldEdhbWVQaGFzZSA9ICgpID0+IHsKICByZXR1cm4gJ29wZW5pbmcnOwp9OwoKLy8g5a6e5L6L5YyWWm9icmlzdEhhc2hlcgpjb25zdCB6b2JyaXN0SGFzaGVyID0gbmV3IFpvYnJpc3RIYXNoZXIoKTsKCi8vIOe9ruaNouihqOWunueOsO+8iOWuuemHj+e6piAyXjIw77yM6YG/5YWNIE1hcCDov4flpKfmi5bmhaIgR0PvvIkKY2xhc3MgVHJhbnNwb3NpdGlvblRhYmxlIHsKICAgIGNvbnN0cnVjdG9yKHNpemUgPSBNYXRoLnBvdygyLCAyMCkpIHsKICAgICAgICB0aGlzLnRhYmxlID0gbmV3IE1hcCgpOwogICAgICAgIHRoaXMuc2l6ZSA9IHNpemU7CiAgICAgICAgdGhpcy5oYXNoZXIgPSB6b2JyaXN0SGFzaGVyOwogICAgICAgIC8vIOe7n+iuoeS/oeaBrwogICAgICAgIHRoaXMuc3RhdHMgPSB7CiAgICAgICAgICAgIGhpdHM6IDAsCiAgICAgICAgICAgIG1pc3NlczogMCwKICAgICAgICAgICAgZXhhY3RIaXRzOiAwLAogICAgICAgICAgICBsb3dlcmJvdW5kSGl0czogMCwKICAgICAgICAgICAgdXBwZXJib3VuZEhpdHM6IDAsCiAgICAgICAgICAgIHN0b3JlczogMCwKICAgICAgICAgICAgbHJ1RXZpY3Rpb25zOiAwLAogICAgICAgICAgICBjbGVhcnM6IDAKICAgICAgICB9OwogICAgfQogICAgCiAgICBzdG9yZShrZXksIGRlcHRoLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUgPSBudWxsLCBtb3ZlU2VxdWVuY2UgPSBudWxsKSB7CiAgICAgICAgaWYgKHRoaXMudGFibGUuc2l6ZSA+PSB0aGlzLnNpemUpIHsKICAgICAgICAgICAgLy8g566A5Y2V55qETFJV562W55Wl77ya56e76Zmk56ys5LiA5Liq5YWD57SgCiAgICAgICAgICAgIGNvbnN0IGZpcnN0S2V5ID0gdGhpcy50YWJsZS5rZXlzKCkubmV4dCgpLnZhbHVlOwogICAgICAgICAgICB0aGlzLnRhYmxlLmRlbGV0ZShmaXJzdEtleSk7CiAgICAgICAgICAgIHRoaXMuc3RhdHMubHJ1RXZpY3Rpb25zKys7CiAgICAgICAgfQogICAgICAgIHRoaXMudGFibGUuc2V0KGtleSwgeyBkZXB0aCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlLCBtb3ZlU2VxdWVuY2UgfSk7CiAgICAgICAgdGhpcy5zdGF0cy5zdG9yZXMrKzsKICAgIH0KICAgIAogICAgcmV0cmlldmUoa2V5KSB7CiAgICAgICAgY29uc3QgZW50cnkgPSB0aGlzLnRhYmxlLmdldChrZXkpIHx8IG51bGw7CiAgICAgICAgaWYgKGVudHJ5KSB7CiAgICAgICAgICAgIHRoaXMuc3RhdHMuaGl0cysrOwogICAgICAgICAgICAvLyDnu5/orqHkuI3lkIznsbvlnovnmoTlkb3kuK0KICAgICAgICAgICAgc3dpdGNoIChlbnRyeS5mbGFnKSB7CiAgICAgICAgICAgICAgICBjYXNlICdleGFjdCc6CiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0cy5leGFjdEhpdHMrKzsKICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgIGNhc2UgJ2xvd2VyYm91bmQnOgogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMubG93ZXJib3VuZEhpdHMrKzsKICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgIGNhc2UgJ3VwcGVyYm91bmQnOgogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMudXBwZXJib3VuZEhpdHMrKzsKICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgfQogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIHRoaXMuc3RhdHMubWlzc2VzKys7CiAgICAgICAgfQogICAgICAgIHJldHVybiBlbnRyeTsKICAgIH0KICAgIAogICAgY2xlYXIoKSB7CiAgICAgICAgdGhpcy50YWJsZS5jbGVhcigpOwogICAgICAgIHRoaXMuc3RhdHMuY2xlYXJzKys7CiAgICB9CiAgICAKICAgIC8vIOiOt+WPlue7n+iuoeS/oeaBr+W5tuiuoeeul+WRveS4reeOhwogICAgZ2V0U3RhdHMoKSB7CiAgICAgICAgY29uc3QgdG90YWxBY2Nlc3NlcyA9IHRoaXMuc3RhdHMuaGl0cyArIHRoaXMuc3RhdHMubWlzc2VzOwogICAgICAgIGNvbnN0IGhpdFJhdGUgPSB0b3RhbEFjY2Vzc2VzID4gMCA/ICh0aGlzLnN0YXRzLmhpdHMgLyB0b3RhbEFjY2Vzc2VzICogMTAwKS50b0ZpeGVkKDIpIDogMDsKICAgICAgICByZXR1cm4gewogICAgICAgICAgICAuLi50aGlzLnN0YXRzLAogICAgICAgICAgICB0b3RhbEFjY2Vzc2VzLAogICAgICAgICAgICBoaXRSYXRlLAogICAgICAgICAgICBjdXJyZW50U2l6ZTogdGhpcy50YWJsZS5zaXplLAogICAgICAgICAgICBtYXhTaXplOiB0aGlzLnNpemUsCiAgICAgICAgICAgIGZpbGxQZXJjZW50YWdlOiAodGhpcy50YWJsZS5zaXplIC8gdGhpcy5zaXplICogMTAwKS50b0ZpeGVkKDIpCiAgICAgICAgfTsKICAgIH0KICAgIAogICAgLy8g6YeN572u57uf6K6h5L+h5oGvCiAgICByZXNldFN0YXRzKCkgewogICAgICAgIHRoaXMuc3RhdHMgPSB7CiAgICAgICAgICAgIGhpdHM6IDAsCiAgICAgICAgICAgIG1pc3NlczogMCwKICAgICAgICAgICAgZXhhY3RIaXRzOiAwLAogICAgICAgICAgICBsb3dlcmJvdW5kSGl0czogMCwKICAgICAgICAgICAgdXBwZXJib3VuZEhpdHM6IDAsCiAgICAgICAgICAgIHN0b3JlczogMCwKICAgICAgICAgICAgbHJ1RXZpY3Rpb25zOiAwLAogICAgICAgICAgICBjbGVhcnM6IDAKICAgICAgICB9OwogICAgfQp9CgovLyDmgKfog73nu5/orqEKbGV0IHBlcmZTdGF0cyA9IHsKICAgIGV2YWx1YXRlQm9hcmRDb3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sCiAgICBwcmVwYXJlU2VhcmNoSW5mb0NvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwKICAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwKICAgIGFscGhhQmV0YUNhbGxzOiAwLCAgLy8g5oC76LCD55So5qyh5pWwCiAgICBub2Rlc1NlYXJjaGVkOiB7fSwgLy8g5oyJ5rex5bqm57uf6K6h5pCc57Si55qE6IqC54K55pWwCiAgICBtb3Zlc0dlbmVyYXRlZDoge30sIC8vIOaMiea3seW6pue7n+iuoeeUn+aIkOeahOi1sOazleaVsAogICAgY3V0b2Zmczoge30sIC8vIOaMiea3seW6pue7n+iuoeWJquaeneasoeaVsAogICAgLy8g5ZCI5rOV5oCn6Lev5b6E77ya5Lyq5ZCI5rOV55Sf5oiQ6YeP44CB6K+V6LWw5ZCI5rOV5oCn5qOA5rWL44CB6Z2e5rOV6Lez6L+H44CB5a6e6ZmF6L+b5YWl5pCc57Si55qE5ZCI5rOV552ACiAgICBwc2V1ZG9Nb3Zlc0dlbmVyYXRlZDogMCwKICAgIGxlZ2FsaXR5Q2hlY2tzOiAwLAogICAgaWxsZWdhbE1vdmVzU2tpcHBlZDogMCwKICAgIGxlZ2FsTW92ZXNTZWFyY2hlZDogMCwKICAgIC8vIFpvYnJpc3TvvJrlhajnm5jph43nrpfmrKHmlbAgLyDlop7ph4/mm7TmlrDmrKHmlbAgLyDmoKHpqozkuI3kuIDoh7TvvIjku4UgdmVyaWZ5IOaooeW8j++8iQogICAgZnVsbEhhc2hDb3VudDogMCwKICAgIGluY3JlbWVudGFsSGFzaFVwZGF0ZXM6IDAsCiAgICBoYXNoTWlzbWF0Y2hlczogMCwKICAgIGV2YWx1YXRlQm9hcmRNczogMCwKICAgIHByZXBhcmVTZWFyY2hJbmZvTXM6IDAsCiAgICBzdGFydFRpbWU6IERhdGUubm93KCkKfTsKCi8vIOmHjee9rue7n+iuoe+8iOavj+asoeaQnOe0ouW8gOWni+aXtuiwg+eUqO+8iQpjb25zdCByZXNldFBlcmZTdGF0cyA9ICgpID0+IHsKICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsKICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50ID0geyByZWQ6IDAsIGJsYWNrOiAwIH07CiAgICBwZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsKICAgIHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscyA9IDA7CiAgICBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZCA9IHt9OwogICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkID0ge307CiAgICBwZXJmU3RhdHMuY3V0b2ZmcyA9IHt9OwogICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkID0gMDsKICAgIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcyA9IDA7CiAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCA9IDA7CiAgICBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkID0gMDsKICAgIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50ID0gMDsKICAgIHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzID0gMDsKICAgIHBlcmZTdGF0cy5oYXNoTWlzbWF0Y2hlcyA9IDA7CiAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zID0gMDsKICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zID0gMDsKICAgIHBlcmZTdGF0cy5zdGFydFRpbWUgPSBEYXRlLm5vdygpOwp9OwoKY29uc3Qgc25hcHNob3RQZXJmU3RhdHMgPSAoKSA9PiB7CiAgICBjb25zdCBlbGFwc2VkID0gRGF0ZS5ub3coKSAtIHBlcmZTdGF0cy5zdGFydFRpbWU7CiAgICBjb25zdCB0dFN0YXRzID0gdHJhbnNwb3NpdGlvblRhYmxlLmdldFN0YXRzKCk7CiAgICBjb25zdCBkZXB0aHMgPSBPYmplY3Qua2V5cyhwZXJmU3RhdHMubm9kZXNTZWFyY2hlZCkuc29ydCgoYSwgYikgPT4gTnVtYmVyKGEpIC0gTnVtYmVyKGIpKTsKICAgIGNvbnN0IGJ5RGVwdGggPSB7fTsKICAgIGZvciAoY29uc3QgZCBvZiBkZXB0aHMpIHsKICAgICAgICBieURlcHRoW2RdID0gewogICAgICAgICAgICBub2RlczogcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0gfHwgMCwKICAgICAgICAgICAgbW92ZXM6IHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSB8fCAwLAogICAgICAgICAgICBjdXRvZmZzOiBwZXJmU3RhdHMuY3V0b2Zmc1tkXSB8fCAwCiAgICAgICAgfTsKICAgIH0KICAgIHJldHVybiB7CiAgICAgICAgZWxhcHNlZE1zOiBlbGFwc2VkLAogICAgICAgIGRlZmVyTGVnYWxpdHk6IFNFQVJDSF9ERUZFUl9MRUdBTElUWSwKICAgICAgICBpbmNyZW1lbnRhbFpvYnJpc3Q6IFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNULAogICAgICAgIGxlYWZBdHRhY2tCaXRzOiBTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUUywKICAgICAgICByZWxhdGlvbk1hc2tzOiBTRUFSQ0hfUkVMQVRJT05fTUFTS1MsCiAgICAgICAgZXZhbHVhdGVCb2FyZDogeyAuLi5wZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50IH0sCiAgICAgICAgcHJlcGFyZVNlYXJjaEluZm86IHsgLi4ucGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnQgfSwKICAgICAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXM6IHsgLi4ucGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50IH0sCiAgICAgICAgYWxwaGFCZXRhQ2FsbHM6IHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscywKICAgICAgICBwc2V1ZG9Nb3Zlc0dlbmVyYXRlZDogcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkLAogICAgICAgIGxlZ2FsaXR5Q2hlY2tzOiBwZXJmU3RhdHMubGVnYWxpdHlDaGVja3MsCiAgICAgICAgaWxsZWdhbE1vdmVzU2tpcHBlZDogcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQsCiAgICAgICAgbGVnYWxNb3Zlc1NlYXJjaGVkOiBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkLAogICAgICAgIGZ1bGxIYXNoQ291bnQ6IHBlcmZTdGF0cy5mdWxsSGFzaENvdW50LAogICAgICAgIGluY3JlbWVudGFsSGFzaFVwZGF0ZXM6IHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzLAogICAgICAgIGhhc2hNaXNtYXRjaGVzOiBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMsCiAgICAgICAgZXZhbHVhdGVCb2FyZE1zOiBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zLAogICAgICAgIHByZXBhcmVTZWFyY2hJbmZvTXM6IHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zLAogICAgICAgIHR0OiB0dFN0YXRzLAogICAgICAgIGJ5RGVwdGgKICAgIH07Cn07CgovLyDmiZPljbDnu5/orqHkv6Hmga8KY29uc3QgbG9nUGVyZlN0YXRzID0gKGN1cnJlbnRQbGF5ZXIpID0+IHsKICAgIGNvbnN0IHNuYXAgPSBzbmFwc2hvdFBlcmZTdGF0cygpOwogICAgY29uc29sZS5sb2coYPCfk4og5oCn6IO957uf6K6hICgke2N1cnJlbnRQbGF5ZXJ9KSAtICR7c25hcC5lbGFwc2VkTXN9bXM6YCk7CiAgICBjb25zb2xlLmxvZyhgICAgZXZhbHVhdGVCb2FyZDogcmVkPSR7c25hcC5ldmFsdWF0ZUJvYXJkLnJlZH0sIGJsYWNrPSR7c25hcC5ldmFsdWF0ZUJvYXJkLmJsYWNrfWApOwogICAgY29uc29sZS5sb2coYCAgIHByZXBhcmVTZWFyY2hJbmZvOiByZWQ9JHtzbmFwLnByZXBhcmVTZWFyY2hJbmZvLnJlZH0sIGJsYWNrPSR7c25hcC5wcmVwYXJlU2VhcmNoSW5mby5ibGFja31gKTsKICAgIGNvbnNvbGUubG9nKGAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXM6IHJlZD0ke3NuYXAuY2FsY3VsYXRlVGhyZWF0VmFsdWVzLnJlZH0sIGJsYWNrPSR7c25hcC5jYWxjdWxhdGVUaHJlYXRWYWx1ZXMuYmxhY2t9YCk7CiAgICBjb25zb2xlLmxvZyhgICAgYWxwaGFCZXRh6LCD55So5qyh5pWwOiAke3NuYXAuYWxwaGFCZXRhQ2FsbHN9YCk7CiAgICBjb25zb2xlLmxvZyhgICAg5ZCI5rOV5oCnOiBwc2V1ZG89JHtzbmFwLnBzZXVkb01vdmVzR2VuZXJhdGVkfSwgY2hlY2tzPSR7c25hcC5sZWdhbGl0eUNoZWNrc30sIGlsbGVnYWxTa2lwPSR7c25hcC5pbGxlZ2FsTW92ZXNTa2lwcGVkfSwgbGVnYWxTZWFyY2hlZD0ke3NuYXAubGVnYWxNb3Zlc1NlYXJjaGVkfWApOwogICAgY29uc29sZS5sb2coYCAgIFpvYnJpc3Q6IGluY3JlbWVudGFsPSR7c25hcC5pbmNyZW1lbnRhbFpvYnJpc3R9LCBmdWxsSGFzaD0ke3NuYXAuZnVsbEhhc2hDb3VudH0sIGluY3JVcGRhdGVzPSR7c25hcC5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzfSwgbWlzbWF0Y2hlcz0ke3NuYXAuaGFzaE1pc21hdGNoZXN9YCk7CiAgICBjb25zb2xlLmxvZyhgICAgbGVhZkF0dGFja0JpdHM9JHtzbmFwLmxlYWZBdHRhY2tCaXRzfSByZWxhdGlvbk1hc2tzPSR7c25hcC5yZWxhdGlvbk1hc2tzfSBldmFsTXM9JHtNYXRoLnJvdW5kKHNuYXAuZXZhbHVhdGVCb2FyZE1zKX0gcHJlcGFyZU1zPSR7TWF0aC5yb3VuZChzbmFwLnByZXBhcmVTZWFyY2hJbmZvTXMpfWApOwogICAgY29uc29sZS5sb2coYCAgIFRUOiBoaXRzPSR7c25hcC50dC5oaXRzfSwgbWlzc2VzPSR7c25hcC50dC5taXNzZXN9LCBoaXRSYXRlPSR7c25hcC50dC5oaXRSYXRlfSUsIHN0b3Jlcz0ke3NuYXAudHQuc3RvcmVzfSwgc2l6ZT0ke3NuYXAudHQuY3VycmVudFNpemV9YCk7CiAgICAKICAgIGNvbnN0IGRlcHRocyA9IE9iamVjdC5rZXlzKHNuYXAuYnlEZXB0aCk7CiAgICBpZiAoZGVwdGhzLmxlbmd0aCA+IDApIHsKICAgICAgICBjb25zb2xlLmxvZygnICAg5oyJ5rex5bqm57uf6K6hOicpOwogICAgICAgIGZvciAoY29uc3QgZCBvZiBkZXB0aHMpIHsKICAgICAgICAgICAgY29uc3Qgcm93ID0gc25hcC5ieURlcHRoW2RdOwogICAgICAgICAgICBjb25zb2xlLmxvZyhgICAgICDmt7HluqYke2R9OiDoioLngrk9JHtyb3cubm9kZXN9LCDotbDms5U9JHtyb3cubW92ZXN9LCDliarmnp09JHtyb3cuY3V0b2Zmc31gKTsKICAgICAgICB9CiAgICB9Cn07Cgpjb25zdCB0cmFuc3Bvc2l0aW9uVGFibGUgPSBuZXcgVHJhbnNwb3NpdGlvblRhYmxlKCk7CgovLyDlj7bor4TkvLDnvJPlrZjvvIjlrozmlbTlvaLlir/liIbvvInvvJvmr4/mrKEgZ2V0QmVzdE1vdmUg5riF56m6CmNvbnN0IEVWQUxfQ0FDSEVfTUFYID0gTWF0aC5wb3coMiwgMTgpOwpjb25zdCBldmFsQ2FjaGUgPSBuZXcgTWFwKCk7CmNvbnN0IGNsZWFyRXZhbENhY2hlID0gKCkgPT4gewogICAgZXZhbENhY2hlLmNsZWFyKCk7Cn07CgovLyDliarmnp3lvIDlhbPvvJrlrozmlbTor4TkvLDkuIvoi6XlvIDlsYDlh7rlup/mo4vliJnlhYjlhbPvvIzkv53mo4vlipvlho3ph43moIflrpoKY29uc3QgU0VBUkNIX0VOQUJMRV9OTVAgPSBmYWxzZTsKY29uc3QgU0VBUkNIX0VOQUJMRV9MTVIgPSBmYWxzZTsKCi8vIOedgOazleWQiOazleaAp++8mnRydWU95pCc57Si5YaF6K+V6LWw5pe25qOA5rWL77yI5Y+v6Lez6L+H5Ymq5p6d5pyq6Kem5Y+K552A5rOV77yJ77ybZmFsc2U9cHJlcGFyZSDml7blhajph48gZmlsdGVyTGVnYWxNb3Zlc++8iOaXp+i3r+W+hO+8iQpsZXQgU0VBUkNIX0RFRkVSX0xFR0FMSVRZID0gdHJ1ZTsKbGV0IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPSB0cnVlOwoKLy8gWm9icmlzdC9UVO+8mnRydWU95pCc57Si5YaF5aKe6YeP57u05oqk5bGA6Z2i5ZOI5biMICsg5pWw5YC8IFRUIGtlee+8m2ZhbHNlPeavj+iKgueCueWFqOebmCBoYXNoICsg5a2X56ym5LiyIGtlee+8iOaXp+i3r+W+hO+8jOS+v+S6jiBBL0LvvIkKbGV0IFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUID0gdHJ1ZTsKLy8g6LCD6K+V77ya5aKe6YeP5ZCO5LiO5YWo55uYIGhhc2gg5q+U5a+577yI5LuF5qCh6aqM6ISa5pys5byA5ZCv77yM5q2j5byP5pCc57Si5YWz6Zet77yJCmxldCBTRUFSQ0hfWk9CUklTVF9WRVJJRlkgPSBmYWxzZTsKCi8vIOaQnOe0ouWQr+WPke+8muadgOaji+ihqCArIOWOhuWPsuWQr+WPke+8iOavj+asoSBnZXRCZXN0TW92ZSDph43nva7vvIkKbGV0IGtpbGxlck1vdmVzID0gW107CmxldCBoaXN0b3J5VGFibGUgPSBudWxsOwoKY29uc3QgcmVzZXRTZWFyY2hIZXVyaXN0aWNzID0gKG1heERlcHRoKSA9PiB7CiAgICBraWxsZXJNb3ZlcyA9IEFycmF5KG1heERlcHRoICsgMikuZmlsbChudWxsKS5tYXAoKCkgPT4gW251bGwsIG51bGxdKTsKICAgIGhpc3RvcnlUYWJsZSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDEwIH0sICgpID0+CiAgICAgICAgQXJyYXkuZnJvbSh7IGxlbmd0aDogOSB9LCAoKSA9PgogICAgICAgICAgICBBcnJheS5mcm9tKHsgbGVuZ3RoOiAxMCB9LCAoKSA9PiBBcnJheSg5KS5maWxsKDApKQogICAgICAgICkKICAgICk7Cn07Cgpjb25zdCBpc1NhbWVNb3ZlID0gKGEsIGIpID0+CiAgICBhICE9IG51bGwgJiYgYiAhPSBudWxsICYmCiAgICBtb3ZlRnJvbVNxKGEpID09PSBtb3ZlRnJvbVNxKGIpICYmCiAgICBtb3ZlVG9TcShhKSA9PT0gbW92ZVRvU3EoYik7Cgpjb25zdCBzdG9yZUtpbGxlck1vdmUgPSAoZGVwdGgsIG1vdmUpID0+IHsKICAgIGlmIChkZXB0aCA8IDAgfHwgZGVwdGggPj0ga2lsbGVyTW92ZXMubGVuZ3RoIHx8ICFtb3ZlKSByZXR1cm47CiAgICBjb25zdCBzbG90ID0ga2lsbGVyTW92ZXNbZGVwdGhdOwogICAgaWYgKGlzU2FtZU1vdmUoc2xvdFswXSwgbW92ZSkpIHJldHVybjsKICAgIHNsb3RbMV0gPSBzbG90WzBdOwogICAgc2xvdFswXSA9IGlzRW5jb2RlZE1vdmUobW92ZSkgPyBtb3ZlIDogZW5jb2RlTW92ZShtb3ZlLmZyb20sIG1vdmUudG8pOwp9OwoKY29uc3QgYWRkSGlzdG9yeVNjb3JlID0gKG1vdmUsIGRlcHRoKSA9PiB7CiAgICBpZiAoIWhpc3RvcnlUYWJsZSB8fCAhbW92ZSkgcmV0dXJuOwogICAgaGlzdG9yeVRhYmxlW21vdmVGcm9tUihtb3ZlKV1bbW92ZUZyb21DKG1vdmUpXVttb3ZlVG9SKG1vdmUpXVttb3ZlVG9DKG1vdmUpXSArPSBkZXB0aCAqIGRlcHRoOwp9OwoKY29uc3QgZ2V0SGlzdG9yeVNjb3JlID0gKG1vdmUpID0+IHsKICAgIGlmICghaGlzdG9yeVRhYmxlIHx8ICFtb3ZlKSByZXR1cm4gMDsKICAgIHJldHVybiBoaXN0b3J5VGFibGVbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldW21vdmVUb1IobW92ZSldW21vdmVUb0MobW92ZSldIHx8IDA7Cn07CgovLyBXb3JrZXIgbWVzc2FnZSBoYW5kbGluZwppZiAodHlwZW9mIHNlbGYgIT09ICd1bmRlZmluZWQnKSB7CiAgICBzZWxmLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKGUpIHsKICAgIGNvbnN0IHsgdHlwZSwgcGF5bG9hZCB9ID0gZS5kYXRhOwogICAgCiAgICBzd2l0Y2ggKHR5cGUpIHsgICAgICAgICAgICAKICAgICAgICBjYXNlICdTRUFSQ0gnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHNlYXJjaEJvYXJkLCB0dXJuOiBzZWFyY2hUdXJuLCBkZXB0aDogc2VhcmNoRGVwdGgsIGdhbWVJZCwgb3BlbmluZ0Jvb2tFbmFibGVkOiBzZWFyY2hPcGVuaW5nQm9va0VuYWJsZWQgPSB0cnVlLCBwbHk6IHNlYXJjaFBseSA9IDAsIGVuYWJsZVRpbWVMaW1pdDogc2VhcmNoRW5hYmxlVGltZUxpbWl0ID0gZmFsc2UsIGV4YWN0Um9vdFNjb3Jlczogc2VhcmNoRXhhY3RSb290U2NvcmVzID0gZmFsc2UsIGRlZmVyTGVnYWxpdHk6IHNlYXJjaERlZmVyTGVnYWxpdHksIGluY3JlbWVudGFsWm9icmlzdDogc2VhcmNoSW5jcmVtZW50YWxab2JyaXN0LCBsZWFmQXR0YWNrQml0czogc2VhcmNoTGVhZkF0dGFja0JpdHMsIHJlbGF0aW9uTWFza3M6IHNlYXJjaFJlbGF0aW9uTWFza3MsIHpvYnJpc3RWZXJpZnk6IHNlYXJjaFpvYnJpc3RWZXJpZnksIGNvbGxlY3RNb3ZlU2VxdWVuY2U6IHNlYXJjaENvbGxlY3RNb3ZlU2VxdWVuY2UgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoRGVmZXJMZWdhbGl0eSA9PT0gJ2Jvb2xlYW4nKSB7CiAgICAgICAgICAgICAgICBTRUFSQ0hfREVGRVJfTEVHQUxJVFkgPSBzZWFyY2hEZWZlckxlZ2FsaXR5OwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoSW5jcmVtZW50YWxab2JyaXN0ID09PSAnYm9vbGVhbicpIHsKICAgICAgICAgICAgICAgIFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUID0gc2VhcmNoSW5jcmVtZW50YWxab2JyaXN0OwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoTGVhZkF0dGFja0JpdHMgPT09ICdib29sZWFuJykgewogICAgICAgICAgICAgICAgU0VBUkNIX0xFQUZfQVRUQUNLX0JJVFMgPSBzZWFyY2hMZWFmQXR0YWNrQml0czsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaFJlbGF0aW9uTWFza3MgPT09ICdib29sZWFuJykgewogICAgICAgICAgICAgICAgU0VBUkNIX1JFTEFUSU9OX01BU0tTID0gc2VhcmNoUmVsYXRpb25NYXNrczsKICAgICAgICAgICAgfQogICAgICAgICAgICBTRUFSQ0hfWk9CUklTVF9WRVJJRlkgPSAhIXNlYXJjaFpvYnJpc3RWZXJpZnk7CiAgICAgICAgICAgIC8vIFNldCBvcGVuaW5nIGJvb2sgZW5hYmxlZCBzdGF0dXMKICAgICAgICAgICAgb3BlbmluZ0Jvb2suc2V0RW5hYmxlZChzZWFyY2hPcGVuaW5nQm9va0VuYWJsZWQpOwogICAgICAgICAgICAvLyDorrDlvZXmkJzntKLlvIDlp4vml7bpl7QKICAgICAgICAgICAgY29uc3Qgc3RhcnRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCk7CiAgICAgICAgICAgIC8vIOaJp+ihjOaQnOe0ogogICAgICAgICAgICBjb25zdCBiZXN0U2VhcmNoTW92ZSA9IGdldEJlc3RNb3ZlKHNlYXJjaEJvYXJkLCBzZWFyY2hUdXJuLCBzZWFyY2hEZXB0aCwgc2VhcmNoUGx5LCBzZWFyY2hFbmFibGVUaW1lTGltaXQsIHNlYXJjaEV4YWN0Um9vdFNjb3Jlcywgc2VhcmNoQ29sbGVjdE1vdmVTZXF1ZW5jZSk7CiAgICAgICAgICAgIC8vIOiusOW9leaQnOe0oue7k+adn+aXtumXtOW5tuiuoeeul+aAneiAg+aXtumXtAogICAgICAgICAgICBjb25zdCBlbmRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCk7CiAgICAgICAgICAgIGNvbnN0IHRoaW5raW5nVGltZSA9IGVuZFRpbWUgLSBzdGFydFRpbWU7CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyDmo4Dmn6XmmK/lkKbmnaXoh6rlvIDlsYDlupMKICAgICAgICAgICAgY29uc3QgYm9va01vdmVTZWFyY2ggPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShzZWFyY2hCb2FyZCwgc2VhcmNoUGx5KTsKICAgICAgICAgICAgY29uc3QgZnJvbUJvb2tTZWFyY2ggPSAhIWJvb2tNb3ZlU2VhcmNoICYmIEpTT04uc3RyaW5naWZ5KGJvb2tNb3ZlU2VhcmNoKSA9PT0gSlNPTi5zdHJpbmdpZnkoYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmUpOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8g5re75Yqg5oCn6IO957uf6K6h5pel5b+XCiAgICAgICAgICAgIGxvZ1BlcmZTdGF0cyhzZWFyY2hUdXJuKTsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIOa3u+WKoOaAneiAg+aXtumXtOaXpeW/lwogICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VhcmNoIGNvbXBsZXRlZCBpbiAke01hdGgucm91bmQodGhpbmtpbmdUaW1lKX1tcywgZ2FtZUlkPSR7Z2FtZUlkfSwgYmVzdE1vdmU9JHtKU09OLnN0cmluZ2lmeShiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSl9LCBzZWNvbmRCZXN0TW92ZT0ke0pTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlKX0sIGZyb21Cb29rPSR7ZnJvbUJvb2tTZWFyY2h9YCk7CiAgICAgICAgICAgIC8vIOWPkemAgeaQnOe0oue7k+aenOWSjOaAneiAg+aXtumXtAogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgCiAgICAgICAgICAgICAgICB0eXBlOiAnU0VBUkNIX0NPTVBMRVRFJywgCiAgICAgICAgICAgICAgICBwYXlsb2FkOiB7IAogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlOiBiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSwgCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kQmVzdE1vdmU6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlLCAKICAgICAgICAgICAgICAgICAgICBnYW1lSWQsIAogICAgICAgICAgICAgICAgICAgIGZyb21Cb29rOiBmcm9tQm9va1NlYXJjaCwgCiAgICAgICAgICAgICAgICAgICAgdGhpbmtpbmdUaW1lOiBNYXRoLnJvdW5kKHRoaW5raW5nVGltZSksIC8vIOWbm+iIjeS6lOWFpeWIsOavq+enkgogICAgICAgICAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogYmVzdFNlYXJjaE1vdmUubW92ZVNlcXVlbmNlLAogICAgICAgICAgICAgICAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kTW92ZVNlcXVlbmNlLAogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2NvcmU6IGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlU2NvcmUsCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kQmVzdE1vdmVTY29yZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kQmVzdE1vdmVTY29yZSwKICAgICAgICAgICAgICAgICAgICBhbGxNb3Zlc1dpdGhTY29yZXM6IGJlc3RTZWFyY2hNb3ZlLmFsbE1vdmVzV2l0aFNjb3JlcyB8fCBbXSwKICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWREZXB0aDogYmVzdFNlYXJjaE1vdmUuY29tcGxldGVkRGVwdGgsCiAgICAgICAgICAgICAgICAgICAgcGVyZjogc25hcHNob3RQZXJmU3RhdHMoKQogICAgICAgICAgICAgICAgfSAKICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICBjYXNlICdnZXRWYWxpZE1vdmVzJzogewogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiB2bUJvYXJkLCBwb3M6IHZtUG9zIH0gPSBwYXlsb2FkOwogICAgICAgICAgICBzeW5jR2VuZXJhbFBvc0NhY2hlKHZtQm9hcmQpOwogICAgICAgICAgICBjb25zdCB2YWxpZE1vdmVzID0gZ2V0VmFsaWRNb3Zlcyh2bUJvYXJkLCB2bVBvcyk7CiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICAgICAgdHlwZTogJ3ZhbGlkTW92ZXMnLAogICAgICAgICAgICAgICAgbW92ZXM6IHZhbGlkTW92ZXMKICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgY2FzZSAnZ2V0UGllY2VSZWxhdGlvbnMnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHByQm9hcmQsIHBvczogcHJQb3MgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gcHJCb2FyZFtwclBvcy5yXVtwclBvcy5jXTsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIOiwg+eUqGV2YWx1YXRlQm9hcmTojrflj5blrozmlbTnmoTmo4vlrZDkv6Hmga/lkoxib2FyZEluZm8KICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoKTsKICAgICAgICAgICAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7CiAgICAgICAgICAgIGNvbnN0IGJvYXJkRXZhbHVhdGlvbiA9IGV2YWx1YXRlQm9hcmQocHJCb2FyZCwgbnVsbCwgZ2FtZVN0YWdlKTsKICAgICAgICAgICAgY29uc3QgcGllY2VzSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5waWVjZXNJbmZvOwogICAgICAgICAgICBjb25zdCBib2FyZEluZm8gPSBib2FyZEV2YWx1YXRpb24uYm9hcmRJbmZvOwoKICAgICAgICAgICAgaWYgKGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKSB7CiAgICAgICAgICAgICAgICBoeWRyYXRlUmVsYXRpb25zRnJvbU1hc2tzKHBpZWNlc0luZm8sIGJvYXJkSW5mbyk7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIC8vIGJvYXJkSW5mbyDmoLzlhoXlj6/og73mmK8gcGllY2VzSW5mbyDlvJXnlKjvvIznu5/kuIDmmKDlsITkuLoge3IsY30g5L6bIFVJIOS9v+eUqAogICAgICAgICAgICBjb25zdCByYXdDb250cm9sbGVycyA9IGJvYXJkSW5mby5jb250cm9sbGVyR3JpZAogICAgICAgICAgICAgICAgPyAoYm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkW3ByUG9zLnJdW3ByUG9zLmNdIHx8IFtdKQogICAgICAgICAgICAgICAgOiAoYm9hcmRJbmZvW3ByUG9zLnJdICYmIGJvYXJkSW5mb1twclBvcy5yXVtwclBvcy5jXSkgfHwgW107CiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJzID0gcmF3Q29udHJvbGxlcnMubWFwKChjdHJsKSA9PiAoeyByOiBjdHJsLnIsIGM6IGN0cmwuYyB9KSk7CiAgICAgICAgICAgIAogICAgICAgICAgICBsZXQgcmVsYXRpb25zID0gewogICAgICAgICAgICAgICAgdGhyZWF0OiBbXSwgCiAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnk6IFtdLCAKICAgICAgICAgICAgICAgIGd1YXJkOiBbXSwgCiAgICAgICAgICAgICAgICBndWFyZGVkQnk6IFtdLCAKICAgICAgICAgICAgICAgIGNvbnRyb2w6IFtdLAogICAgICAgICAgICAgICAgY29udHJvbGxlcnMKICAgICAgICAgICAgfTsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIOWmguaenOeCueWHu+eahOaYr+aji+WtkO+8jOi/lOWbnuivpeaji+WtkOeahOWFs+ezu+S/oeaBrwogICAgICAgICAgICBpZiAocGllY2UpIHsKICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIGN1cnJlbnQgcGllY2UgaW5mbwogICAgICAgICAgICAgICAgY29uc3QgY3VycmVudFBpZWNlSW5mbyA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gcHJQb3MuciAmJiBwLmMgPT09IHByUG9zLmMpOwogICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICBpZiAoY3VycmVudFBpZWNlSW5mbykgewogICAgICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgcmVsYXRpb25zCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGhyZWF0ID0gY3VycmVudFBpZWNlSW5mby50aHJlYXQubWFwKHRocmVhdFBpZWNlID0+ICh7IHI6IHRocmVhdFBpZWNlLnIsIGM6IHRocmVhdFBpZWNlLmMgfSkpOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRocmVhdGVuZWRCeSA9IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0ZW5lZEJ5Lm1hcCh0aHJlYXRlbmVkQnlQaWVjZSA9PiAoeyByOiB0aHJlYXRlbmVkQnlQaWVjZS5yLCBjOiB0aHJlYXRlbmVkQnlQaWVjZS5jIH0pKTsKICAgICAgICAgICAgICAgICAgICBjb25zdCBndWFyZCA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmQubWFwKGd1YXJkUGllY2UgPT4gKHsgcjogZ3VhcmRQaWVjZS5yLCBjOiBndWFyZFBpZWNlLmMgfSkpOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IGd1YXJkZWRCeSA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmRlZEJ5Lm1hcChndWFyZGVkQnlQaWVjZSA9PiAoeyByOiBndWFyZGVkQnlQaWVjZS5yLCBjOiBndWFyZGVkQnlQaWVjZS5jIH0pKTsKICAgICAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sID0gKGN1cnJlbnRQaWVjZUluZm8uY29udHJvbCB8fCBbXSkubWFwKGNvbnRyb2xQb3MgPT4gKHsgcjogY29udHJvbFBvcy5yLCBjOiBjb250cm9sUG9zLmMgfSkpOwogICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgIHJlbGF0aW9ucyA9IHsKICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0LCAKICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5LCAKICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmQsIAogICAgICAgICAgICAgICAgICAgICAgICBndWFyZGVkQnksIAogICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sLAogICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sbGVycwogICAgICAgICAgICAgICAgICAgIH07CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlUmVsYXRpb25zJywKICAgICAgICAgICAgICAgIHJlbGF0aW9uczogcmVsYXRpb25zCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgIGNhc2UgJ2NoZWNrR2FtZVN0YXRlJzogewogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBjZ3NCb2FyZCwgdHVybjogY2dzVHVybiwgcmVxdWVzdElkIH0gPSBwYXlsb2FkOwogICAgICAgICAgICBjb25zdCBnYW1lU3RhdGUgPSBjaGVja0dhbWVTdGF0ZShjZ3NCb2FyZCwgY2dzVHVybik7CiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICAgICAgdHlwZTogJ2dhbWVTdGF0ZScsCiAgICAgICAgICAgICAgICBzdGF0ZTogZ2FtZVN0YXRlLAogICAgICAgICAgICAgICAgcmVxdWVzdElkCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgIGNhc2UgJ2V2YWx1YXRlQm9hcmQnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGV2YWxCb2FyZCwgdHVybjogZXZhbFR1cm4gfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIC8vIOaJk+WNsOaOpeaUtueahOWPguaVsAogICAgICAgICAgICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZSgpOwogICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsKICAgICAgICAgICAgY29uc3QgZGV0YWlsZWRFdmFsID0gZXZhbHVhdGVCb2FyZChldmFsQm9hcmQsIGV2YWxUdXJuLCBnYW1lU3RhZ2UpOwogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsKICAgICAgICAgICAgICAgIHR5cGU6ICdkZXRhaWxlZEV2YWx1YXRpb24nLAogICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZGV0YWlsZWRFdmFsCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CgogICAgICAgIGNhc2UgJ2V2YWx1YXRlUGllY2UnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHBpZWNlRXZhbEJvYXJkLCBwb3M6IHBpZWNlRXZhbFBvcywgdHVybiB9ID0gcGF5bG9hZDsKICAgICAgICAgICAgY29uc3QgcGllY2UgPSBwaWVjZUV2YWxCb2FyZFtwaWVjZUV2YWxQb3Mucl1bcGllY2VFdmFsUG9zLmNdOwogICAgICAgICAgICAKICAgICAgICAgICAgaWYgKCFwaWVjZSkgewogICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7CiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsCiAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogewogICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogMCwKICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IDAsCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLAogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IDAsCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogMCwKICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiAwCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgIH0KICAgICAgICAgICAgZWxzZSB7CiAgICAgICAgICAgICAgICAvLyDkuLvliqjosIPnlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE6K+E5Lyw5L+h5oGvCiAgICAgICAgICAgICAgICAvLyDojrflj5blvZPliY3muLjmiI/pmLbmrrUKICAgICAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7CiAgICAgICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsKICAgICAgICAgICAgY29uc3QgYm9hcmRFdmFsdWF0aW9uID0gZXZhbHVhdGVCb2FyZChwaWVjZUV2YWxCb2FyZCwgdHVybiwgZ2FtZVN0YWdlKTsKICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgLy8g5LuOZXZhbHVhdGVCb2FyZOeahOi/lOWbnuWAvOS4reaJvuWIsOW9k+WJjeaji+WtkOeahOS/oeaBrwogICAgICAgICAgICAgICAgY3VycmVudFBpZWNlSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5waWVjZXNJbmZvLmZpbmQoCiAgICAgICAgICAgICAgICAgICAgcCA9PiBwLnIgPT09IHBpZWNlRXZhbFBvcy5yICYmIHAuYyA9PT0gcGllY2VFdmFsUG9zLmMKICAgICAgICAgICAgICAgICk7CiAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGllY2VJbmZvKSB7CiAgICAgICAgICAgICAgICAgICAgLy8g5bqU55So5p2D6YeN5bm26L+U5Zue5Y2V5Liq5qOL5a2Q55qE6K+E5Lyw5YC8CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXZhbHVhdGlvbiA9IHsKICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IGN1cnJlbnRQaWVjZUluZm8ubWF0ZXJpYWxWYWx1ZSAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsCiAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiBjdXJyZW50UGllY2VJbmZvLnBvc2l0aW9uVmFsdWUgKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLAogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogY3VycmVudFBpZWNlSW5mby5tb2JpbGl0eVZhbHVlICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eSwKICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiBjdXJyZW50UGllY2VJbmZvLnRocmVhdFZhbHVlICogVkFMVUVfV0VJR0hUUy50aHJlYXQsCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogY3VycmVudFBpZWNlSW5mby5zYWZldHlWYWx1ZSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LAogICAgICAgICAgICAgICAgICAgICAgICB0YWN0aWM6IGN1cnJlbnRQaWVjZUluZm8udGFjdGljVmFsdWUgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYwogICAgICAgICAgICAgICAgICAgIH07CiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7CiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLAogICAgICAgICAgICAgICAgICAgICAgICBldmFsdWF0aW9uOiBldmFsdWF0aW9uCiAgICAgICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgIC8vIOWmguaenOS7jeeEtuaJvuS4jeWIsOaji+WtkOS/oeaBr++8jOi/lOWbnum7mOiupOWAvAogICAgICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywKICAgICAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogewogICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiAwLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiAwCiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgY2FzZSAnaXNDaGVjayc6IHsKICAgICAgICAgICAgY29uc3QgeyBib2FyZDogY0JvYXJkLCBjb2xvcjogY0NvbG9yLCByZXF1ZXN0SWQgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIHN5bmNHZW5lcmFsUG9zQ2FjaGUoY0JvYXJkKTsKICAgICAgICAgICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2soY0JvYXJkLCBjQ29sb3IpOwogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsKICAgICAgICAgICAgICAgIHR5cGU6ICdjaGVjaycsCiAgICAgICAgICAgICAgICBpc0NoZWNrOiBpbkNoZWNrLAogICAgICAgICAgICAgICAgcmVxdWVzdElkCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgIGNhc2UgJ2lzVmFsaWRQbGFjZW1lbnQnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgdHlwZTogaXBUeXBlLCBjb2xvcjogaXBDb2xvciwgciwgYyB9ID0gcGF5bG9hZDsKICAgICAgICAgICAgY29uc3QgdmFsaWRQbGFjZW1lbnQgPSBpc1ZhbGlkUGxhY2VtZW50KGlwVHlwZSwgaXBDb2xvciwgciwgYyk7CiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICAgICAgdHlwZTogJ3ZhbGlkUGxhY2VtZW50JywKICAgICAgICAgICAgICAgIGlzVmFsaWQ6IHZhbGlkUGxhY2VtZW50CiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgIGNhc2UgJ2FkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyc6IHsKICAgICAgICAgICAgY29uc3QgeyBtb3Zlcywgd2VpZ2h0cyB9ID0gcGF5bG9hZDsKICAgICAgICAgICAgLy8gQWRkIHRoZSBvcGVuaW5nIGxpbmUgdG8gdGhlIG9wZW5pbmcgYm9vawogICAgICAgICAgICBvcGVuaW5nQm9vay5hZGRPcGVuaW5nTGluZUZyb21TdHJpbmcoW21vdmVzXSwgd2VpZ2h0cyk7CiAgICAgICAgICAgIC8vIFNlbmQgY29uZmlybWF0aW9uCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyAKICAgICAgICAgICAgICAgIHR5cGU6ICdvcGVuaW5nTGluZUFkZGVkJywgCiAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlIAogICAgICAgICAgICB9KTsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICBjYXNlICdtb3Zlc1RvTm90YXRpb24nOiB7CiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSB9ID0gcGF5bG9hZDsKICAgICAgICAgICAgY29uc3Qgbm90YXRpb24gPSBvcGVuaW5nQm9vay5tb3Zlc1RvTm90YXRpb24oYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSk7CiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyAKICAgICAgICAgICAgICAgIHR5cGU6ICdub3RhdGlvbicsIAogICAgICAgICAgICAgICAgbm90YXRpb246IG5vdGF0aW9uIAogICAgICAgICAgICB9KTsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICBjYXNlICdub3RhdGlvblRvTW92ZXMnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgbm90YXRpb246IG5vdGF0aW9uU3RyaW5nLCBpbml0aWFsQm9hcmQgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIGNvbnN0IG1vdmVzRnJvbU5vdGF0aW9uID0gb3BlbmluZ0Jvb2subm90YXRpb25Ub01vdmVzKG5vdGF0aW9uU3RyaW5nLCBpbml0aWFsQm9hcmQpOwogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgCiAgICAgICAgICAgICAgICB0eXBlOiAnbW92ZXMnLCAKICAgICAgICAgICAgICAgIG1vdmVzOiBtb3Zlc0Zyb21Ob3RhdGlvbiAKICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgY2FzZSAnc2V0VmFsdWVXZWlnaHRzJzogewogICAgICAgICAgICBWQUxVRV9XRUlHSFRTID0geyAuLi5WQUxVRV9XRUlHSFRTLCAuLi5wYXlsb2FkIH07CiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdVcGRhdGVkIFZBTFVFX1dFSUdIVFM6JywgVkFMVUVfV0VJR0hUUyk7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgIH0KfTsKCiAgICAvLyBPdmVycmlkZSBjb25zb2xlLmxvZyB0byBzZW5kIG1lc3NhZ2VzIGJhY2sgdG8gbWFpbiB0aHJlYWQKICAgIGNvbnN0IG9yaWdpbmFsQ29uc29sZUxvZyA9IGNvbnNvbGUubG9nOwogICAgY29uc29sZS5sb2cgPSBmdW5jdGlvbiguLi5hcmdzKSB7CiAgICAgICAgLy8gU2VuZCB0byBtYWluIHRocmVhZAogICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICB0eXBlOiAnbG9nJywKICAgICAgICAgICAgZGF0YTogYXJncy5qb2luKCcgJykKICAgICAgICB9KTsKICAgICAgICAKICAgICAgICAvLyBBbHNvIGxvZyB0byB3b3JrZXIgY29uc29sZQogICAgICAgIG9yaWdpbmFsQ29uc29sZUxvZy5hcHBseShjb25zb2xlLCBhcmdzKTsKICAgIH07Cn0KCi8vIOepuuedgOWJquaene+8muaciei/m+aUu+WtkOWKm+aXtuaJjeWFgeiuuO+8iOmBv+WFjeWwhi/lo6sv6LGh5q6L5bGA6YC8552A6K+v5Ymq77yJCmNvbnN0IGNhbkRvTnVsbE1vdmUgPSAoYm9hcmQsIGNvbG9yKSA9PiB7CiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgewogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7CiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtyXVtjXTsKICAgICAgICAgICAgaWYgKCFwIHx8IHAuY29sb3IgIT09IGNvbG9yKSBjb250aW51ZTsKICAgICAgICAgICAgaWYgKHAudHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHAudHlwZSA9PT0gJ2hvcnNlJyB8fCBwLnR5cGUgPT09ICdjYW5ub24nIHx8IHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7CiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KICAgIHJldHVybiBmYWxzZTsKfTsKCi8vIOaQnOe0oueUqCBUVCBrZXnvvJrlop7ph4/mqKHlvI/kuLogbnVtYmVy77yM5pen5qih5byP5Li6IGAke2hhc2h9OiR7c2lkZX1gIOWtl+espuS4sgpjb25zdCBtYWtlU2VhcmNoVFRLZXkgPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSGFzaCkgPT4gewogICAgaWYgKFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUKSB7CiAgICAgICAgcmV0dXJuIHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChib2FyZEhhc2gsIGN1cnJlbnRQbGF5ZXIpOwogICAgfQogICAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsKICAgIHJldHVybiBgJHt6b2JyaXN0SGFzaGVyLmhhc2goYm9hcmQpfToke2N1cnJlbnRQbGF5ZXJ9YDsKfTsKCi8vIOi1sOWtkOWQjueahOWtkOiKgueCueWxgOmdouWTiOW4jO+8iOS7heWinumHj+aooeW8j+acieaEj+S5ie+8m+mhu+WcqCBtYWtlIOWJjeS/neWtmCBtb3ZpbmdQaWVjZe+8iQpjb25zdCBjaGlsZEJvYXJkSGFzaCA9IChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCkgPT4gewogICAgaWYgKCFTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCkgcmV0dXJuIGJvYXJkSGFzaDsKICAgIHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzKys7CiAgICBpZiAoaXNFbmNvZGVkTW92ZShtb3ZlKSkgewogICAgICAgIGxldCBuZXdIYXNoID0gYm9hcmRIYXNoOwogICAgICAgIGNvbnN0IG1vdmluZ0lkeCA9IHpvYnJpc3RIYXNoZXIucGllY2VJbmRleChtb3ZpbmdQaWVjZSk7CiAgICAgICAgY29uc3QgZnJvbSA9IG1vdmUgPj4+IDc7CiAgICAgICAgY29uc3QgdG8gPSBtb3ZlICYgTU9WRV9UT19NQVNLOwogICAgICAgIGlmIChtb3ZpbmdJZHggIT09IHVuZGVmaW5lZCkgewogICAgICAgICAgICBuZXdIYXNoIF49IHpvYnJpc3RIYXNoZXIuaGFzaFRhYmxlWyhmcm9tIC8gOSkgfCAwXVtmcm9tICUgOV1bbW92aW5nSWR4XTsKICAgICAgICAgICAgbmV3SGFzaCBePSB6b2JyaXN0SGFzaGVyLmhhc2hUYWJsZVsodG8gLyA5KSB8IDBdW3RvICUgOV1bbW92aW5nSWR4XTsKICAgICAgICB9CiAgICAgICAgaWYgKGNhcHR1cmVkKSB7CiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkSWR4ID0gem9icmlzdEhhc2hlci5waWVjZUluZGV4KGNhcHR1cmVkKTsKICAgICAgICAgICAgaWYgKGNhcHR1cmVkSWR4ICE9PSB1bmRlZmluZWQpIHsKICAgICAgICAgICAgICAgIG5ld0hhc2ggXj0gem9icmlzdEhhc2hlci5oYXNoVGFibGVbKHRvIC8gOSkgfCAwXVt0byAlIDldW2NhcHR1cmVkSWR4XTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICByZXR1cm4gbmV3SGFzaDsKICAgIH0KICAgIHJldHVybiB6b2JyaXN0SGFzaGVyLnVwZGF0ZUhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOwp9OwoKY29uc3QgdmVyaWZ5Qm9hcmRIYXNoID0gKGJvYXJkLCBleHBlY3RlZEhhc2gpID0+IHsKICAgIGlmICghU0VBUkNIX1pPQlJJU1RfVkVSSUZZKSByZXR1cm47CiAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOwogICAgY29uc3QgZnVsbCA9IHpvYnJpc3RIYXNoZXIuaGFzaChib2FyZCk7CiAgICBpZiAoZnVsbCAhPT0gZXhwZWN0ZWRIYXNoKSB7CiAgICAgICAgcGVyZlN0YXRzLmhhc2hNaXNtYXRjaGVzKys7CiAgICB9Cn07CgovLyDmkJzntKLnlKjlh4DliIbvvJrlrozmlbTlvaLlir/or4TkvLDvvIjlhbPns7sv5aiB6IOBL+WuieWFqC/mnLrliqjvvInvvIzku4Xot7Pov4fnu4jlsYDnnYDms5XmnprkuL7vvJvluKYgWm9icmlzdCDnvJPlrZgKY29uc3Qgc3RhdGljU2VhcmNoRXZhbCA9IChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGJvYXJkSGFzaCA9IDApID0+IHsKICAgIGxldCBjYWNoZUtleTsKICAgIGlmIChTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCkgewogICAgICAgIGNhY2hlS2V5ID0gem9icmlzdEhhc2hlci5ldmFsQ2FjaGVLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsKICAgIH0gZWxzZSB7CiAgICAgICAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsKICAgICAgICBjYWNoZUtleSA9IHpvYnJpc3RIYXNoZXIuZXZhbENhY2hlS2V5KGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSk7CiAgICB9CiAgICBpZiAoZXZhbENhY2hlLmhhcyhjYWNoZUtleSkpIHsKICAgICAgICByZXR1cm4gZXZhbENhY2hlLmdldChjYWNoZUtleSk7CiAgICB9CiAgICBjb25zdCBldmFsUmVzdWx0ID0gZXZhbHVhdGVCb2FyZChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHsgZm9yU2VhcmNoTGVhZjogdHJ1ZSB9KTsKICAgIGNvbnN0IG9wcG9uZW50ID0gc2VhcmNoSW5pdGlhdG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgIGNvbnN0IG5ldCA9IGV2YWxSZXN1bHRbc2VhcmNoSW5pdGlhdG9yXS50b3RhbCAtIGV2YWxSZXN1bHRbb3Bwb25lbnRdLnRvdGFsOwogICAgaWYgKGV2YWxDYWNoZS5zaXplID49IEVWQUxfQ0FDSEVfTUFYKSB7CiAgICAgICAgLy8g566A5Y2V5reY5rGw5pyA5pep5YaZ5YWl55qE5LiA5om577yM6YG/5YWNIE1hcCDml6DpmZDmtqgKICAgICAgICBsZXQgZHJvcCA9IDA7CiAgICAgICAgZm9yIChjb25zdCBrIG9mIGV2YWxDYWNoZS5rZXlzKCkpIHsKICAgICAgICAgICAgZXZhbENhY2hlLmRlbGV0ZShrKTsKICAgICAgICAgICAgaWYgKCsrZHJvcCA+PSA0MDk2KSBicmVhazsKICAgICAgICB9CiAgICB9CiAgICBldmFsQ2FjaGUuc2V0KGNhY2hlS2V5LCBuZXQpOwogICAgcmV0dXJuIG5ldDsKfTsKCi8vIOeUn+aIkOW9k+WJjeaWueWQg+WtkOedgO+8iOS+m+mdmem7mOaQnOe0ou+8iQpjb25zdCBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoID0gKGJvYXJkLCBjdXJyZW50UGxheWVyKSA9PiB7CiAgICBjb25zdCBjYXB0dXJlcyA9IFtdOwogICAgY29uc3QgZGVmZXIgPSBTRUFSQ0hfREVGRVJfTEVHQUxJVFk7CiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgewogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgIGlmICghcGllY2UgfHwgcGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIGNvbnRpbnVlOwogICAgICAgICAgICBjb25zdCBwc2V1ZG8gPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCB7IHIsIGMgfSwgcGllY2UpOwogICAgICAgICAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgKz0gcHNldWRvLmxlbmd0aDsKICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IHBzZXVkbyA6IGZpbHRlckxlZ2FsTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSwgcHNldWRvKTsKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB1c2VNb3Zlcy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tpXTsKICAgICAgICAgICAgICAgIGlmIChib2FyZFt0by5yXVt0by5jXSkgewogICAgICAgICAgICAgICAgICAgIGNhcHR1cmVzLnB1c2goZW5jb2RlTW92ZUZyb21Db29yZHMociwgYywgdG8uciwgdG8uYykpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQogICAgcmV0dXJuIGNhcHR1cmVzOwp9OwoKLy8g6Z2Z6buY5pCc57Si77yac3RhbmQtcGF0IOeUqOWujOaVtOW9ouWKv+ivhOS8sO+8m+S7heWvueWQg+WtkOW7tuS8uO+8iFFT4omkM++8iQpjb25zdCBxdWllc2NlbmNlID0gKAogICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsCiAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgcXNEZXB0aCwgYm9hcmRIYXNoID0gMAopID0+IHsKICAgIGNvbnN0IHN0YW5kUGF0ID0gc3RhdGljU2VhcmNoRXZhbChiLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRIYXNoKTsKCiAgICBpZiAocXNEZXB0aCA8PSAwKSB7CiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07CiAgICB9CgogICAgaWYgKG1heGltaXppbmcpIHsKICAgICAgICBpZiAoc3RhbmRQYXQgPj0gYmV0YSkgewogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsKICAgICAgICB9CiAgICAgICAgaWYgKHN0YW5kUGF0ID4gYWxwaGEpIHsKICAgICAgICAgICAgYWxwaGEgPSBzdGFuZFBhdDsKICAgICAgICB9CiAgICB9IGVsc2UgewogICAgICAgIGlmIChzdGFuZFBhdCA8PSBhbHBoYSkgewogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsKICAgICAgICB9CiAgICAgICAgaWYgKHN0YW5kUGF0IDwgYmV0YSkgewogICAgICAgICAgICBiZXRhID0gc3RhbmRQYXQ7CiAgICAgICAgfQogICAgfQoKICAgIGxldCBjYXB0dXJlcyA9IGdlbmVyYXRlQ2FwdHVyZXNGb3JTZWFyY2goYiwgY3VycmVudFBsYXllcik7CiAgICBpZiAoY2FwdHVyZXMubGVuZ3RoID09PSAwKSB7CiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07CiAgICB9CgogICAgLy8gTVZWLUxWQe+8muWFiOivleWQg+Wkp+WtkAogICAgY2FwdHVyZXMuc29ydCgoYSwgYk1vdmUpID0+IHsKICAgICAgICBjb25zdCBzY29yZUEgPQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbbW92ZVRvUihhKV1bbW92ZVRvQyhhKV0sIGdhbWVTdGFnZSkgKiAxNiAtCiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYlttb3ZlRnJvbVIoYSldW21vdmVGcm9tQyhhKV0sIGdhbWVTdGFnZSk7CiAgICAgICAgY29uc3Qgc2NvcmVCID0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW21vdmVUb1IoYk1vdmUpXVttb3ZlVG9DKGJNb3ZlKV0sIGdhbWVTdGFnZSkgKiAxNiAtCiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYlttb3ZlRnJvbVIoYk1vdmUpXVttb3ZlRnJvbUMoYk1vdmUpXSwgZ2FtZVN0YWdlKTsKICAgICAgICByZXR1cm4gc2NvcmVCIC0gc2NvcmVBOwogICAgfSk7CgogICAgbGV0IGJlc3RFdmFsID0gc3RhbmRQYXQ7CiAgICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOwogICAgY29uc3QgZGVmZXIgPSBTRUFSQ0hfREVGRVJfTEVHQUxJVFk7CgogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjYXB0dXJlcy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IG1vdmUgPSBjYXB0dXJlc1tpXTsKICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldOwogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZVNlYXJjaE1vdmUoYiwgbW92ZSk7CiAgICAgICAgaWYgKGRlZmVyICYmIGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllcikpIHsKICAgICAgICAgICAgdW5tYWtlU2VhcmNoTW92ZShiLCBtb3ZlLCBjYXB0dXJlZCk7CiAgICAgICAgICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkKys7CiAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsKICAgICAgICB2ZXJpZnlCb2FyZEhhc2goYiwgbmV4dEhhc2gpOwogICAgICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQrKzsKICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7CiAgICAgICAgY29uc3QgbmV4dE1heGltaXppbmcgPSBuZXh0UGxheWVyID09PSBzZWFyY2hJbml0aWF0b3I7CiAgICAgICAgY29uc3QgcmVzdWx0ID0gcXVpZXNjZW5jZSgKICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLAogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgcXNEZXB0aCAtIDEsIG5leHRIYXNoCiAgICAgICAgKTsKICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsKCiAgICAgICAgaWYgKG1heGltaXppbmcpIHsKICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7CiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsKICAgICAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFKSB7CiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlVG9PYmplY3QobW92ZSksIC4uLihyZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV07CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGFscGhhKSB7CiAgICAgICAgICAgICAgICBhbHBoYSA9IHJlc3VsdC52YWx1ZTsKICAgICAgICAgICAgfQogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPCBiZXN0RXZhbCkgewogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7CiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgewogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZVRvT2JqZWN0KG1vdmUpLCAuLi4ocmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPCBiZXRhKSB7CiAgICAgICAgICAgICAgICBiZXRhID0gcmVzdWx0LnZhbHVlOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIGlmIChiZXRhIDw9IGFscGhhKSB7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgIH0KCiAgICByZXR1cm4geyB2YWx1ZTogYmVzdEV2YWwsIG1vdmVTZXF1ZW5jZTogU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA/IGJlc3RNb3ZlU2VxdWVuY2UgOiBbXSB9Owp9OwoKLy8gYWxwaGFCZXRh77ya6K+E5Lyw5aeL57uI5LuOIHNlYXJjaEluaXRpYXRvciDop5LluqbvvJtUVCArIGtpbGxlci9oaXN0b3J5ICsg56m6552A5Ymq5p6dICsgTE1SICsgUVMKLy8gYm9hcmRIYXNo77ya5aKe6YePIFpvYnJpc3Qg5bGA6Z2i5ZOI5biM77yI5LiN5ZCr6KGM5qOL5pa577yJ77yb5pen5qih5byP5LiL5Y+v5LygIDAKY29uc3QgYWxwaGFCZXRhID0gKAogICAgYiwgZCwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsCiAgICBzZWFyY2hEZXB0aCA9IDAsIHNlYXJjaEluaXRpYXRvciA9IGN1cnJlbnRQbGF5ZXIsIGdhbWVTdGFnZSA9ICdtaWQnLAogICAgYWxsb3dOdWxsID0gdHJ1ZSwgYm9hcmRIYXNoID0gMAopID0+IHsKICAgIGNvbnN0IG9yaWdpbmFsQWxwaGEgPSBhbHBoYTsKICAgIGNvbnN0IG9yaWdpbmFsQmV0YSA9IGJldGE7CgogICAgcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzKys7CiAgICBpZiAoIXBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKSBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSA9IDA7CiAgICBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSsrOwoKICAgIC8vIOWPtuiKgueCue+8muWujOaVtOW9ouWKv+ivhOS8sCArIOWQg+WtkOmdmem7mOaQnOe0ou+8iFFT4omkM++8iQogICAgaWYgKGQgPT09IDApIHsKICAgICAgICByZXR1cm4gcXVpZXNjZW5jZSgKICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsCiAgICAgICAgICAgIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCAzLCBib2FyZEhhc2gKICAgICAgICApOwogICAgfQoKICAgIC8vIOe9ruaNouihqOaOoua1i++8iGtleSDlkKvooYzmo4vmlrnvvIzpgb/lhY3lkIzlvaLkuI3lkIzotbDmlrnlhrLnqoHvvIkKICAgIGNvbnN0IHR0S2V5ID0gbWFrZVNlYXJjaFRUS2V5KGIsIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSGFzaCk7CiAgICBjb25zdCB0dEVudHJ5ID0gdHJhbnNwb3NpdGlvblRhYmxlLnJldHJpZXZlKHR0S2V5KTsKICAgIGxldCB0dE1vdmUgPSBudWxsOwogICAgaWYgKHR0RW50cnkpIHsKICAgICAgICB0dE1vdmUgPSB0dEVudHJ5LmJlc3RNb3ZlIHx8IG51bGw7CiAgICAgICAgaWYgKHR0RW50cnkuZGVwdGggPj0gZCkgewogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnZXhhY3QnKSB7CiAgICAgICAgICAgICAgICByZXR1cm4gewogICAgICAgICAgICAgICAgICAgIHZhbHVlOiB0dEVudHJ5LnZhbHVlLAogICAgICAgICAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRQogICAgICAgICAgICAgICAgICAgICAgICA/ICh0dEVudHJ5Lm1vdmVTZXF1ZW5jZSB8fCAodHRNb3ZlID8gW21vdmVUb09iamVjdCh0dE1vdmUpXSA6IFtdKSkKICAgICAgICAgICAgICAgICAgICAgICAgOiBbXQogICAgICAgICAgICAgICAgfTsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnbG93ZXJib3VuZCcgJiYgdHRFbnRyeS52YWx1ZSA+PSBiZXRhKSB7CiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9OwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICd1cHBlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlIDw9IGFscGhhKSB7CiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9OwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIGNvbnN0IHNlYXJjaEluZm8gPSBwcmVwYXJlU2VhcmNoSW5mbyhiLCBjdXJyZW50UGxheWVyKTsKICAgIGNvbnN0IGFiUGllY2VzSW5mbyA9IHNlYXJjaEluZm8ucGllY2VzSW5mbzsKICAgIGNvbnN0IGFiQm9hcmRJbmZvID0gc2VhcmNoSW5mby5ib2FyZEluZm87CiAgICBjb25zdCBjdXJyZW50UGxheWVyQ29sb3IgPSBjdXJyZW50UGxheWVyOwogICAgY29uc3QgaW5DaGVjayA9IHNlYXJjaEluZm8uaW5DaGVjayB8fAogICAgICAgICAgICAgICAgICAgIChjdXJyZW50UGxheWVyQ29sb3IgPT09ICdyZWQnICYmIGFiQm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwKICAgICAgICAgICAgICAgICAgICAoY3VycmVudFBsYXllckNvbG9yID09PSAnYmxhY2snICYmIGFiQm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKTsKCiAgICBjb25zdCB0ZXJtaW5hbFNjb3JlID0gKG1hdGVJbkNoZWNrKSA9PiB7CiAgICAgICAgY29uc3QgaXNJbml0aWF0b3JXaW5uZXIgPSBjdXJyZW50UGxheWVyQ29sb3IgIT09IHNlYXJjaEluaXRpYXRvcjsKICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7CiAgICAgICAgcmV0dXJuIHsKICAgICAgICAgICAgdmFsdWU6IGJhc2VTY29yZSArIChpc0luaXRpYXRvcldpbm5lciA/IGQgOiAoc2VhcmNoRGVwdGggLSBkKSksCiAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogW10sCiAgICAgICAgICAgIHRlcm1pbmFsOiBtYXRlSW5DaGVjayA/ICdjaGVja21hdGUnIDogJ3N0YWxlbWF0ZScKICAgICAgICB9OwogICAgfTsKCiAgICAvLyDml6DkvKrlkIjms5XnnYDvvJrnm7TmjqXnu4jlsYDvvIjmnoHlsJHop4HvvJvpgJrluLjoh7PlsJHmnInlsIbnmoTotbDliqjvvIkKICAgIGlmICghc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0IHx8IHNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdC5sZW5ndGggPT09IDApIHsKICAgICAgICBjb25zdCBnYW1lU3RhdGUgPSBhYkJvYXJkSW5mby5nYW1lU3RhdGU7CiAgICAgICAgaWYgKGdhbWVTdGF0ZSAmJiAoZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ2NoZWNrbWF0ZScgfHwgZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ3N0YWxlbWF0ZScpKSB7CiAgICAgICAgICAgIGNvbnN0IGlzSW5pdGlhdG9yV2lubmVyID0gZ2FtZVN0YXRlLndpbm5lciA9PT0gc2VhcmNoSW5pdGlhdG9yOwogICAgICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7CiAgICAgICAgICAgIGNvbnN0IHN0ZXBzRnJvbVJvb3QgPSBzZWFyY2hEZXB0aCAtIGQ7CiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogc3RlcHNGcm9tUm9vdCksIG1vdmVTZXF1ZW5jZTogW10gfTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuIHRlcm1pbmFsU2NvcmUoaW5DaGVjayk7CiAgICB9CgogICAgLy8g56m6552A5Ymq5p6d77ya5LuFIG1heGltaXppbmfvvJvlrozmlbTor4TkvLDkuIvkv53lrojlkK/nlKgKICAgIGlmICgKICAgICAgICBTRUFSQ0hfRU5BQkxFX05NUCAmJgogICAgICAgIGFsbG93TnVsbCAmJgogICAgICAgIG1heGltaXppbmcgJiYKICAgICAgICBkID49IDMgJiYKICAgICAgICAhaW5DaGVjayAmJgogICAgICAgIGNhbkRvTnVsbE1vdmUoYiwgY3VycmVudFBsYXllckNvbG9yKQogICAgKSB7CiAgICAgICAgY29uc3QgbnVsbFIgPSBkID49IDYgPyAzIDogMjsKICAgICAgICBjb25zdCBudWxsRGVwdGggPSBkIC0gMSAtIG51bGxSOwogICAgICAgIGlmIChudWxsRGVwdGggPj0gMCkgewogICAgICAgICAgICBjb25zdCBudWxsUGxheWVyID0gY3VycmVudFBsYXllckNvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgICAgICAgICAgY29uc3QgbnVsbE1heGltaXppbmcgPSBudWxsUGxheWVyID09PSBzZWFyY2hJbml0aWF0b3I7CiAgICAgICAgICAgIC8vIOepuuedgOS4jeaUueWPmOWxgOmdouWTiOW4jO+8jOS7heihjOaji+aWueWPmOWMlu+8iFRUIGtleSDlkKsgc2lkZe+8iQogICAgICAgICAgICBjb25zdCBudWxsUmVzdWx0ID0gYWxwaGFCZXRhKAogICAgICAgICAgICAgICAgYiwgbnVsbERlcHRoLCBiZXRhIC0gMWUtNiwgYmV0YSwgbnVsbE1heGltaXppbmcsIG51bGxQbGF5ZXIsCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGZhbHNlLCBib2FyZEhhc2gKICAgICAgICAgICAgKTsKICAgICAgICAgICAgaWYgKG51bGxSZXN1bHQudmFsdWUgPj0gYmV0YSkgewogICAgICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IG51bGxSZXN1bHQudmFsdWUsIG1vdmVTZXF1ZW5jZTogW10gfTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KCiAgICBsZXQgbW92ZXMgPSBzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3Q7CgogICAgaWYgKCFwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0pIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSA9IDA7CiAgICBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gKz0gbW92ZXMubGVuZ3RoOwoKICAgIGNvbnN0IGtpbGxlcnNBdERlcHRoID0gKGtpbGxlck1vdmVzW2RdIHx8IFtudWxsLCBudWxsXSk7CiAgICBtb3ZlcyA9IHNvcnRNb3Zlc0Zhc3QobW92ZXMsIGIsIGN1cnJlbnRQbGF5ZXJDb2xvciwgYWJQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGFiQm9hcmRJbmZvLCB7CiAgICAgICAgdHRNb3ZlLAogICAgICAgIGtpbGxlcnM6IGtpbGxlcnNBdERlcHRoCiAgICB9KTsKCiAgICBjb25zdCBzdG9yZVRUID0gKHZhbHVlLCBiZXN0TW92ZSwgbW92ZVNlcXVlbmNlKSA9PiB7CiAgICAgICAgbGV0IGZsYWc7CiAgICAgICAgaWYgKHZhbHVlIDw9IG9yaWdpbmFsQWxwaGEpIGZsYWcgPSAndXBwZXJib3VuZCc7CiAgICAgICAgZWxzZSBpZiAodmFsdWUgPj0gb3JpZ2luYWxCZXRhKSBmbGFnID0gJ2xvd2VyYm91bmQnOwogICAgICAgIGVsc2UgZmxhZyA9ICdleGFjdCc7CiAgICAgICAgdHJhbnNwb3NpdGlvblRhYmxlLnN0b3JlKHR0S2V5LCBkLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUsIFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPyBtb3ZlU2VxdWVuY2UgOiBudWxsKTsKICAgIH07CgogICAgbGV0IGJlc3RFdmFsID0gbWF4aW1pemluZyA/IC1JbmZpbml0eSA6IEluZmluaXR5OwogICAgbGV0IGJlc3RNb3ZlID0gbnVsbDsKICAgIGxldCBiZXN0TW92ZVNlcXVlbmNlID0gW107CiAgICBsZXQgbGVnYWxNb3Zlc0ZvdW5kID0gMDsKCiAgICBmb3IgKGxldCBtb3ZlSW5kZXggPSAwOyBtb3ZlSW5kZXggPCBtb3Zlcy5sZW5ndGg7IG1vdmVJbmRleCsrKSB7CiAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW21vdmVJbmRleF07CiAgICAgICAgY29uc3QgaXNDYXB0dXJlID0gISFiW21vdmVUb1IobW92ZSldW21vdmVUb0MobW92ZSldOwogICAgICAgIGNvbnN0IGlzVFRNb3ZlID0gdHRNb3ZlICYmIGlzU2FtZU1vdmUobW92ZSwgdHRNb3ZlKTsKICAgICAgICBjb25zdCBpc0tpbGxlciA9CiAgICAgICAgICAgIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc0F0RGVwdGhbMF0pIHx8CiAgICAgICAgICAgIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc0F0RGVwdGhbMV0pOwoKICAgICAgICAvLyBMTVLvvJrpnaDlkI7nmoTlronpnZnnnYDms5XpmY3mt7EgMe+8iOWujOaVtOivhOS8sOS4i+S/neWuiO+8iQogICAgICAgIC8vIG1vdmVJbmRleCDlkKvkvKrlkIjms5Xluo/vvJvpnZ7ms5XnnYDot7Pov4flkI7nlaXlgY/kv53lrojvvIjlsJHpmY3mt7HvvInvvIzkuI3lvbHlk43mraPnoa7mgKcKICAgICAgICBsZXQgcmVkdWN0aW9uID0gMDsKICAgICAgICBpZiAoCiAgICAgICAgICAgIFNFQVJDSF9FTkFCTEVfTE1SICYmCiAgICAgICAgICAgIGQgPj0gNCAmJgogICAgICAgICAgICBtb3ZlSW5kZXggPj0gNCAmJgogICAgICAgICAgICAhaW5DaGVjayAmJgogICAgICAgICAgICAhaXNDYXB0dXJlICYmCiAgICAgICAgICAgICFpc1RUTW92ZSAmJgogICAgICAgICAgICAhaXNLaWxsZXIKICAgICAgICApIHsKICAgICAgICAgICAgcmVkdWN0aW9uID0gMTsKICAgICAgICB9CgogICAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYlttb3ZlRnJvbVIobW92ZSldW21vdmVGcm9tQyhtb3ZlKV07CiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlU2VhcmNoTW92ZShiLCBtb3ZlKTsKICAgICAgICBpZiAoU0VBUkNIX0RFRkVSX0xFR0FMSVRZICYmIGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllckNvbG9yKSkgewogICAgICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsKICAgICAgICAgICAgcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQrKzsKICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgfQogICAgICAgIGNvbnN0IG5leHRIYXNoID0gY2hpbGRCb2FyZEhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOwogICAgICAgIHZlcmlmeUJvYXJkSGFzaChiLCBuZXh0SGFzaCk7CiAgICAgICAgbGVnYWxNb3Zlc0ZvdW5kKys7CiAgICAgICAgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCsrOwoKICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7CiAgICAgICAgY29uc3QgbmV4dE1heGltaXppbmcgPSBuZXh0UGxheWVyID09PSBzZWFyY2hJbml0aWF0b3I7CgogICAgICAgIGxldCByZXN1bHQ7CiAgICAgICAgaWYgKHJlZHVjdGlvbiA+IDApIHsKICAgICAgICAgICAgY29uc3QgcmVkdWNlZERlcHRoID0gTWF0aC5tYXgoMCwgZCAtIDEgLSByZWR1Y3Rpb24pOwogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoCiAgICAgICAgICAgICAgICBiLCByZWR1Y2VkRGVwdGgsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwKICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgdHJ1ZSwgbmV4dEhhc2gKICAgICAgICAgICAgKTsKICAgICAgICAgICAgY29uc3QgbmVlZFJlc2VhcmNoID0gbWF4aW1pemluZwogICAgICAgICAgICAgICAgPyByZXN1bHQudmFsdWUgPiBhbHBoYQogICAgICAgICAgICAgICAgOiByZXN1bHQudmFsdWUgPCBiZXRhOwogICAgICAgICAgICBpZiAobmVlZFJlc2VhcmNoKSB7CiAgICAgICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoCiAgICAgICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwKICAgICAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHRydWUsIG5leHRIYXNoCiAgICAgICAgICAgICAgICApOwogICAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgcmVzdWx0ID0gYWxwaGFCZXRhKAogICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwKICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgdHJ1ZSwgbmV4dEhhc2gKICAgICAgICAgICAgKTsKICAgICAgICB9CgogICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOwoKICAgICAgICBpZiAobWF4aW1pemluZykgewogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlID4gYmVzdEV2YWwpIHsKICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOwogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOwogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsKICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgYWxwaGEgPSBNYXRoLm1heChhbHBoYSwgcmVzdWx0LnZhbHVlKTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmVzdEV2YWwpIHsKICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOwogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOwogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsKICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgYmV0YSA9IE1hdGgubWluKGJldGEsIHJlc3VsdC52YWx1ZSk7CiAgICAgICAgfQoKICAgICAgICBpZiAoYmV0YSA8PSBhbHBoYSkgewogICAgICAgICAgICBpZiAoIXBlcmZTdGF0cy5jdXRvZmZzW2RdKSBwZXJmU3RhdHMuY3V0b2Zmc1tkXSA9IDA7CiAgICAgICAgICAgIHBlcmZTdGF0cy5jdXRvZmZzW2RdKys7CiAgICAgICAgICAgIGlmICghaXNDYXB0dXJlKSB7CiAgICAgICAgICAgICAgICBzdG9yZUtpbGxlck1vdmUoZCwgbW92ZSk7CiAgICAgICAgICAgICAgICBhZGRIaXN0b3J5U2NvcmUobW92ZSwgZCk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgfQoKICAgIC8vIOW7tui/n+WQiOazleaAp++8muS8quWQiOazlemdnuepuuS9huaXoOS4gOWQiOazlSDihpIg5bCG5q27L+WbsOavmQogICAgaWYgKFNFQVJDSF9ERUZFUl9MRUdBTElUWSAmJiBsZWdhbE1vdmVzRm91bmQgPT09IDApIHsKICAgICAgICByZXR1cm4gdGVybWluYWxTY29yZShpbkNoZWNrKTsKICAgIH0KCiAgICBzdG9yZVRUKGJlc3RFdmFsLCBiZXN0TW92ZSwgYmVzdE1vdmVTZXF1ZW5jZSk7CiAgICByZXR1cm4geyB2YWx1ZTogYmVzdEV2YWwsIG1vdmVTZXF1ZW5jZTogU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA/IGJlc3RNb3ZlU2VxdWVuY2UgOiBbXSB9Owp9OwoKLy8gZXhhY3RSb290U2NvcmVzOiB0cnVlPUFuYWx5c2lzIOWFqOagueeyvuehruWIhu+8m2ZhbHNlPeWvueW8iOagh+WHhiBQVlPvvIhmYWlsLWxvdyDkuI3lm57mkJzvvIkKY29uc3QgZ2V0QmVzdE1vdmUgPSAoYm9hcmQsIHR1cm4sIGRlcHRoID0gNiwgcGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0ID0gZmFsc2UsIGV4YWN0Um9vdFNjb3JlcyA9IGZhbHNlLCBjb2xsZWN0TW92ZVNlcXVlbmNlT3ZlcnJpZGUgPSBudWxsKSA9PiB7CiAgY29uc3QgdGltZUxpbWl0ID0gNTAwMDsKCiAgLy8gRmlyc3QgdHJ5IHRvIGdldCBtb3ZlIGZyb20gb3BlbmluZyBib29rCiAgY29uc3QgYm9va01vdmUgPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShib2FyZCwgcGx5KTsKICAKICBpZiAoYm9va01vdmUpIHsKICAgIC8vIENoZWNrIGlmIGJvb2tNb3ZlIGlzIHZhbGlkIGZvciBjdXJyZW50IGJvYXJkCiAgICBpZiAoYm9va01vdmUuZnJvbSAmJiBib29rTW92ZS50byAmJiAKICAgICAgICB0eXBlb2YgYm9va01vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUuZnJvbS5jID09PSAnbnVtYmVyJyAmJgogICAgICAgIHR5cGVvZiBib29rTW92ZS50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUudG8uYyA9PT0gJ251bWJlcicpIHsKICAgICAgCiAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYm9hcmRbYm9va01vdmUuZnJvbS5yXVtib29rTW92ZS5mcm9tLmNdOwogICAgICAKICAgICAgaWYgKG1vdmluZ1BpZWNlICYmIG1vdmluZ1BpZWNlLmNvbG9yID09PSB0dXJuKSB7CiAgICAgICAgLy8gVmVyaWZ5IG1vdmUgaXMgdmFsaWQKICAgICAgICBjb25zdCB2YWxpZERlc3RpbmF0aW9ucyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIGJvb2tNb3ZlLmZyb20pOwogICAgICAgIGNvbnN0IGlzVmFsaWQgPSB2YWxpZERlc3RpbmF0aW9ucy5zb21lKGRlc3QgPT4gZGVzdC5yID09PSBib29rTW92ZS50by5yICYmIGRlc3QuYyA9PT0gYm9va01vdmUudG8uYyk7CiAgICAgICAgCiAgICAgICAgaWYgKGlzVmFsaWQpIHsKICAgICAgICAgIHJldHVybiB7IGJlc3RNb3ZlOiBib29rTW92ZSwgc2Vjb25kQmVzdE1vdmU6IG51bGwsIG1vdmVTZXF1ZW5jZTogW10sIHNlY29uZE1vdmVTZXF1ZW5jZTogW10sIGJlc3RNb3ZlU2NvcmU6IDAsIHNlY29uZEJlc3RNb3ZlU2NvcmU6IDAsIGFsbE1vdmVzV2l0aFNjb3JlczogW10gfTsKICAgICAgICB9CiAgICAgIH0KICAgIH0KICB9CgogIC8vIOagueiKgueCue+8mui/reS7o+WKoOa3sSArIFBWU++8m1RUL2tpbGxlci9oaXN0b3J5IOi3qOa3seW6puS/neeVme+8iOS7heW8gOWxgOa4heepuuS4gOasoe+8iQogIHJlc2V0UGVyZlN0YXRzKCk7CiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTsKICB0cmFuc3Bvc2l0aW9uVGFibGUucmVzZXRTdGF0cygpOwogIHRyYW5zcG9zaXRpb25UYWJsZS5jbGVhcigpOwogIGNsZWFyRXZhbENhY2hlKCk7CiAgY29uc3QgbWF4RGVwdGggPSBNYXRoLm1heCgxLCBkZXB0aCB8IDApOwogIHJlc2V0U2VhcmNoSGV1cmlzdGljcyhtYXhEZXB0aCk7CiAgc3luY0dlbmVyYWxQb3NDYWNoZShib2FyZCk7CiAgU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA9IHR5cGVvZiBjb2xsZWN0TW92ZVNlcXVlbmNlT3ZlcnJpZGUgPT09ICdib29sZWFuJwogICAgPyBjb2xsZWN0TW92ZVNlcXVlbmNlT3ZlcnJpZGUKICAgIDogISFleGFjdFJvb3RTY29yZXM7CgogIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7CiAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7CgogIGNvbnN0IHJvb3RFdmFsUmVzdWx0ID0gZXZhbHVhdGVCb2FyZChib2FyZCwgdHVybiwgZ2FtZVN0YWdlKTsKICBjb25zdCByb290UGllY2VzSW5mbyA9IHJvb3RFdmFsUmVzdWx0LnBpZWNlc0luZm87CiAgY29uc3Qgcm9vdEJvYXJkSW5mbyA9IHJvb3RFdmFsUmVzdWx0LmJvYXJkSW5mbzsKCiAgLy8g5pS26ZuG5qC56IqC54K56LWw5rOV77yI5Y+q5YGa5LiA5qyh77yJ77yb5pyq6KKr5bCG5pe26L+H5ruk6YCB5ZCDCiAgbGV0IHJvb3RNb3ZlcyA9IFtdOwogIGNvbnN0IHJvb3RJbkNoZWNrID0gKHR1cm4gPT09ICdyZWQnICYmIHJvb3RCb2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fAogICAgICAgICAgICAgICAgICAgICAgKHR1cm4gPT09ICdibGFjaycgJiYgcm9vdEJvYXJkSW5mby5ibGFja0lzSW5DaGVjayk7CgogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7CiAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICBpZiAoYm9hcmRbcl1bY10/LmNvbG9yID09PSB0dXJuKSB7CiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsKICAgICAgICBjb25zdCB2YWxpZERlc3RpbmF0aW9ucyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIHsgciwgYyB9KTsKICAgICAgICB2YWxpZERlc3RpbmF0aW9ucy5mb3JFYWNoKHRvID0+IHsKICAgICAgICAgIGNvbnN0IGlzQWNjZXB0YWJsZSA9IHJvb3RJbkNoZWNrIHx8IGlzUG9zaXRpb25BY2NlcHRhYmxlKGJvYXJkLCB7IHIsIGMgfSwgdG8sIHR1cm4sIHJvb3RCb2FyZEluZm8sIHJvb3RQaWVjZXNJbmZvLCBwaWVjZSwgZ2FtZVN0YWdlKTsKICAgICAgICAgIGlmIChpc0FjY2VwdGFibGUpIHsKICAgICAgICAgICAgcm9vdE1vdmVzLnB1c2goeyBmcm9tOiB7IHIsIGMgfSwgdG8sIHNjb3JlOiAwLCBtb3ZlU2VxdWVuY2U6IFtdIH0pOwogICAgICAgICAgfQogICAgICAgIH0pOwogICAgICB9CiAgICB9CiAgfQoKICBpZiAocm9vdE1vdmVzLmxlbmd0aCA9PT0gMCkgewogICAgcmV0dXJuIHsKICAgICAgYmVzdE1vdmU6IG51bGwsCiAgICAgIHNlY29uZEJlc3RNb3ZlOiBudWxsLAogICAgICBtb3ZlU2VxdWVuY2U6IFtdLAogICAgICBzZWNvbmRNb3ZlU2VxdWVuY2U6IFtdLAogICAgICBiZXN0TW92ZVNjb3JlOiAwLAogICAgICBzZWNvbmRCZXN0TW92ZVNjb3JlOiAwLAogICAgICBhbGxNb3Zlc1dpdGhTY29yZXM6IFtdCiAgICB9OwogIH0KCiAgY29uc3Qgc29ydFJvb3RNb3Zlc0J5U2NvcmUgPSAobW92ZXMpID0+IHsKICAgIG1vdmVzLnNvcnQoKGEsIGIpID0+IHsKICAgICAgY29uc3Qgc2NvcmVEaWZmID0gYi5zY29yZSAtIGEuc2NvcmU7CiAgICAgIGlmIChNYXRoLmFicyhzY29yZURpZmYpIDwgMWUtNikgewogICAgICAgIGlmIChhLnNjb3JlID4gMCkgewogICAgICAgICAgcmV0dXJuIChhLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApIC0gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCk7CiAgICAgICAgfQogICAgICAgIGlmIChhLnNjb3JlIDwgMCkgewogICAgICAgICAgcmV0dXJuIChiLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApIC0gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCk7CiAgICAgICAgfQogICAgICAgIHJldHVybiAwOwogICAgICB9CiAgICAgIHJldHVybiBzY29yZURpZmY7CiAgICB9KTsKICB9OwoKICBjb25zdCBwcm9tb3RlUm9vdE1vdmUgPSAobW92ZXMsIHByZWZlcnJlZCkgPT4gewogICAgaWYgKCFwcmVmZXJyZWQpIHJldHVybjsKICAgIGNvbnN0IGlkeCA9IG1vdmVzLmZpbmRJbmRleCgobSkgPT4gaXNTYW1lTW92ZShtLCBwcmVmZXJyZWQpKTsKICAgIGlmIChpZHggPiAwKSB7CiAgICAgIGNvbnN0IFtoaXRdID0gbW92ZXMuc3BsaWNlKGlkeCwgMSk7CiAgICAgIG1vdmVzLnVuc2hpZnQoaGl0KTsKICAgIH0KICB9OwoKICBjb25zdCB3b3JrQm9hcmQgPSBib2FyZC5tYXAoKHJvdykgPT4gWy4uLnJvd10pOwogIGNvbnN0IE5VTExfV0lORE9XX0VQUyA9IDFlLTY7CiAgY29uc3QgbmV4dFR1cm4gPSB0dXJuID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAvLyDmoLnlsYDpnaLlk4jluIzlj6rnrpfkuIDmrKHvvJvlop7ph4/mqKHlvI/mlbTmo7XmkJzntKLmoJHnlLHmraTmtL7nlJ8KICBjb25zdCByb290SGFzaCA9IHpvYnJpc3RIYXNoZXIuaGFzaChib2FyZCk7CiAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsKICBjb25zdCByb290VFRLZXkgPSBTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVAogICAgPyB6b2JyaXN0SGFzaGVyLnR0S2V5RnJvbUhhc2gocm9vdEhhc2gsIHR1cm4pCiAgICA6IGAke3Jvb3RIYXNofToke3R1cm59YDsKCiAgY29uc29sZS5sb2coCiAgICBgU3RhcnRpbmcgaXRlcmF0aXZlIGRlZXBlbmluZyB8IHR1cm46ICR7dHVybn0sIG1heERlcHRoOiAke21heERlcHRofSwgaW5jclpvYnJpc3Q6ICR7U0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1R9LCBsZWFmQXR0YWNrQml0czogJHtTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUU30sIHJlbGF0aW9uTWFza3M6ICR7U0VBUkNIX1JFTEFUSU9OX01BU0tTfSwgY29sbGVjdE1vdmVTZXF1ZW5jZTogJHtTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFfSwgdGltZUxpbWl0OiAke3RpbWVMaW1pdH1tcywgZW5hYmxlVGltZUxpbWl0OiAke2VuYWJsZVRpbWVMaW1pdH1gCiAgKTsKCiAgbGV0IGNvbXBsZXRlZERlcHRoID0gMDsKCiAgZm9yIChsZXQgY3VycmVudERlcHRoID0gMTsgY3VycmVudERlcHRoIDw9IG1heERlcHRoOyBjdXJyZW50RGVwdGgrKykgewogICAgaWYgKGVuYWJsZVRpbWVMaW1pdCAmJiBjb21wbGV0ZWREZXB0aCA+IDAgJiYgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA+IHRpbWVMaW1pdCkgewogICAgICBjb25zb2xlLmxvZyhgSUQgc3RvcHBlZCBiZWZvcmUgZGVwdGggJHtjdXJyZW50RGVwdGh9IGR1ZSB0byB0aW1lIGxpbWl0IChsYXN0IGNvbXBsZXRlZD0ke2NvbXBsZXRlZERlcHRofSlgKTsKICAgICAgYnJlYWs7CiAgICB9CgogICAgLy8g5rWF5bGC5pyA5L2z552AICsgVFQg552A5o6S5Yiw5pyA5YmN77yM5L6b5pys5bGCIFBWUyDnrKzkuIDnnYDlhajnqpfkvb/nlKgKICAgIGNvbnN0IHR0RW50cnkgPSB0cmFuc3Bvc2l0aW9uVGFibGUucmV0cmlldmUocm9vdFRUS2V5KTsKICAgIGNvbnN0IHR0TW92ZSA9IHR0RW50cnkgJiYgdHRFbnRyeS5iZXN0TW92ZSA/IHR0RW50cnkuYmVzdE1vdmUgOiBudWxsOwogICAgY29uc3QgcHJldkJlc3QgPSByb290TW92ZXNbMF07CiAgICBzb3J0TW92ZXNGYXN0KHJvb3RNb3ZlcywgYm9hcmQsIHR1cm4sIHJvb3RQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIHJvb3RCb2FyZEluZm8sIHsKICAgICAgdHRNb3ZlLAogICAgICBraWxsZXJzOiBraWxsZXJNb3Zlc1tNYXRoLm1heCgwLCBjdXJyZW50RGVwdGggLSAxKV0gfHwgW251bGwsIG51bGxdCiAgICB9KTsKICAgIC8vIOS4iuS4gOWxguacgOS9s+edgOaUvuesrOS4gO+8iOacgOWQjiBwcm9tb3Rl77yJ77yM5L+d6K+B5pys5bGCIFBWUyDpppbnnYDlhajnqpflkb3kuK3ng63ot6/lvoQKICAgIHByb21vdGVSb290TW92ZShyb290TW92ZXMsIHR0TW92ZSk7CiAgICBwcm9tb3RlUm9vdE1vdmUocm9vdE1vdmVzLCBwcmV2QmVzdCk7CgogICAgY29uc3QgdXNlRXhhY3RSb290ID0gZXhhY3RSb290U2NvcmVzICYmIGN1cnJlbnREZXB0aCA9PT0gbWF4RGVwdGg7CiAgICBsZXQgcm9vdEFscGhhID0gLUluZmluaXR5OwoKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcm9vdE1vdmVzLmxlbmd0aDsgaSsrKSB7CiAgICAgIGNvbnN0IGl0ZW0gPSByb290TW92ZXNbaV07CiAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gd29ya0JvYXJkW2l0ZW0uZnJvbS5yXVtpdGVtLmZyb20uY107CiAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZU1vdmUod29ya0JvYXJkLCBpdGVtLmZyb20sIGl0ZW0udG8pOwogICAgICBjb25zdCBjaGlsZEhhc2ggPSBjaGlsZEJvYXJkSGFzaChyb290SGFzaCwgaXRlbSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsKICAgICAgdmVyaWZ5Qm9hcmRIYXNoKHdvcmtCb2FyZCwgY2hpbGRIYXNoKTsKCiAgICAgIGxldCBhbHBoYUJldGFSZXN1bHQ7CiAgICAgIGxldCBzY29yZUlzRXhhY3QgPSB0cnVlOwogICAgICBpZiAoaSA9PT0gMCB8fCByb290QWxwaGEgPT09IC1JbmZpbml0eSkgewogICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgKICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwgLUluZmluaXR5LCBJbmZpbml0eSwKICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaAogICAgICAgICk7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgY29uc3QgcHJvYmUgPSBhbHBoYUJldGEoCiAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsCiAgICAgICAgICByb290QWxwaGEsIHJvb3RBbHBoYSArIE5VTExfV0lORE9XX0VQUywKICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaAogICAgICAgICk7CiAgICAgICAgaWYgKHByb2JlLnZhbHVlID4gcm9vdEFscGhhKSB7CiAgICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwgcm9vdEFscGhhLCBJbmZpbml0eSwKICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoCiAgICAgICAgICApOwogICAgICAgIH0gZWxzZSBpZiAodXNlRXhhY3RSb290KSB7CiAgICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwgLUluZmluaXR5LCBJbmZpbml0eSwKICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoCiAgICAgICAgICApOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAvLyBmYWlsLWxvd++8muaOoua1i+WIhuWPquaYr+S4iueVjO+8jOS4jeiDveW9k+eyvuehruWIhuWGmeWFpe+8iOWQpuWImSBJRCDkuIvlsYLmjpLluo/ooqvmsaHmn5PvvIzmmJPlj43lpI3otbDngq7vvIkKICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IHByb2JlOwogICAgICAgICAgc2NvcmVJc0V4YWN0ID0gZmFsc2U7CiAgICAgICAgfQogICAgICB9CgogICAgICB1bm1ha2VNb3ZlKHdvcmtCb2FyZCwgaXRlbS5mcm9tLCBpdGVtLnRvLCBjYXB0dXJlZCk7CgogICAgICBpZiAoc2NvcmVJc0V4YWN0KSB7CiAgICAgICAgaXRlbS5zY29yZSA9IGFscGhhQmV0YVJlc3VsdC52YWx1ZTsKICAgICAgICBpdGVtLm1vdmVTZXF1ZW5jZSA9IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UKICAgICAgICAgID8gW3sgZnJvbTogaXRlbS5mcm9tLCB0bzogaXRlbS50byB9LCAuLi4oYWxwaGFCZXRhUmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldCiAgICAgICAgICA6IFtdOwogICAgICAgIGlmIChpdGVtLnNjb3JlID4gcm9vdEFscGhhKSB7CiAgICAgICAgICByb290QWxwaGEgPSBpdGVtLnNjb3JlOwogICAgICAgIH0KICAgICAgfSBlbHNlIGlmIChpdGVtLnNjb3JlID4gcm9vdEFscGhhKSB7CiAgICAgICAgLy8g5L+d55WZ5LiK5LiA5bGC5YiG5pWw77yb6Iul5LuN6auY5LqO5b2T5YmNIM6x77yI5byC5bi477yJ77yM55Wl6ZmN5Lul5YWN5oyk5o6J55yf5pyA5LyYCiAgICAgICAgaXRlbS5zY29yZSA9IHJvb3RBbHBoYSAtIDFlLTM7CiAgICAgIH0KICAgIH0KCiAgICBzb3J0Um9vdE1vdmVzQnlTY29yZShyb290TW92ZXMpOwogICAgY29tcGxldGVkRGVwdGggPSBjdXJyZW50RGVwdGg7CgogICAgLy8g5oqK5pys5bGC5pyA5L2z552A5YaZ5YWlIFRU77yM5L6b5pu05rex5LiA5bGC5qC55o6S5bqPCiAgICB0cmFuc3Bvc2l0aW9uVGFibGUuc3RvcmUoCiAgICAgIHJvb3RUVEtleSwKICAgICAgY3VycmVudERlcHRoLAogICAgICByb290TW92ZXNbMF0uc2NvcmUsCiAgICAgICdleGFjdCcsCiAgICAgIHJvb3RNb3Zlc1swXSwKICAgICAgU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA/IChyb290TW92ZXNbMF0ubW92ZVNlcXVlbmNlIHx8IFtdKSA6IG51bGwKICAgICk7CgogICAgY29uc29sZS5sb2coCiAgICAgIGBJRCBkZXB0aCAke2N1cnJlbnREZXB0aH0vJHttYXhEZXB0aH0gZG9uZSB8IGJlc3Q9JHtKU09OLnN0cmluZ2lmeShyb290TW92ZXNbMF0uZnJvbSl9LT4ke0pTT04uc3RyaW5naWZ5KHJvb3RNb3Zlc1swXS50byl9IHNjb3JlPSR7cm9vdE1vdmVzWzBdLnNjb3JlfSBlbGFwc2VkPSR7RGF0ZS5ub3coKSAtIHN0YXJ0VGltZX1tc2AKICAgICk7CiAgfQoKICBjb25zdCBiZXN0TW92ZSA9IHJvb3RNb3Zlc1swXSB8fCBudWxsOwogIGNvbnN0IHNlY29uZEJlc3RNb3ZlID0gcm9vdE1vdmVzLmxlbmd0aCA+IDEgPyByb290TW92ZXNbMV0gOiBudWxsOwogIGNvbnN0IGJlc3RNb3ZlU2VxdWVuY2UgPSBiZXN0TW92ZSA/IChiZXN0TW92ZS5tb3ZlU2VxdWVuY2UgfHwgW10pIDogW107CiAgY29uc3Qgc2Vjb25kTW92ZVNlcXVlbmNlID0gc2Vjb25kQmVzdE1vdmUgPyAoc2Vjb25kQmVzdE1vdmUubW92ZVNlcXVlbmNlIHx8IFtdKSA6IFtdOwogIGNvbnN0IGJlc3RNb3ZlU2NvcmUgPSBiZXN0TW92ZSA/IGJlc3RNb3ZlLnNjb3JlIDogMDsKICBjb25zdCBzZWNvbmRCZXN0TW92ZVNjb3JlID0gc2Vjb25kQmVzdE1vdmUgPyBzZWNvbmRCZXN0TW92ZS5zY29yZSA6IDA7CgogIGNvbnN0IGFsbE1vdmVzV2l0aFNjb3JlcyA9IHJvb3RNb3Zlcy5tYXAoKG1vdmVJbmZvKSA9PiAoewogICAgbW92ZTogewogICAgICBmcm9tOiBtb3ZlSW5mby5mcm9tLAogICAgICB0bzogbW92ZUluZm8udG8KICAgIH0sCiAgICBzY29yZTogbW92ZUluZm8uc2NvcmUsCiAgICBtb3ZlU2VxdWVuY2U6IG1vdmVJbmZvLm1vdmVTZXF1ZW5jZSB8fCBbXQogIH0pKTsKCiAgcmV0dXJuIHsKICAgIGJlc3RNb3ZlLAogICAgc2Vjb25kQmVzdE1vdmUsCiAgICBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UsCiAgICBzZWNvbmRNb3ZlU2VxdWVuY2UsCiAgICBiZXN0TW92ZVNjb3JlLAogICAgc2Vjb25kQmVzdE1vdmVTY29yZSwKICAgIGFsbE1vdmVzV2l0aFNjb3JlcywKICAgIGNvbXBsZXRlZERlcHRoCiAgfTsKfTsKCi8vIC0tLSBXT1JLRVIgTElTVEVORVIgKOe7n+S4gOa2iOaBr+WkhOeQhikgLS0tCg==';
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

