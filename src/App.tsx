
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovDQoNCi8vIOaji+ebmOW4uOmHj+WumuS5iQ0KY29uc3QgUk9XUyA9IDEwOw0KY29uc3QgQ09MUyA9IDk7DQoNCi8vIOaji+WtkOexu+Wei+WumuS5iQ0KY29uc3QgUElFQ0VfVFlQRVMgPSB7DQogICAgR0VORVJBTDogJ2dlbmVyYWwnLA0KICAgIENIQVJJT1Q6ICdjaGFyaW90JywNCiAgICBDQU5OT046ICdjYW5ub24nLA0KICAgIEhPUlNFOiAnaG9yc2UnLA0KICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLA0KICAgIEFEVklTT1I6ICdhZHZpc29yJywNCiAgICBTT0xESUVSOiAnc29sZGllcicNCn07DQoNCi8vIOadkOaWmeWAvOadg+mHjemFjee9rg0KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGdlbmVyYWw6IDEwMDAwLCAgLy8g5bCGL+W4hQ0KICAgIGNoYXJpb3Q6IDkwMCwgICAgIC8vIOi9pg0KICAgIGNhbm5vbjogew0KICAgICAgICBlYXJseTogNDUwLCAgICAvLyDlvIDlsYDpmLbmrrUNCiAgICAgICAgbWlkOiA0MDAsICAgICAgLy8g5Lit5bGA6Zi25q61DQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQ0KICAgIH0sICAgICAgICAgICAgICAgIC8vIOeCrg0KICAgIGhvcnNlOiB7DQogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDQ1MCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsDQogICAgZWxlcGhhbnQ6IDIwMCwgICAgLy8g6LGhL+ebuA0KICAgIGFkdmlzb3I6IDIwMCwgICAgIC8vIOWjqy/ku5UNCiAgICBzb2xkaWVyOiB7DQogICAgICAgIGVhcmx5OiAxMDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDIwMCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSAgICAgICAgICAgICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIOaji+WtkOS7t+WAvOadg+mHjemFjee9rg0KbGV0IFZBTFVFX1dFSUdIVFMgPSB7DQogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQ0KICAgIC8vcG9zaXRpb246IDAuMiwgICAvLyDkvY3nva7lgLzmnYPph40NCiAgICAvL3RocmVhdDogMC4xNSwgICAgLy8g5aiB6IOB5YC85p2D6YeNDQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQ0KICAgIC8vc2FmZXR5OiAwLjEsICAgICAvLyDlronlhajlgLzmnYPph40NCiAgICAvL21vYmlsaXR5OiAwLjA1ICAgLy8g5py65Yqo5YC85p2D6YeNDQoNCiAgICBtYXRlcmlhbDogMSwgICAgLy8g5p2Q5paZ5YC85p2D6YeNDQogICAgcG9zaXRpb246IDEsICAgIC8vIOS9jee9ruWAvOadg+mHjQ0KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQ0KICAgIHRhY3RpYzogMSwgICAgICAvLyDmiJjmnK/lgLzmnYPph40NCiAgICBzYWZldHk6IDEsICAgICAgLy8g5a6J5YWo5YC85p2D6YeNDQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQ0KfTsNCg0KLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XDQpjb25zdCBFVkFMVUFUSU9OX1BBUkFNRVRFUlMgPSB7DQogICAgLy8g5py65Yqo5YC85Y+C5pWwDQogICAgbW9iaWxpdHk6IHsNCiAgICAgICAgYmFzZU1vdmVWYWx1ZTogMSwgICAgICAvLyDln7rnoYDnp7vliqjku7flgLwNCiAgICB9LA0KICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQ0KICAgIGNoZWNrOiB7DQogICAgICAgIGJvbnVzOiA4MA0KICAgIH0sDQogICAgLy8g5biu5Yqp5YWz57O75Y+C5pWwDQogICAgYXNzaXN0OiB7DQogICAgICAgIC8vY2Fubm9uU2NyZWVuVmFsdWU6IDQwICAvLyDngq7mnrbku7flgLwNCiAgICAgICAgY2Fubm9uU2NyZWVuVmFsdWU6IDAgIC8vIOeCruaetuS7t+WAvA0KICAgIH0sDQogICAgLy8g6Zi75oyh5YWz57O75Y+C5pWwDQogICAgYmxvY2s6IHsNCiAgICAgICAgLy9lbmVteUNoYXJpb3RCbG9ja1ZhbHVlOiAyMCwgICAgIC8vIOmYu+aMoeWvueaWuei9puS7t+WAvA0KICAgICAgICAvL2VuZW15SG9yc2VCbG9ja1ZhbHVlOiAxNSwgICAgICAgLy8g5Yir5a+55pa56ams6IW/5Lu35YC8DQogICAgICAgIC8vZW5lbXlFbGVwaGFudEJsb2NrVmFsdWU6IDEwLCAgICAvLyDloLXloZ7lr7nmlrnosaHnnLzku7flgLwNCiAgICAgICAgLy9hbGx5Q2hhcmlvdEJsb2NrUGVuYWx0eTogMjAsICAgIC8vIOmYu+aMoeW3seaWuei9puaDqee9mg0KICAgICAgICAvL2FsbHlIb3JzZUJsb2NrUGVuYWx0eTogMTUsICAgICAgLy8g5Yir5bex5pa56ams6IW/5oOp572aDQogICAgICAgIC8vYWxseUVsZXBoYW50QmxvY2tQZW5hbHR5OiAxMCAgICAvLyDloLXloZ7lt7HmlrnosaHnnLzmg6nnvZoNCg0KICAgICAgICBlbmVteUNoYXJpb3RCbG9ja1ZhbHVlOiAwLCAgICAgLy8g6Zi75oyh5a+55pa56L2m5Lu35YC8DQogICAgICAgIGVuZW15SG9yc2VCbG9ja1ZhbHVlOiAwLCAgICAgICAvLyDliKvlr7nmlrnpqazohb/ku7flgLwNCiAgICAgICAgZW5lbXlFbGVwaGFudEJsb2NrVmFsdWU6IDAsICAgIC8vIOWgteWhnuWvueaWueixoeecvOS7t+WAvA0KICAgICAgICBhbGx5Q2hhcmlvdEJsb2NrUGVuYWx0eTogMCwgICAgLy8g6Zi75oyh5bex5pa56L2m5oOp572aDQogICAgICAgIGFsbHlIb3JzZUJsb2NrUGVuYWx0eTogMCwgICAgICAvLyDliKvlt7Hmlrnpqazohb/mg6nnvZoNCiAgICAgICAgYWxseUVsZXBoYW50QmxvY2tQZW5hbHR5OiAwICAgIC8vIOWgteWhnuW3seaWueixoeecvOaDqee9mg0KICAgIH0NCn07DQoNCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rg0KY29uc3QgUE9TSVRJT05fVEFCTEVTID0gew0KICAgIC8vIOWFtS/ljZLkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBzb2xkaWVyOiBbDQogICAgICAgIFswLCA1LCAxMCwgMTUsIDIwLCAxNSwgMTAsIDUsIDBdLA0KICAgICAgICBbNSwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgY2hhcmlvdDogWw0KICAgICAgICBbNSwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDEwLCA1LCAxNSwgMCwgMTUsIDUsIDEwLCAxMF0sDQogICAgICAgIFswLCAxMCwgNSwgNSwgNSwgNSwgMTAsIDUsIDBdDQogICAgXSwNCiAgICAvLyDpqazkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBob3JzZTogWw0KICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgICAgICAgWzAsIDUsIDI1LCAxMCwgMTAsIDEwLCAyNSwgNSwgMF0sDQogICAgICAgIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sDQogICAgICAgIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMjUsIDIwLCAwLCAyMCwgMjUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgICAgICAgWzUsIDAsIDUsIDUsIDAsIDUsIDUsIDAsIDVdLA0KICAgICAgICBbMCwgMCwgMCwgNSwgLTIwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDngq7kvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBjYW5ub246IFsNCiAgICAgICAgWzEwLCAyMCwgMTUsIDEwLCAwLCAxMCwgMTUsIDIwLCAxMF0sDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLA0KICAgICAgICBbNSwgNSwgMTUsIDUsIDI1LCA1LCAxNSwgNSwgNV0sDQogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLA0KICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogICAgICAgIFsxMCwgMTAsIDE1LCAyMCwgMzAsIDIwLCAxNSwgMTAsIDEwXSwgDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBlbGVwaGFudDogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g5aOr5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgYWR2aXNvcjogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCA1LCAwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDEwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0NCiAgICBdDQp9Ow0KDQovLyDojrflj5bmo4vlrZDnmoTmnZDmlpnlgLwNCmNvbnN0IGdldE1hdGVyaWFsVmFsdWUgPSAocGllY2UsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOw0KICAgIA0KICAgIC8vIOmSiOWvueacieWIhumYtuauteadkOaWmeWAvOeahOWFteenje+8iOWFteOAgeeCruOAgemprO+8ieiwg+aVtOadkOaWmeWAvA0KICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7DQogICAgICAgIHZhbHVlID0gdmFsdWVbZ2FtZVN0YWdlXSB8fCB2YWx1ZS5taWQ7DQogICAgfQ0KICAgIA0KICAgIHJldHVybiB2YWx1ZTsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOS9jee9ruWAvA0KY29uc3QgZ2V0UG9zaXRpb25WYWx1ZSA9IChwaWVjZSwgciwgYykgPT4gew0KICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOw0KICAgIGlmICghdGFibGUpIHJldHVybiAwOw0KICAgIA0KICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqA0KICAgIGNvbnN0IHJvd0lkeCA9IHBpZWNlLmNvbG9yID09PSAncmVkJyA/ICg5LSByKSA6IHI7DQogICAgcmV0dXJuIHRhYmxlW3Jvd0lkeF1bY10gfHwgMDsNCn07DQoNCi8vIOaUu+WHu+S9jeWbvu+8mjkwIOagvOeUqCAzw5dVaW50MzLjgILmkJzntKLlj7blj6rpnIDjgIzmmK/lkKbmlYzmjqfjgI3vvJvngrnmo4svVUkg5LuN55So5o6n5Yi26ICF5YiX6KGo44CCDQpjb25zdCBBVFRBQ0tfV09SRFMgPSAzOw0KY29uc3Qgc2NyYXRjaFJlZEF0dGFjayA9IG5ldyBVaW50MzJBcnJheShBVFRBQ0tfV09SRFMpOw0KY29uc3Qgc2NyYXRjaEJsYWNrQXR0YWNrID0gbmV3IFVpbnQzMkFycmF5KEFUVEFDS19XT1JEUyk7DQovLyB0cnVlPeaQnOe0ouWPtueUqOaUu+WHu+S9jeWbvu+8iOm7mOiupO+8ie+8m2ZhbHNlPeWPtuivhOS8sOS7jeW7uiAxMMOXOSDmjqfliLbogIXooajvvIhBL0LvvIkNCmxldCBTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUUyA9IHRydWU7DQoNCmNvbnN0IGNsZWFyQXR0YWNrQml0cyA9IChiaXRzKSA9PiB7DQogICAgYml0c1swXSA9IDA7DQogICAgYml0c1sxXSA9IDA7DQogICAgYml0c1syXSA9IDA7DQp9Ow0KDQpjb25zdCBzZXRBdHRhY2tCaXQgPSAoYml0cywgc3EpID0+IHsNCiAgICBiaXRzW3NxID4+PiA1XSB8PSAoMSA8PCAoc3EgJiAzMSkpOw0KfTsNCg0KY29uc3QgaGFzQXR0YWNrQml0ID0gKGJpdHMsIHNxKSA9PiAoYml0c1tzcSA+Pj4gNV0gJiAoMSA8PCAoc3EgJiAzMSkpKSAhPT0gMDsNCg0KY29uc3QgbWFrZUVtcHR5Q29udHJvbGxlckdyaWQgPSAoKSA9Pg0KICAgIEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpLm1hcCgoKSA9PiBbXSkpOw0KDQovLyDkuLvor4TkvLDlh73mlbAgLSDor6bnu4bor4TkvLDmo4vnm5jlsYDlir/vvIhVSSAvIOeCueaji+WFs+ezuyAvIOaQnOe0ouWPtiAvIOagueiKgueCue+8iQ0KLy8gb3B0aW9ucy5mb3JTZWFyY2hMZWFmOiDku4Xot7Pov4fnu4jlsYAgZ2V0VmFsaWRNb3Zlc++8iOaXoOedgOW3suWcqOeItuiKgueCueWkhOeQhu+8ie+8m+WPr+eUqOaUu+WHu+S9jeWbvuS7o+abv+aOp+WItuiAheihqA0KY29uc3QgZXZhbHVhdGVCb2FyZCA9IChib2FyZCwgaXNSZXBsYXkgPSBmYWxzZSwgY3VycmVudFBsYXllciA9IG51bGwsIGRlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcsIG9wdGlvbnMgPSBudWxsKSA9PiB7DQogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgIC8vIOe7n+iuoQ0KICAgIGlmIChjdXJyZW50UGxheWVyKSB7DQogICAgICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnRbY3VycmVudFBsYXllcl0rKzsNCiAgICB9DQogICAgY29uc3QgZm9yU2VhcmNoTGVhZiA9ICEhKG9wdGlvbnMgJiYgb3B0aW9ucy5mb3JTZWFyY2hMZWFmKTsNCiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gZm9yU2VhcmNoTGVhZiAmJiBTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUUzsNCg0KICAgIGNvbnN0IG91dHB1dFBoYXNlID0gZ2FtZVN0YWdlOw0KDQogICAgLy8g6YGN5Y6G5qOL55uY77ya5Y+q5pS26ZuG5a2Q5YqbL1BTVO+8m+edgOazlSvlhbPns7vnu5/kuIDlnKggY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMg5LiA5qyh5Yeg5L2V55Sf5oiQ77yI5a+56b2Q54Ku77yJDQogICAgbGV0IHBpZWNlc0luZm8gPSBbXTsNCiAgICBsZXQgcmVkTWF0ZXJpYWwgPSAwLCByZWRQb3NpdGlvbiA9IDA7DQogICAgbGV0IGJsYWNrTWF0ZXJpYWwgPSAwLCBibGFja1Bvc2l0aW9uID0gMDsNCiAgICANCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBjb25zdCBtYXRlcmlhbFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uVmFsdWUgPSBnZXRQb3NpdGlvblZhbHVlKHBpZWNlLCByLCBjKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKHBpZWNlLmNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgIHJlZE1hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICAgICAgcmVkUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgYmxhY2tNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgIGJsYWNrUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgcGllY2VzSW5mby5wdXNoKHsNCiAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICByLA0KICAgICAgICAgICAgICAgIGMsDQogICAgICAgICAgICAgICAgbW92ZXM6IFtdLA0KICAgICAgICAgICAgICAgIGFsbHlHdWFyZHM6IFtdLA0KICAgICAgICAgICAgICAgIG1hdGVyaWFsVmFsdWUsDQogICAgICAgICAgICAgICAgcG9zaXRpb25WYWx1ZSwNCiAgICAgICAgICAgICAgICB0aHJlYXRWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICBzYWZldHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICB0YWN0aWNWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlOiAwLA0KICAgICAgICAgICAgICAgIHRocmVhdDogW10sDQogICAgICAgICAgICAgICAgcHJvdGVjdDogW10NCiAgICAgICAgICAgIH0pOw0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIOaQnOe0ouWPtu+8muWkjeeUqOaUu+WHu+S9jeWbvu+8m+eCueajiy9VSe+8muWujOaVtCAxMMOXOSDmjqfliLbogIXliJfooagNCiAgICBsZXQgYm9hcmRJbmZvOw0KICAgIGlmICh1c2VBdHRhY2tCaXRzKSB7DQogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsNCiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7DQogICAgICAgIGJvYXJkSW5mbyA9IHsNCiAgICAgICAgICAgIHVzZUF0dGFja0JpdHM6IHRydWUsDQogICAgICAgICAgICByZWRBdHRhY2s6IHNjcmF0Y2hSZWRBdHRhY2ssDQogICAgICAgICAgICBibGFja0F0dGFjazogc2NyYXRjaEJsYWNrQXR0YWNrDQogICAgICAgIH07DQogICAgfSBlbHNlIHsNCiAgICAgICAgYm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsNCiAgICB9DQogICAgY2FsY3VsYXRlRGVyaXZlZFZhbHVlcyhib2FyZCwgcGllY2VzSW5mbywgY3VycmVudFBsYXllciwgZGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBib2FyZEluZm8sIGZvclNlYXJjaExlYWYpOw0KICAgIA0KICAgIC8vIOesrOS4ieatpe+8muiuoeeul+aAu+WIhu+8iOWPquiuoeeul+WJqeS9meWIhuaVsO+8jOWfuuehgOWIhuaVsOW3suWcqOaji+ebmOmBjeWOhuaXtuiuoeeul++8iQ0KICAgIGxldCByZWRUaHJlYXQgPSAwLCByZWRUYWN0aWMgPSAwLCByZWRTYWZldHkgPSAwLCByZWRNb2JpbGl0eSA9IDA7DQogICAgbGV0IGJsYWNrVGhyZWF0ID0gMCwgYmxhY2tUYWN0aWMgPSAwLCBibGFja1NhZmV0eSA9IDAsIGJsYWNrTW9iaWxpdHkgPSAwOw0KICAgIA0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGNvbnN0IHsgcGllY2UsIHRocmVhdFZhbHVlLCB0YWN0aWNWYWx1ZSwgc2FmZXR5VmFsdWUsIG1vYmlsaXR5VmFsdWUgfSA9IGluZm87DQogICAgICAgIA0KICAgICAgICBpZiAocGllY2UuY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICByZWRUaHJlYXQgKz0gdGhyZWF0VmFsdWU7DQogICAgICAgICAgICByZWRUYWN0aWMgKz0gdGFjdGljVmFsdWU7DQogICAgICAgICAgICByZWRTYWZldHkgKz0gc2FmZXR5VmFsdWU7DQogICAgICAgICAgICByZWRNb2JpbGl0eSArPSBtb2JpbGl0eVZhbHVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgYmxhY2tUaHJlYXQgKz0gdGhyZWF0VmFsdWU7DQogICAgICAgICAgICBibGFja1RhY3RpYyArPSB0YWN0aWNWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrU2FmZXR5ICs9IHNhZmV0eVZhbHVlOw0KICAgICAgICAgICAgYmxhY2tNb2JpbGl0eSArPSBtb2JpbGl0eVZhbHVlOw0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIOiuoeeul+WxgOWKv+aAu+WIhg0KICAgIGNvbnN0IHJlZFRvdGFsID0gDQogICAgICAgIHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArDQogICAgICAgIHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArDQogICAgICAgIHJlZFRocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsNCiAgICAgICAgcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKw0KICAgICAgICByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArDQogICAgICAgIHJlZE1vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsgDQogICAgDQogICAgY29uc3QgYmxhY2tUb3RhbCA9IA0KICAgICAgICBibGFja01hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArDQogICAgICAgIGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsNCiAgICAgICAgYmxhY2tUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArDQogICAgICAgIGJsYWNrVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKw0KICAgICAgICBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsNCiAgICAgICAgYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7DQogICAgDQogICAgLy8g6L+U5Zue6K+m57uG6K+E5Lyw57uT5p6cDQogICAgY29uc3QgX19ldmFsUmVzdWx0ID0gew0KICAgICAgICByZWQ6IHsNCiAgICAgICAgICAgIHRvdGFsOiByZWRUb3RhbCwNCiAgICAgICAgICAgIG1hdGVyaWFsOiByZWRNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICBwb3NpdGlvbjogcmVkUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLA0KICAgICAgICAgICAgdGhyZWF0OiByZWRUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCwNCiAgICAgICAgICAgIHRhY3RpYzogcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMsDQogICAgICAgICAgICBzYWZldHk6IHJlZFNhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LA0KICAgICAgICAgICAgbW9iaWxpdHk6IHJlZE1vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eSwNCiAgICAgICAgICAgIHBoYXNlOiBvdXRwdXRQaGFzZSwNCiAgICAgICAgICAgIHdlaWdodHM6IHsNCiAgICAgICAgICAgICAgICBtYXRlcmlhbDogMC40LA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLjIsDQogICAgICAgICAgICAgICAgdGFjdGljOiAwLjEsDQogICAgICAgICAgICAgICAgc2FmZXR5OiAwLjEsDQogICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAuMDUsDQogICAgICAgICAgICAgICAgdGhyZWF0OiAwLjE1DQogICAgICAgICAgICB9DQogICAgICAgIH0sDQogICAgICAgIGJsYWNrOiB7DQogICAgICAgICAgICB0b3RhbDogYmxhY2tUb3RhbCwNCiAgICAgICAgICAgIG1hdGVyaWFsOiBibGFja01hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwNCiAgICAgICAgICAgIHBvc2l0aW9uOiBibGFja1Bvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgIHRocmVhdDogYmxhY2tUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCwNCiAgICAgICAgICAgIHRhY3RpYzogYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYywNCiAgICAgICAgICAgIHNhZmV0eTogYmxhY2tTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgIG1vYmlsaXR5OiBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eSwNCiAgICAgICAgICAgIHBoYXNlOiBvdXRwdXRQaGFzZSwNCiAgICAgICAgICAgIHdlaWdodHM6IHsNCiAgICAgICAgICAgICAgICBtYXRlcmlhbDogMC40LA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLjIsDQogICAgICAgICAgICAgICAgdGFjdGljOiAwLjEsDQogICAgICAgICAgICAgICAgc2FmZXR5OiAwLjEsDQogICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAuMDUsDQogICAgICAgICAgICAgICAgdGhyZWF0OiAwLjE1DQogICAgICAgICAgICB9DQogICAgICAgIH0sDQogICAgICAgIHBpZWNlc0luZm86IHBpZWNlc0luZm8sDQogICAgICAgIGdhbWVTdGFnZTogZ2FtZVN0YWdlLA0KICAgICAgICBib2FyZEluZm86IGJvYXJkSW5mbw0KICAgIH07DQogICAgaWYgKHR5cGVvZiBwZXJmU3RhdHMgIT09ICd1bmRlZmluZWQnICYmIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMgIT0gbnVsbCkgew0KICAgICAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsNCiAgICB9DQogICAgcmV0dXJuIF9fZXZhbFJlc3VsdDsNCn07DQoNCi8vIOWwhi/luIXkvY3nva7nvJPlrZjvvJrkvpsgcG9zdC1tb3ZlIGlzQ2hlY2sgLyDpo57lsIblv6vpgJ/mn6Xor6LvvIznlLEgbWFrZS91bm1ha2Ug57u05oqkDQpsZXQgZ2VuZXJhbFBvc0NhY2hlID0geyByZWQ6IG51bGwsIGJsYWNrOiBudWxsIH07DQoNCi8vIOWwhuW4heS7heWcqOS5neWuq+WGhe+8jOaMieS5neWuq+aJq+aPj+WNs+WPrw0KY29uc3QgZmluZEdlbmVyYWxQb3MgPSAoYm9hcmQsIGNvbG9yKSA9PiB7DQogICAgY29uc3Qgcm93U3RhcnQgPSBjb2xvciA9PT0gJ3JlZCcgPyAwIDogNzsNCiAgICBjb25zdCByb3dFbmQgPSBjb2xvciA9PT0gJ3JlZCcgPyAyIDogOTsNCiAgICBmb3IgKGxldCByID0gcm93U3RhcnQ7IHIgPD0gcm93RW5kOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDM7IGMgPD0gNTsgYysrKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAocCAmJiBwLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBwLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgICAgIHJldHVybiB7IHIsIGMgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICByZXR1cm4gbnVsbDsNCn07DQoNCmNvbnN0IHN5bmNHZW5lcmFsUG9zQ2FjaGUgPSAoYm9hcmQpID0+IHsNCiAgICBnZW5lcmFsUG9zQ2FjaGUucmVkID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsICdyZWQnKTsNCiAgICBnZW5lcmFsUG9zQ2FjaGUuYmxhY2sgPSBmaW5kR2VuZXJhbFBvcyhib2FyZCwgJ2JsYWNrJyk7DQp9Ow0KDQpjb25zdCBnZXRHZW5lcmFsUG9zID0gKGJvYXJkLCBjb2xvcikgPT4gew0KICAgIGNvbnN0IGNhY2hlZCA9IGdlbmVyYWxQb3NDYWNoZVtjb2xvcl07DQogICAgaWYgKGNhY2hlZCkgew0KICAgICAgICBjb25zdCBwID0gYm9hcmRbY2FjaGVkLnJdPy5bY2FjaGVkLmNdOw0KICAgICAgICBpZiAocCAmJiBwLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBwLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgcmV0dXJuIGNhY2hlZDsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBjb25zdCBwb3MgPSBmaW5kR2VuZXJhbFBvcyhib2FyZCwgY29sb3IpOw0KICAgIGdlbmVyYWxQb3NDYWNoZVtjb2xvcl0gPSBwb3M7DQogICAgcmV0dXJuIHBvczsNCn07DQoNCi8vIOaQnOe0oueUqOWOn+WcsOi1sOWtkCAvIOaBouWkje+8iOmBv+WFjeavj+asoemAkuW9kiBib2FyZC5tYXDvvInvvJvlkIzmraXnu7TmiqTlsIbkvY3nvJPlrZgNCmNvbnN0IG1ha2VNb3ZlID0gKGJvYXJkLCBmcm9tLCB0bykgPT4gew0KICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbZnJvbS5yXVtmcm9tLmNdOw0KICAgIGNvbnN0IGNhcHR1cmVkID0gYm9hcmRbdG8ucl1bdG8uY107DQogICAgYm9hcmRbdG8ucl1bdG8uY10gPSBwaWVjZTsNCiAgICBib2FyZFtmcm9tLnJdW2Zyb20uY10gPSBudWxsOw0KICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogdG8uciwgYzogdG8uYyB9Ow0KICAgIH0NCiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSBudWxsOw0KICAgIH0NCiAgICByZXR1cm4gY2FwdHVyZWQ7DQp9Ow0KDQpjb25zdCB1bm1ha2VNb3ZlID0gKGJvYXJkLCBmcm9tLCB0bywgY2FwdHVyZWQpID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOw0KICAgIGJvYXJkW2Zyb20ucl1bZnJvbS5jXSA9IHBpZWNlOw0KICAgIGJvYXJkW3RvLnJdW3RvLmNdID0gY2FwdHVyZWQ7DQogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbcGllY2UuY29sb3JdID0geyByOiBmcm9tLnIsIGM6IGZyb20uYyB9Ow0KICAgIH0NCiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSB7IHI6IHRvLnIsIGM6IHRvLmMgfTsNCiAgICB9DQp9Ow0KDQovLyDotbDlrZDlkI7mmK/lkKbkvb/lt7HmlrnlsIbkuI3lronlhajvvIjpo57lsIbmiJbooqvlsIbvvInjgILosIPnlKjliY3pobvlt7IgbWFrZU1vdmXjgIINCmNvbnN0IGxlYXZlc093bktpbmdVbnNhZmUgPSAoYm9hcmQsIGNvbG9yKSA9PiB7DQogICAgcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzKys7DQogICAgcmV0dXJuIGlzRmx5aW5nR2VuZXJhbChib2FyZCkgfHwgaXNDaGVja1Jhdyhib2FyZCwgY29sb3IpOw0KfTsNCg0KLy8g5LuO5Lyq5ZCI5rOV552A5rOV5Lit6L+H5ruk5Ye65LiN6YCB5bCGL+S4jemjnuWwhueahOWQiOazleedgOazle+8iFVJL+agueiKgueCuS/lvIDlsYDlupPmoKHpqozvvIkNCi8vIOaQnOe0oueDrei3r+W+hOS9v+eUqOW7tui/n+WQiOazleaAp++8iOivlei1sOaXtuajgOa1i++8ie+8jOmBv+WFjeWvueWJquaeneacquinpuWPiueahOedgOazleWBmuWFqOmHj+i/h+a7pA0KY29uc3QgZmlsdGVyTGVnYWxNb3ZlcyA9IChib2FyZCwgZnJvbSwgcGllY2UsIHBzZXVkb01vdmVzKSA9PiB7DQogICAgY29uc3QgdmFsaWRNb3ZlcyA9IFtdOw0KICAgIGZvciAoY29uc3QgdG8gb2YgcHNldWRvTW92ZXMpIHsNCiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlTW92ZShib2FyZCwgZnJvbSwgdG8pOw0KICAgICAgICBjb25zdCBpbGxlZ2FsID0gbGVhdmVzT3duS2luZ1Vuc2FmZShib2FyZCwgcGllY2UuY29sb3IpOw0KICAgICAgICB1bm1ha2VNb3ZlKGJvYXJkLCBmcm9tLCB0bywgY2FwdHVyZWQpOw0KICAgICAgICBpZiAoIWlsbGVnYWwpIHZhbGlkTW92ZXMucHVzaCh0byk7DQogICAgfQ0KICAgIHJldHVybiB2YWxpZE1vdmVzOw0KfTsNCg0KLy8g5pCc57Si55So552A5rOV5YeG5aSH77yI6L276YeP77yJ77ya5LiN5bu65YWz57O75Zu+L+WogeiDgS/mnLrliqjmgKcNCi8vIFNFQVJDSF9ERUZFUl9MRUdBTElUWT10cnVl77ya5Y+q55Sf5oiQ5Lyq5ZCI5rOV77yM5ZCI5rOV5oCn5Zyo6K+V6LWw5pe25qOA5rWLDQovLyBTRUFSQ0hfREVGRVJfTEVHQUxJVFk9ZmFsc2XvvJrpooTov4fmu6TlkIjms5XnnYDvvIjml6fot6/lvoTvvIzkvr/kuo4gQS9C77yJDQovLyDngrnmo4vlhbPns7vku43otbDlrozmlbQgZXZhbHVhdGVCb2FyZO+8jOS4jeWPl+W9seWTjQ0KY29uc3QgcHJlcGFyZVNlYXJjaEluZm8gPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIGdhbWVTdGFnZSwgc2VhcmNoSW5pdGlhdG9yID0gbnVsbCwgZGVwdGggPSAwKSA9PiB7DQogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQoNCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVja1Jhdyhib2FyZCwgY3VycmVudFBsYXllcik7DQogICAgY29uc3QgcGllY2VzSW5mbyA9IFtdOw0KICAgIGNvbnN0IGxlZ2FsTW92ZUxpc3QgPSBbXTsNCiAgICBjb25zdCBkZWZlciA9IFNFQVJDSF9ERUZFUl9MRUdBTElUWTsNCg0KICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKCFwaWVjZSB8fCBwaWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7DQoNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlKTsNCiAgICAgICAgICAgIGNvbnN0IHVzZU1vdmVzID0gZGVmZXIgPyBtb3ZlcyA6IGZpbHRlckxlZ2FsTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSwgbW92ZXMpOw0KICAgICAgICAgICAgcGllY2VzSW5mby5wdXNoKHsNCiAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICByLA0KICAgICAgICAgICAgICAgIGMsDQogICAgICAgICAgICAgICAgbW92ZXMsDQogICAgICAgICAgICAgICAgbGVnYWxNb3ZlczogdXNlTW92ZXMNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB1c2VNb3Zlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHRvID0gdXNlTW92ZXNbaV07DQogICAgICAgICAgICAgICAgbGVnYWxNb3ZlTGlzdC5wdXNoKHsgZnJvbTogeyByLCBjIH0sIHRvLCBzY29yZTogMCB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCArPSBtb3Zlcy5sZW5ndGg7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDovbvph48gYm9hcmRJbmZv77ya5LuF6KKr5bCG5qCH5b+XDQogICAgY29uc3QgYm9hcmRJbmZvID0gew0KICAgICAgICByZWRJc0luQ2hlY2s6IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gaW5DaGVjayA6IGZhbHNlLA0KICAgICAgICBibGFja0lzSW5DaGVjazogY3VycmVudFBsYXllciA9PT0gJ2JsYWNrJyA/IGluQ2hlY2sgOiBmYWxzZSwNCiAgICAgICAgZ2FtZVN0YXRlOiBudWxsDQogICAgfTsNCg0KICAgIGlmIChsZWdhbE1vdmVMaXN0Lmxlbmd0aCA9PT0gMCkgew0KICAgICAgICBjb25zdCBvcHBvbmVudCA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0gaW5DaGVjaw0KICAgICAgICAgICAgPyB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfQ0KICAgICAgICAgICAgOiB7IHN0YXR1czogJ3N0YWxlbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICB9IGVsc2Ugew0KICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdwbGF5aW5nJyB9Ow0KICAgIH0NCg0KICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsNCiAgICByZXR1cm4geyBwaWVjZXNJbmZvLCBib2FyZEluZm8sIGxlZ2FsTW92ZUxpc3QsIGluQ2hlY2ssIGRlZmVycmVkTGVnYWxpdHk6IGRlZmVyIH07DQp9Ow0KDQovLyDorqHnrpfooY3nlJ/lgLzvvJrlqIHog4HlgLzjgIHlronlhajlgLzjgIHmiJjmnK/lgLzjgIHmnLrliqjlgLwNCmNvbnN0IGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMgPSAoYm9hcmQsIHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIgPSBudWxsLCBkZXB0aCA9IDAsIHNlYXJjaEluaXRpYXRvciA9IG51bGwsIGdhbWVTdGFnZSA9ICdtaWQnLCBib2FyZEluZm8gPSBudWxsLCBmb3JTZWFyY2hMZWFmID0gZmFsc2UpID0+IHsNCiAgICAvLyDph43nva7miYDmnInooY3nlJ/lgLzvvIzpmaTkuobmnLrliqjlgLzvvIjlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpfvvIkNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpbmZvLnRocmVhdFZhbHVlID0gMDsNCiAgICAgICAgaW5mby5zYWZldHlWYWx1ZSA9IDA7DQogICAgICAgIGluZm8udGFjdGljVmFsdWUgPSAwOw0KICAgICAgICAvLyDkv53nlZnmnLrliqjlgLzvvIzlm6DkuLrlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpcNCiAgICB9DQogICAgDQogICAgLy8gMS4g6K6h566X5qOL5a2Q5YWz57O777yI5aiB6IOB6ICF44CB6KKr5aiB6IOB6ICF44CB5L+d5oqk6ICF44CB6KKr5L+d5oqk6ICF77yJDQogICAgaWYgKCFib2FyZEluZm8pIHsNCiAgICAgICAgYm9hcmRJbmZvID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7DQogICAgfQ0KICAgIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zKGJvYXJkLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgIA0KICAgIC8vIDIuIOiuoeeul+WogeiDgeWAvO+8iOaMieiiq+WogeiDgeWtkOiBmuWQiO+8jFNFRSDmr4/nm67moIfkuIDmrKHvvIkNCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMocGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvKTsNCiAgICANCiAgICAvLyAzLiDorqHnrpfmiJjmnK/lgLznmoTlhbbku5bpg6jliIbvvIjluK7liqnlhbPns7vlkozpmLvmjKHlhbPns7vvvIkNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICAvL2luZm8udGFjdGljVmFsdWUgKz0gY2FsY3VsYXRlQXNzaXN0VmFsdWUocGllY2VzSW5mbywgaW5mbyk7DQogICAgICAgIC8vaW5mby50YWN0aWNWYWx1ZSArPSBjYWxjdWxhdGVCbG9ja1ZhbHVlKGJvYXJkLCBwaWVjZXNJbmZvLCBpbmZvKTsNCiAgICB9DQogICAgDQogICAgLy8gNC4g5pyA5ZCO6K6h566X5a6J5YWo5YC877yM5Lyg6YCSYm9hcmRJbmZv5L2c5Li65Y+C5pWwDQogICAgY2FsY3VsYXRlU2FmZXR5VmFsdWVzKHBpZWNlc0luZm8sIGJvYXJkSW5mbyk7DQogICAgDQogICAgLy8gNS4g6K6h566X5ri45oiP54q25oCB5bm25L+d5a2Y5YiwYm9hcmRJbmZvDQogICAgLy8g5pCc57Si5Y+26IqC54K56Lez6L+H77ya5peg552AL+Wwhuatu+W3suWcqOeItuiKgueCueWkhOeQhu+8jOatpOWkhOWPqumcgOmdmeaAgeWIhg0KICAgIGlmIChjdXJyZW50UGxheWVyICYmICFmb3JTZWFyY2hMZWFmKSB7DQogICAgICAgIC8vIOajgOafpeW9k+WJjeeOqeWutuaYr+WQpuacieWQiOazlei1sOazlQ0KICAgICAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsNCiAgICAgICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5qOL5a2Q55qE5pyJ5pWI6LWw5rOVDQogICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHI6IGluZm8uciwgYzogaW5mby5jIH0pOw0KICAgICAgICAgICAgICAgIGlmIChtb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDliKTmlq3muLjmiI/nirbmgIENCiAgICAgICAgbGV0IGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAncGxheWluZycgfTsNCiAgICAgICAgaWYgKCFoYXNNb3Zlcykgew0KICAgICAgICAgICAgLy8g5rKh5pyJ5ZCI5rOV6LWw5rOV77yM5qOA5p+l5piv5ZCm6KKr5bCG5YabDQogICAgICAgICAgICBjb25zdCBpbkNoZWNrID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkSXNJbkNoZWNrIDogYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrOw0KICAgICAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKGluQ2hlY2spIHsNCiAgICAgICAgICAgICAgICBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIOS/neWtmOa4uOaIj+eKtuaAgeWIsGJvYXJkSW5mbw0KICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0gZ2FtZVN0YXRlOw0KICAgIH0NCn07DQoNCi8vIOmdnueCru+8muS4gOasoeWHoOS9leaJq+aPj+WQjOaXtuWhq+WFhSBtb3ZlcyArIGNvbnRyb2wgLyB0aHJlYXQgLyBndWFyZCAvIG1vYmlsaXR577yI5a+56b2QIGZpbGxDYW5ub25SZWxhdGlvbnPvvIkNCi8vIOivreS5ieS4jiBnZXRQaWVjZU1vdmVzICsgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMg5pen5ouG5YiG6Lev5b6E5LiA6Ie077ybZ2V0UGllY2VNb3ZlcyDku43kvpvnnYDms5XnlJ/miJDkvb/nlKgNCmNvbnN0IGZpbGxOb25DYW5ub25SZWxhdGlvbnMgPSAoYm9hcmQsIGluZm8sIHBvc0J5S2V5KSA9PiB7DQogICAgY29uc3QgcGllY2UgPSBpbmZvLnBpZWNlOw0KICAgIGNvbnN0IHsgciwgYyB9ID0gaW5mbzsNCiAgICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCiAgICBjb25zdCB7IGJhc2VNb3ZlVmFsdWUgfSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eTsNCiAgICBpbmZvLm1vdmVzID0gW107DQogICAgaW5mby5jb250cm9sID0gW107DQogICAgaW5mby5hbGx5R3VhcmRzID0gW107DQogICAgbGV0IG1vYmlsaXR5VmFsdWUgPSAwOw0KDQogICAgY29uc3QgbGlua1RocmVhdCA9ICh0ciwgdGMpID0+IHsNCiAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBvc0J5S2V5LmdldCh0ciAqIDkgKyB0Yyk7DQogICAgICAgIGlmICh0YXJnZXRJbmZvKSB7DQogICAgICAgICAgICBpbmZvLnRocmVhdC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgdGFyZ2V0SW5mby50aHJlYXRlbmVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgfQ0KICAgIH07DQoNCiAgICBjb25zdCBsaW5rR3VhcmQgPSAodHIsIHRjKSA9PiB7DQogICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwb3NCeUtleS5nZXQodHIgKiA5ICsgdGMpOw0KICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICBpbmZvLmd1YXJkLnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICB0YXJnZXRJbmZvLmd1YXJkZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgaW5mby5hbGx5R3VhcmRzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgICAgIH0NCiAgICB9Ow0KDQogICAgY29uc3QgYWRkU3F1YXJlID0gKHRyLCB0YykgPT4gew0KICAgICAgICBpZiAoIWlzVmFsaWRQb3ModHIsIHRjKSkgcmV0dXJuOw0KICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFt0cl1bdGNdOw0KICAgICAgICBpZiAoIXRhcmdldCkgew0KICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICAgICAgaW5mby5jb250cm9sLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7DQogICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0LmNvbG9yICE9PSBwaWVjZS5jb2xvcikgew0KICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICAgICAgbGlua1RocmVhdCh0ciwgdGMpOw0KICAgICAgICB9IGVsc2UgaWYgKHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgIGxpbmtHdWFyZCh0ciwgdGMpOw0KICAgICAgICB9DQogICAgfTsNCg0KICAgIHN3aXRjaCAocGllY2UudHlwZSkgew0KICAgICAgICBjYXNlICdnZW5lcmFsJzoNCiAgICAgICAgICAgIGZvciAoY29uc3QgW2RyLCBkY10gb2YgW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICBpZiAobmMgPj0gMyAmJiBuYyA8PSA1KSB7DQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA+PSAwICYmIG5yIDw9IDIpIGFkZFNxdWFyZShuciwgbmMpOw0KICAgICAgICAgICAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSBhZGRTcXVhcmUobnIsIG5jKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgY2FzZSAnYWR2aXNvcic6DQogICAgICAgICAgICBmb3IgKGNvbnN0IFtkciwgZGNdIG9mIFtbMSwgMV0sIFsxLCAtMV0sIFstMSwgMV0sIFstMSwgLTFdXSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICBpZiAobmMgPj0gMyAmJiBuYyA8PSA1KSB7DQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA+PSAwICYmIG5yIDw9IDIpIGFkZFNxdWFyZShuciwgbmMpOw0KICAgICAgICAgICAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSBhZGRTcXVhcmUobnIsIG5jKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgY2FzZSAnZWxlcGhhbnQnOg0KICAgICAgICAgICAgZm9yIChjb25zdCBbZHIsIGRjXSBvZiBbWzIsIDJdLCBbMiwgLTJdLCBbLTIsIDJdLCBbLTIsIC0yXV0pIHsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgICAgICAgICAgY29uc3QgZXllUiA9IHIgKyBkciAvIDIsIGV5ZUMgPSBjICsgZGMgLyAyOw0KICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYgYm9hcmRbZXllUl1bZXllQ10gPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkICYmIG5yIDw9IDQpIGFkZFNxdWFyZShuciwgbmMpOw0KICAgICAgICAgICAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNSkgYWRkU3F1YXJlKG5yLCBuYyk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIGNhc2UgJ2hvcnNlJzoNCiAgICAgICAgICAgIGZvciAoY29uc3QgW2RyLCBkY10gb2YgW1syLCAxXSwgWzIsIC0xXSwgWy0yLCAxXSwgWy0yLCAtMV0sIFsxLCAyXSwgWzEsIC0yXSwgWy0xLCAyXSwgWy0xLCAtMl1dKSB7DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIGNvbnN0IGxlZ1IgPSByICsgKE1hdGguYWJzKGRyKSA9PT0gMiA/IE1hdGguc2lnbihkcikgOiAwKTsNCiAgICAgICAgICAgICAgICBjb25zdCBsZWdDID0gYyArIChNYXRoLmFicyhkYykgPT09IDIgPyBNYXRoLnNpZ24oZGMpIDogMCk7DQogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobGVnUiwgbGVnQykgJiYgYm9hcmRbbGVnUl1bbGVnQ10gPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICAgICAgYWRkU3F1YXJlKG5yLCBuYyk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIGNhc2UgJ2NoYXJpb3QnOg0KICAgICAgICAgICAgZm9yIChjb25zdCBbZHIsIGRjXSBvZiBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dKSB7DQogICAgICAgICAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXQgPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldC5jb2xvciAhPT0gcGllY2UuY29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbGlua1RocmVhdChuciwgbmMpOw0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbGlua0d1YXJkKG5yLCBuYyk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBuciArPSBkcjsNCiAgICAgICAgICAgICAgICAgICAgbmMgKz0gZGM7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIGNhc2UgJ3NvbGRpZXInOiB7DQogICAgICAgICAgICBjb25zdCBmb3J3YXJkID0gaXNSZWQgPyAxIDogLTE7DQogICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBpc1JlZCA/IHIgPj0gNSA6IHIgPD0gNDsNCiAgICAgICAgICAgIGFkZFNxdWFyZShyICsgZm9yd2FyZCwgYyk7DQogICAgICAgICAgICBpZiAoY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgICAgICAgICAgYWRkU3F1YXJlKHIsIGMgLSAxKTsNCiAgICAgICAgICAgICAgICBhZGRTcXVhcmUociwgYyArIDEpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgZGVmYXVsdDoNCiAgICAgICAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOw0KfTsNCg0KLy8g54Ku77ya5LiA5qyh5Zub5ZCR5bCE57q/5ZCM5pe25aGr5YWFIG1vdmVzICsgdGhyZWF0IC8gZ3VhcmQgLyBjb250cm9s77yI6YG/5YWNIGdldFBpZWNlTW92ZXMg5YaN5omr5LiA6YGN77yJDQpjb25zdCBmaWxsQ2Fubm9uUmVsYXRpb25zID0gKGJvYXJkLCBpbmZvLCBwb3NCeUtleSkgPT4gew0KICAgIGNvbnN0IHBpZWNlID0gaW5mby5waWVjZTsNCiAgICBjb25zdCB7IHIsIGMgfSA9IGluZm87DQogICAgY29uc3QgeyBiYXNlTW92ZVZhbHVlIH0gPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHk7DQogICAgaW5mby5tb3ZlcyA9IFtdOw0KICAgIGluZm8uY29udHJvbCA9IFtdOw0KICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsNCg0KICAgIGZvciAoY29uc3QgW2RyLCBkY10gb2YgW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXSkgew0KICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBsZXQgc2NyZWVuRm91bmRDb3VudCA9IDA7DQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYgc2NyZWVuRm91bmRDb3VudCA8IDIpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgIT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICBzY3JlZW5Gb3VuZENvdW50Kys7DQogICAgICAgICAgICAgICAgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDIpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBvc0J5S2V5LmdldChuciAqIDkgKyBuYyk7DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRJbmZvICYmIHRhcmdldEluZm8gIT09IGluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yICE9PSBwaWVjZS5jb2xvcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8udGhyZWF0LnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby50aHJlYXRlbmVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHAudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5ndWFyZC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8uZ3VhcmRlZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocC5jb2xvciAhPT0gcGllY2UuY29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOebruagh+S4jeWcqCBwaWVjZXNJbmZvIOaXtuS7jeS/neeVmeWPr+i1sOagvA0KICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMCkgew0KICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDEpIHsNCiAgICAgICAgICAgICAgICBpbmZvLmNvbnRyb2wucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIG5yICs9IGRyOw0KICAgICAgICAgICAgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICB9DQogICAgaW5mby5tb2JpbGl0eVZhbHVlID0gbW9iaWxpdHlWYWx1ZTsNCn07DQoNCi8vIOiuoeeul+aji+WtkOWFs+ezu++8iOWogeiDgeiAheOAgeiiq+WogeiDgeiAheOAgeS/neaKpOiAheOAgeiiq+S/neaKpOiAhe+8iQ0KLy8g5ZCM5pe26K6h566XYm9hcmRJbmZv77ya5Li65qOL55uY5q+P5Liq5L2N572u55m76K6w5o6n5Yi26ICFDQovLyDlpI3nlKggaW5mby5tb3ZlcyArIGFsbHlHdWFyZHPvvJvngq7nlKjkuIDmrKHlsITnur8NCmNvbnN0IGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pID0+IHsNCiAgICAvLyDliJ3lp4vljJbmo4vlrZDlhbPns7vmlbDnu4QNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpbmZvLnRocmVhdCA9IFtdOyAgICAgICAgICAgLy8g5qOA5p+l6L+Z5Liq5qOL5a2Q5Y+v5Lul5aiB6IOB5ZOq5Lqb5qOL5a2QDQogICAgICAgIGluZm8udGhyZWF0ZW5lZEJ5ID0gW107ICAgICAvLyDmo4Dmn6Xov5nkuKrmo4vlrZDooqvlk6rkupvmo4vlrZDlqIHog4ENCiAgICAgICAgaW5mby5ndWFyZCA9IFtdOyAgICAgICAvLyDmo4Dmn6Xov5nkuKrmo4vlrZDlj6/ku6Xkv53miqTlk6rkupvmo4vlrZANCiAgICAgICAgaW5mby5ndWFyZGVkQnkgPSBbXTsgICAgICAvLyDmo4Dmn6Xov5nkuKrmo4vlrZDooqvlk6rkupvmo4vlrZDkv53miqQNCiAgICAgICAgaW5mby5jb250cm9sID0gW107ICAgICAgLy8g5qOA5p+l6L+Z5Liq5qOL5a2Q5Y+v5Lul5o6n5Yi255qE5ZOq5Lqb5L2N572uDQogICAgfQ0KICAgIA0KICAgIGNvbnN0IHVzZUF0dGFja0JpdHMgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMpOw0KICAgIC8vIOWmguaenGJvYXJkSW5mb+S4uuepuu+8jOWImeWIneWni+WMluaOp+WItuiAheWIl+ihqO+8iOeCueajiy9VSSDot6/lvoTvvIkNCiAgICBpZiAoIWJvYXJkSW5mbykgew0KICAgICAgICBib2FyZEluZm8gPSBtYWtlRW1wdHlDb250cm9sbGVyR3JpZCgpOw0KICAgIH0NCg0KICAgIGNvbnN0IHBvc0J5S2V5ID0gbmV3IE1hcCgpOw0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIHBvc0J5S2V5LnNldChpbmZvLnIgKiA5ICsgaW5mby5jLCBpbmZvKTsNCiAgICB9DQogICAgDQogICAgLy8g5aSE55CG5q+P5Liq5qOL5a2Q77ya5LiA5qyh5Yeg5L2V5ZCM5pe25aGrIG1vdmVzICsg5YWz57O777yI54KuL+mdnueCrue7n+S4gOaooeW8j++8iQ0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChpbmZvLnBpZWNlLnR5cGUgPT09ICdjYW5ub24nKSB7DQogICAgICAgICAgICBmaWxsQ2Fubm9uUmVsYXRpb25zKGJvYXJkLCBpbmZvLCBwb3NCeUtleSk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBmaWxsTm9uQ2Fubm9uUmVsYXRpb25zKGJvYXJkLCBpbmZvLCBwb3NCeUtleSk7DQogICAgICAgIH0NCg0KICAgICAgICBjb25zdCBjb250cm9sID0gaW5mby5jb250cm9sOw0KICAgICAgICANCiAgICAgICAgaWYgKHVzZUF0dGFja0JpdHMpIHsNCiAgICAgICAgICAgIC8vIOaQnOe0ouWPtu+8muWPquiusOOAjOivpeiJsuaYr+WQpuaUu+WHu+ivpeagvOOAje+8jOS4jeW7uuaOp+WItuiAheaVsOe7hA0KICAgICAgICAgICAgY29uc3QgYml0cyA9IGluZm8ucGllY2UuY29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZEF0dGFjayA6IGJvYXJkSW5mby5ibGFja0F0dGFjazsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29udHJvbC5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBvcyA9IGNvbnRyb2xbaV07DQogICAgICAgICAgICAgICAgc2V0QXR0YWNrQml0KGJpdHMsIHBvcy5yICogOSArIHBvcy5jKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIC8vIOeCueajiy9VSe+8muaOp+WItuiAheWIl+ihqOebtOaOpeW8leeUqCBwaWVjZXNJbmZvIOadoeebrg0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb250cm9sLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcG9zID0gY29udHJvbFtpXTsNCiAgICAgICAgICAgICAgICBib2FyZEluZm9bcG9zLnJdW3Bvcy5jXS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIOmihOiuoeeul+WwhuWGm+eKtuaAgQ0KICAgIGxldCByZWRJc0luQ2hlY2sgPSBmYWxzZTsNCiAgICBsZXQgYmxhY2tJc0luQ2hlY2sgPSBmYWxzZTsNCiAgICANCiAgICBsZXQgcmVkR2VuZXJhbEluZm8gPSBudWxsOw0KICAgIGxldCBibGFja0dlbmVyYWxJbmZvID0gbnVsbDsNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoaW5mby5waWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgIHJlZEdlbmVyYWxJbmZvID0gaW5mbzsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgYmxhY2tHZW5lcmFsSW5mbyA9IGluZm87DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgaWYgKHJlZEdlbmVyYWxJbmZvKSB7DQogICAgICAgIGZvciAoY29uc3QgdGhyZWF0ZW5lciBvZiByZWRHZW5lcmFsSW5mby50aHJlYXRlbmVkQnkpIHsNCiAgICAgICAgICAgIGlmICh0aHJlYXRlbmVyLnBpZWNlLmNvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICBpZiAoYmxhY2tHZW5lcmFsSW5mbykgew0KICAgICAgICBmb3IgKGNvbnN0IHRocmVhdGVuZXIgb2YgYmxhY2tHZW5lcmFsSW5mby50aHJlYXRlbmVkQnkpIHsNCiAgICAgICAgICAgIGlmICh0aHJlYXRlbmVyLnBpZWNlLmNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgIGJsYWNrSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICBpZiAocmVkR2VuZXJhbEluZm8gJiYgYmxhY2tHZW5lcmFsSW5mbyAmJiByZWRHZW5lcmFsSW5mby5jID09PSBibGFja0dlbmVyYWxJbmZvLmMpIHsNCiAgICAgICAgbGV0IGhhc1BpZWNlQmV0d2VlbiA9IGZhbHNlOw0KICAgICAgICBjb25zdCBzdGFydFIgPSBNYXRoLm1pbihyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpICsgMTsNCiAgICAgICAgY29uc3QgZW5kUiA9IE1hdGgubWF4KHJlZEdlbmVyYWxJbmZvLnIsIGJsYWNrR2VuZXJhbEluZm8ucikgLSAxOw0KICAgICAgICBmb3IgKGxldCByID0gc3RhcnRSOyByIDw9IGVuZFI7IHIrKykgew0KICAgICAgICAgICAgaWYgKGJvYXJkW3JdW3JlZEdlbmVyYWxJbmZvLmNdKSB7DQogICAgICAgICAgICAgICAgaGFzUGllY2VCZXR3ZWVuID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoIWhhc1BpZWNlQmV0d2Vlbikgew0KICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgIGJsYWNrSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICBib2FyZEluZm8ucmVkSXNJbkNoZWNrID0gcmVkSXNJbkNoZWNrOw0KICAgIGJvYXJkSW5mby5ibGFja0lzSW5DaGVjayA9IGJsYWNrSXNJbkNoZWNrOw0KfTsNCg0KLy8g552A5rOV5o6S5bqP5Ye95pWw77ya5qC55o2u5LyY5YWI57qn5o6S5bqP552A5rOVDQovLyDooqvlsIbml7bvvJrlkIPlsIblrZAgPiDlj43lsIYgPiDlhbblroPlkIPlrZAgPiDotbDlsIbpgIPpgLggPiDlnqvlsIYv5YW25L2ZDQovLyDmnKrooqvlsIbml7bvvJoNCi8vIDEuIOS8mOWFiOWkhOeQhuaIkeaWueaXoOS/neaKpOeahOiiq+WNleWQkeWogeiDgeeahOaji+WtkOaJp+ihjOmAg+i3keedgOazle+8jOWmguacieWkmuS4quaji+WtkOaMieadkOaWmeWAvOS7jumrmOWIsOS9juaOkuW6jw0KLy8gMi4g5YW25qyh5aSE55CG5oiR5pa55Y2V5ZCR5aiB6IOB5a+55pa55peg5L+d5oqk5qOL5a2Q55qE5qOL5a2Q5omn6KGM5ZCD5a2Q552A5rOV77yM5aaC5pyJ5aSa5Liq5qOL5a2Q5oyJ5qOL5a2Q5p2Q5paZ5YC85LuO6auY5Yiw5L2O5o6S5bqPDQovLyAzLiDmnIDlkI7lpITnkIbkuI3mtonlj4rlkIPlkozooqvlkIPnmoTnnYDms5XvvIzopoHmsYLpgb/lhY3np7vliqjliLDooqvlkIPnmoTkvY3nva4NCmNvbnN0IHNvcnRNb3ZlcyA9IChtb3ZlcywgYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIHBpZWNlc0luZm8sIGdhbWVTdGFnZSA9ICdtaWQnLCBib2FyZEluZm8gPSBudWxsLCBzZWFyY2hIZXVyaXN0aWNzID0gbnVsbCkgPT4gew0KICAgIC8vIOS9v+eUqOS8oOWFpeeahGdhbWVTdGFnZeWPguaVsO+8jOmBv+WFjemHjeWkjeiwg+eUqGdldEdhbWVQaGFzZQ0KICAgIA0KICAgIC8vIOeUqOmihOiuoeeul+eahOiiq+WwhueKtuaAge+8iOS4jeiDveeUqCBib2FyZEluZm8uY2hlY2tz77ya6YKj5piv4oCc6LCB5Zyo5bCG5Yab4oCd77yM5LiN5piv4oCc6LCB6KKr5bCG4oCd77yJDQogICAgY29uc3QgY3VycmVudElzSW5DaGVjayA9IGJvYXJkSW5mbw0KICAgICAgICA/ICgoY3VycmVudFBsYXllciA9PT0gJ3JlZCcgJiYgYm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwNCiAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgJiYgYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKSkNCiAgICAgICAgOiBpc0NoZWNrKGJvYXJkLCBjdXJyZW50UGxheWVyKTsNCg0KICAgIC8vIOiiq+WwhuaXtuaUtumbhuato+WcqOWwhuWGm+eahOaVjOaWueaji+WtkOS9jee9ru+8jOeUqOS6juS8mOWFiOWQg+WwhuWtkA0KICAgIGxldCBjaGVja2VyS2V5cyA9IG51bGw7DQogICAgaWYgKGN1cnJlbnRJc0luQ2hlY2sgJiYgcGllY2VzSW5mbyAmJiBwaWVjZXNJbmZvLmxlbmd0aCA+IDApIHsNCiAgICAgICAgY29uc3QgZ2VuZXJhbEluZm8gPSBwaWVjZXNJbmZvLmZpbmQoDQogICAgICAgICAgICBwID0+IHAucGllY2UgJiYgcC5waWVjZS50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcg0KICAgICAgICApOw0KICAgICAgICBpZiAoZ2VuZXJhbEluZm8gJiYgZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7DQogICAgICAgICAgICBjaGVja2VyS2V5cyA9IG5ldyBTZXQoDQogICAgICAgICAgICAgICAgZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5DQogICAgICAgICAgICAgICAgICAgIC5maWx0ZXIodCA9PiB0LnBpZWNlICYmIHQucGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpDQogICAgICAgICAgICAgICAgICAgIC5tYXAodCA9PiBgJHt0LnJ9LCR7dC5jfWApDQogICAgICAgICAgICApOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3QgdHRNb3ZlID0gc2VhcmNoSGV1cmlzdGljcz8udHRNb3ZlIHx8IG51bGw7DQogICAgY29uc3Qga2lsbGVycyA9IHNlYXJjaEhldXJpc3RpY3M/LmtpbGxlcnMgfHwgbnVsbDsNCiAgICANCiAgICAvLyDkuLrmr4/kuKrnnYDms5XorqHnrpfkvJjlhYjnuqfliIbmlbDlubbkv53lrZjljp/lp4vntKLlvJUNCiAgICAvLyDmjpLluo/lsYLnuqfvvJpUVC1tb3ZlID4g5bqU5bCGL+WQg+WtkOetiemdmeaAgeS8mOWFiOe6pyA+IGtpbGxlciA+IGhpc3RvcnkNCiAgICBtb3Zlcy5mb3JFYWNoKChtb3ZlLCBpbmRleCkgPT4gew0KICAgICAgICBjb25zdCB7IGZyb20sIHRvIH0gPSBtb3ZlOw0KICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsNCiAgICAgICAgY29uc3QgcGllY2VWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7DQoNCiAgICAgICAgY29uc3QgdGFyZ2V0UGllY2UgPSBib2FyZFt0by5yXVt0by5jXTsNCiAgICAgICAgY29uc3QgdGFyZ2V0UGllY2VWYWx1ZSA9IHRhcmdldFBpZWNlID8gZ2V0TWF0ZXJpYWxWYWx1ZSh0YXJnZXRQaWVjZSwgZ2FtZVN0YWdlKSA6IDA7DQogICAgICAgIA0KICAgICAgICBsZXQgcHJpb3JpdHkgPSA0Ow0KICAgICAgICBsZXQgc2NvcmUgPSAwOw0KDQogICAgICAgIGlmICh0dE1vdmUgJiYgaXNTYW1lTW92ZShtb3ZlLCB0dE1vdmUpKSB7DQogICAgICAgICAgICBwcmlvcml0eSA9IC0xOw0KICAgICAgICAgICAgc2NvcmUgPSAxMDAwMDAwOw0KICAgICAgICB9IGVsc2UgaWYgKGN1cnJlbnRJc0luQ2hlY2spIHsNCiAgICAgICAgICAgIC8vIOiiq+Wwhu+8muWQiOazleedgOazleWdh+W3suino+mZpOWwhuWGm++8m+S8mOWFiOWQg+WwhuWtkO+8jOWFtuasoeWQg+WtkC/liqjlsIbvvIjkuI3mjqLmtYvlj43lsIbvvIkNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVzQ2hlY2tlciA9IHRhcmdldFBpZWNlICYmIGNoZWNrZXJLZXlzICYmIGNoZWNrZXJLZXlzLmhhcyhgJHt0by5yfSwke3RvLmN9YCk7DQogICAgICAgICAgICBpZiAoY2FwdHVyZXNDaGVja2VyKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAwOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gMTAwMDAgKyB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgIC8vIE1WVi1MVkHvvJrotLXlrZDkvJjlhYjlkIPjgIHkvr/lrpzlrZDkvJjlhYjljrvlkIMNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDI7DQogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlICogMTYgLSBwaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICAgICAgc2NvcmUgPSBwaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDQ7DQogICAgICAgICAgICAgICAgc2NvcmUgPSAwOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICBjb25zdCBpc1RocmVhdGVuZWRQaWVjZSA9IGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLnNvbWUocCA9PiBwLnIgPT09IGZyb20uciAmJiBwLmMgPT09IGZyb20uYyk7DQogICAgICAgICAgICBpZiAoaXNUaHJlYXRlbmVkUGllY2UpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDE7DQogICAgICAgICAgICAgICAgc2NvcmUgPSBwaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IGlzQ2FuQ2FwdHVyZSA9IGJvYXJkSW5mby5jYW5DYXB0dXJlICYmIGJvYXJkSW5mby5jYW5DYXB0dXJlLnNvbWUocCA9PiBwLnIgPT09IHRvLnIgJiYgcC5jID09PSB0by5jKTsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IGlzQ2FuQ2FwdHVyZSA/IDIgOiAzOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSA0Ow0KICAgICAgICAgICAgICAgIHNjb3JlID0gMDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUgJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgY29uc3QgaXNDYW5DYXB0dXJlID0gYm9hcmRJbmZvLmNhbkNhcHR1cmUuc29tZShwID0+IHAuciA9PT0gdG8uciAmJiBwLmMgPT09IHRvLmMpOw0KICAgICAgICAgICAgaWYgKGlzQ2FuQ2FwdHVyZSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMjsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSA0Ow0KICAgICAgICAgICAgICAgIHNjb3JlID0gMDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgLy8g5peg5aiB6IOB6KGo5pe277yI5pCc57Si6L276YeP6Lev5b6E77yJ77yaTVZWLUxWQSDlkIPlrZDmjpLluo8NCiAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZSAqIDE2IC0gcGllY2VWYWx1ZTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIHByaW9yaXR5ID0gNDsNCiAgICAgICAgICAgIHNjb3JlID0gMDsNCiAgICAgICAgfQ0KDQogICAgICAgIC8vIGtpbGxlciAvIGhpc3RvcnnvvJrkuI3opobnm5YgVFQg5LiO6auY5LyY5YWI57qn5ZCD5a2QL+W6lOWwhg0KICAgICAgICBpZiAocHJpb3JpdHkgPj0gMCkgew0KICAgICAgICAgICAgaWYgKCF0YXJnZXRQaWVjZSAmJiBraWxsZXJzICYmIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc1swXSkpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IE1hdGgubWluKHByaW9yaXR5LCAyKTsNCiAgICAgICAgICAgICAgICBzY29yZSArPSA4MDAwOw0KICAgICAgICAgICAgfSBlbHNlIGlmICghdGFyZ2V0UGllY2UgJiYga2lsbGVycyAmJiBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNbMV0pKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7DQogICAgICAgICAgICAgICAgc2NvcmUgKz0gNzAwMDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHNjb3JlICs9IGdldEhpc3RvcnlTY29yZShtb3ZlKTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgbW92ZS5wcmlvcml0eSA9IHByaW9yaXR5Ow0KICAgICAgICBtb3ZlLnNvcnRTY29yZSA9IHNjb3JlOw0KICAgICAgICBtb3ZlLm9yaWdpbmFsSW5kZXggPSBpbmRleDsNCiAgICB9KTsNCiAgICANCiAgICAvLyDmoLnmja7kvJjlhYjnuqfjgIHliIbmlbDlkozljp/lp4vntKLlvJXmjpLluo/nnYDms5UNCiAgICBtb3Zlcy5zb3J0KChhLCBiKSA9PiB7DQogICAgICAgIC8vIOmmluWFiOaMieS8mOWFiOe6p+aOkuW6j++8jOS8mOWFiOe6pzAgPiAxID4gMiA+IDMgPiA0DQogICAgICAgIGlmIChhLnByaW9yaXR5ICE9PSBiLnByaW9yaXR5KSB7DQogICAgICAgICAgICByZXR1cm4gYS5wcmlvcml0eSAtIGIucHJpb3JpdHk7DQogICAgICAgIH0NCiAgICAgICAgLy8g5LyY5YWI57qn55u45ZCM5pe277yM5oyJ5YiG5pWw5LuO6auY5Yiw5L2O5o6S5bqPDQogICAgICAgIGlmIChhLnNvcnRTY29yZSAhPT0gYi5zb3J0U2NvcmUpIHsNCiAgICAgICAgICAgIHJldHVybiBiLnNvcnRTY29yZSAtIGEuc29ydFNjb3JlOw0KICAgICAgICB9DQogICAgICAgIC8vIOS8mOWFiOe6p+WSjOWIhuaVsOmDveebuOWQjOaXtu+8jOaMieWOn+Wni+e0ouW8leaOkuW6j++8jOS/neaMgeeos+Wumg0KICAgICAgICByZXR1cm4gYS5vcmlnaW5hbEluZGV4IC0gYi5vcmlnaW5hbEluZGV4Ow0KICAgIH0pOw0KICAgIA0KICAgIHJldHVybiBtb3ZlczsNCn07DQoNCi8vIOWkhOeQhuWNleS4quaji+WtkOeahOaJgOaciW1vdmVz77yM6K6h566X5py65Yqo5oCn44CB5aiB6IOB5ZKM5L+d5oqkDQpjb25zdCBwcm9jZXNzUGllY2VNb3ZlcyA9IChib2FyZCwgcGllY2VzSW5mbywgaW5mbykgPT4gew0KICAgIGNvbnN0IHsgcGllY2UsIG1vdmVzIH0gPSBpbmZvOw0KICAgIGNvbnN0IHsgYmFzZU1vdmVWYWx1ZSB9ID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5Ow0KICAgIA0KICAgIC8vIDEuIOiuoeeul+acuuWKqOaAp++8muepuuS9jee9rueahOenu+WKqOaVsOmHjw0KICAgIGZvciAoY29uc3QgbW92ZSBvZiBtb3Zlcykgew0KICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFttb3ZlLnJdW21vdmUuY107DQogICAgICAgIGlmICghdGFyZ2V0KSB7DQogICAgICAgICAgICAvLyDnm67moIfkvY3nva7kuLrnqbrvvIzorqHnrpfmnLrliqjmgKcNCiAgICAgICAgICAgIGluZm8ubW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KLy8g5qOA5p+l55uu5qCH5L2N572u5piv5ZCm5Y+v5o6l5Y+X77yI6YG/5YWN5piO5pi+6YCB5ZCDL+S6j+aNou+8iQ0KLy8g5LyY5YyW54mI77ya5o6l5Y+X6aKE6K6h566X55qEYm9hcmRJbmZv5ZKMcGllY2VzSW5mb++8jOmBv+WFjemHjeWkjeiuoeeulw0KY29uc3QgaXNQb3NpdGlvbkFjY2VwdGFibGUgPSAoYm9hcmQsIGZyb20sIHRvLCBjdXJyZW50UGxheWVyLCBib2FyZEluZm8gPSBudWxsLCBwaWVjZXNJbmZvID0gbnVsbCwgdHJ5TW92ZVBpZWNlID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcpID0+IHsNCiAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IHRyeU1vdmVQaWVjZSB8fCBib2FyZFtmcm9tLnJdW2Zyb20uY107DQogICAgY29uc3QgdGFyZ2V0UGllY2UgPSBib2FyZFt0by5yXVt0by5jXTsNCiAgICBjb25zdCBpc0NhcHR1cmUgPSB0YXJnZXRQaWVjZSAmJiB0YXJnZXRQaWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcjsNCg0KICAgIC8vIOaUtumbhuaJgOacieaji+WtkOS/oeaBr++8jOWPquWcqOayoeacieaPkOS+m+aXtuiuoeeulw0KICAgIGxldCBsb2NhbFBpZWNlc0luZm8gPSBwaWVjZXNJbmZvOw0KICAgIGlmICghbG9jYWxQaWVjZXNJbmZvKSB7DQogICAgICAgIGxvY2FsUGllY2VzSW5mbyA9IFtdOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBhbGx5R3VhcmRzID0gW107DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlLCBhbGx5R3VhcmRzKTsNCiAgICAgICAgICAgICAgICAgICAgbG9jYWxQaWVjZXNJbmZvLnB1c2goew0KICAgICAgICAgICAgICAgICAgICAgICAgcGllY2UsDQogICAgICAgICAgICAgICAgICAgICAgICByLCBjLCBtb3ZlcywgYWxseUd1YXJkcywNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsVmFsdWU6IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSksDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkOiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkZWRCeTogW10sDQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpY1ZhbHVlOiAwDQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOiuoeeul+aji+WtkOWFs+ezu+WSjOaOp+WItuS/oeaBr++8jOWPquWcqOayoeacieaPkOS+m+aXtuiuoeeulw0KICAgIGxldCBsb2NhbEJvYXJkSW5mbyA9IGJvYXJkSW5mbzsNCiAgICBpZiAoIWxvY2FsQm9hcmRJbmZvKSB7DQogICAgICAgIGxvY2FsQm9hcmRJbmZvID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7DQogICAgICAgIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zKGJvYXJkLCBsb2NhbFBpZWNlc0luZm8sIGxvY2FsQm9hcmRJbmZvKTsNCiAgICB9DQoNCiAgICBjb25zdCBjb250cm9sbGVycyA9IGxvY2FsQm9hcmRJbmZvW3RvLnJdW3RvLmNdIHx8IFtdOw0KICAgIGxldCBoYXNBbGx5Q29udHJvbGxlciA9IGZhbHNlOw0KICAgIGxldCBoYXNFbmVteUNvbnRyb2xsZXIgPSBmYWxzZTsNCg0KICAgIC8vIOaOp+WItuiAheWPr+iDveaYryBwaWVjZXNJbmZvIOW8leeUqCB7cGllY2UscixjfSDmiJbml6fnu5PmnoQge2NvbG9yLHR5cGUscixjfQ0KICAgIGNvbnN0IGNvbnRyb2xsZXJDb2xvciA9IChjb250cm9sbGVyKSA9Pg0KICAgICAgICBjb250cm9sbGVyLnBpZWNlID8gY29udHJvbGxlci5waWVjZS5jb2xvciA6IGNvbnRyb2xsZXIuY29sb3I7DQoNCiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgY29udHJvbGxlcnMpIHsNCiAgICAgICAgLy8g5o6S6Zmk5q2j5Zyo56e75Yqo55qE5qOL5a2Q5pys6Lqr77yI6LWw5ZCO5a6D5LiN5YaN5LuO5Y6f5L2N5o6n5Yi255uu5qCH77yJDQogICAgICAgIGlmIChtb3ZpbmdQaWVjZSAmJiBjb250cm9sbGVyLnIgPT09IGZyb20uciAmJiBjb250cm9sbGVyLmMgPT09IGZyb20uYykgew0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGNvbnRyb2xsZXJDb2xvcihjb250cm9sbGVyKSA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgaGFzQWxseUNvbnRyb2xsZXIgPSB0cnVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaGFzRW5lbXlDb250cm9sbGVyID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGlmIChpc0NhcHR1cmUpIHsNCiAgICAgICAgLy8g55m95ZCD77ya55uu5qCH5pyq6KKr5pWM5pa55L+d5oqkDQogICAgICAgIGlmICghaGFzRW5lbXlDb250cm9sbGVyKSB7DQogICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgfQ0KICAgICAgICAvLyDnroDljZUgU0VF77ya5YWI5b6X55uu5qCH5YiG77yM6Iul5Lya6KKr5Y+N5ZCD5YiZ5YaN5aSx5bex5pa55qOL5a2QDQogICAgICAgIGNvbnN0IHRhcmdldFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZSh0YXJnZXRQaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgY29uc3Qgb3VyVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKG1vdmluZ1BpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICBsZXQgc2VlID0gdGFyZ2V0VmFsdWUgLSBvdXJWYWx1ZTsNCiAgICAgICAgLy8g6Iul5pyJ5bex5pa557un57ut5L+d5oqk77yM57KX55Wl6K6k5Li65Y+v6IO95YaN5ZCD5Zue5pyA5L2O5Lu35YC855qE5pWM5pa55L+d5oqk6ICFDQogICAgICAgIGlmIChoYXNBbGx5Q29udHJvbGxlcikgew0KICAgICAgICAgICAgY29uc3QgZW5lbXlHdWFyZFZhbHVlcyA9IGNvbnRyb2xsZXJzDQogICAgICAgICAgICAgICAgLmZpbHRlcihjID0+IGNvbnRyb2xsZXJDb2xvcihjKSAhPT0gY3VycmVudFBsYXllciAmJiAhKGMuciA9PT0gZnJvbS5yICYmIGMuYyA9PT0gZnJvbS5jKSkNCiAgICAgICAgICAgICAgICAubWFwKGMgPT4gew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbYy5yXVtjLmNdOw0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gcCA/IGdldE1hdGVyaWFsVmFsdWUocCwgZ2FtZVN0YWdlKSA6IDA7DQogICAgICAgICAgICAgICAgfSkNCiAgICAgICAgICAgICAgICAuZmlsdGVyKHYgPT4gdiA+IDApDQogICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IGEgLSBiKTsNCiAgICAgICAgICAgIGlmIChlbmVteUd1YXJkVmFsdWVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICBzZWUgKz0gZW5lbXlHdWFyZFZhbHVlc1swXTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICAvLyDmmI7mmL7kuo/mjaLvvIjlpoLovabmjaLml6DmoLnlhbXkuJTkvJrooqvlj43lkIPvvInliJnov4fmu6TvvJvlubPmjaIv6LWa5o2i55WZ57uZ5pCc57SiDQogICAgICAgIHJldHVybiBzZWUgPj0gMDsNCiAgICB9DQoNCiAgICAvLyDpnZ7lkIPlrZDvvJrnm67moIfku4XooqvmlYzmlrnmjqfliLbliJnop4bkuLrpgIHlkIMNCiAgICBpZiAoY29udHJvbGxlcnMubGVuZ3RoID09PSAwKSB7DQogICAgICAgIHJldHVybiB0cnVlOw0KICAgIH0NCiAgICByZXR1cm4gIWhhc0VuZW15Q29udHJvbGxlciB8fCBoYXNBbGx5Q29udHJvbGxlcjsNCn07DQoNCi8vIOiuoeeul+WuieWFqOWAvA0KLy8g5Lmd5a6r5L2N572u5a6a5LmJ77yaW+i1t+Wni+ihjCwg57uT5p2f6KGMLCDotbflp4vliJcsIOe7k+adn+WIl10gLSDnp7vliLDlh73mlbDlpJbpg6jvvIzpgb/lhY3ph43lpI3liJvlu7oNCmNvbnN0IFBBTEFDRV9QT1NJVElPTlMgPSB7DQogICAgcmVkOiB7IHN0YXJ0Um93OiAwLCBlbmRSb3c6IDIsIHN0YXJ0Q29sOiAzLCBlbmRDb2w6IDUgfSwgLy8g57qi5pa55Lmd5a6r77yI5bCG55qE5L2N572u77yJDQogICAgYmxhY2s6IHsgc3RhcnRSb3c6IDcsIGVuZFJvdzogOSwgc3RhcnRDb2w6IDMsIGVuZENvbDogNSB9ICAvLyDpu5HmlrnkuZ3lrqvvvIjluIXnmoTkvY3nva7vvIkNCn07DQoNCi8vIOWNkuael+e6v+WumuS5iSAtIOenu+WIsOWHveaVsOWklumDqO+8jOmBv+WFjemHjeWkjeWIm+W7ug0KY29uc3QgTElORUxJTkVfUE9TSVRJT05TID0gew0KICAgIHJlZDogMywgIC8vIOe6ouaWueWNkuael+e6v++8iOm7keWFtemcgOimgei2hei/h+eahOe6v++8iQ0KICAgIGJsYWNrOiA2ICAvLyDpu5HmlrnljZLmnpfnur/vvIjnuqLlhbXpnIDopoHotoXov4fnmoTnur/vvIkNCn07DQoNCi8vIOS7jnBpZWNlc0luZm/nlJ/miJDkvY3nva7mjqfliLbmmKDlsITooagNCmNvbnN0IGJ1aWxkUG9zaXRpb25Db250cm9sTWFwID0gKHBpZWNlc0luZm8pID0+IHsNCiAgICBjb25zdCBwb3NpdGlvbkNvbnRyb2xNYXAgPSBuZXcgTWFwKCk7DQogICAgDQogICAgLy8g6YGN5Y6G5omA5pyJ5qOL5a2Q77yM6K6w5b2V5q+P5Liq5L2N572u55qE5o6n5Yi26ICFDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgLy8g5qOA5p+lY29udHJvbOWxnuaAp+aYr+WQpuWtmOWcqOS4lOS4uuaVsOe7hA0KICAgICAgICBpZiAoIWluZm8uY29udHJvbCB8fCAhQXJyYXkuaXNBcnJheShpbmZvLmNvbnRyb2wpKSB7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy8g6YGN5Y6G6K+l5qOL5a2Q55qE5omA5pyJ5o6n5Yi254K5DQogICAgICAgIGZvciAoY29uc3QgY29udHJvbFBvcyBvZiBpbmZvLmNvbnRyb2wpIHsNCiAgICAgICAgICAgIC8vIOajgOafpWNvbnRyb2xQb3PmmK/lkKbmnInmlYgNCiAgICAgICAgICAgIGlmICghY29udHJvbFBvcyB8fCB0eXBlb2YgY29udHJvbFBvcy5yICE9PSAnbnVtYmVyJyB8fCB0eXBlb2YgY29udHJvbFBvcy5jICE9PSAnbnVtYmVyJykgew0KICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtjb250cm9sUG9zLnJ9LCR7Y29udHJvbFBvcy5jfWA7DQogICAgICAgICAgICBpZiAoIXBvc2l0aW9uQ29udHJvbE1hcC5oYXMoa2V5KSkgew0KICAgICAgICAgICAgICAgIHBvc2l0aW9uQ29udHJvbE1hcC5zZXQoa2V5LCBbXSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICAvLyDorrDlvZXmjqfliLbogIXnmoTpopzoibLlkozmo4vlrZDnsbvlnosNCiAgICAgICAgICAgIHBvc2l0aW9uQ29udHJvbE1hcC5nZXQoa2V5KS5wdXNoKHsNCiAgICAgICAgICAgICAgICBjb2xvcjogaW5mby5waWVjZS5jb2xvciwNCiAgICAgICAgICAgICAgICB0eXBlOiBpbmZvLnBpZWNlLnR5cGUNCiAgICAgICAgICAgIH0pOw0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIHJldHVybiBwb3NpdGlvbkNvbnRyb2xNYXA7DQp9Ow0KDQovLyBTRUUg5o6S5bqP5aSN55So57yT5Yay77yM6ZmN5L2O5Y+26K+E5LywIEdDDQpjb25zdCBzZWVBdHRhY2tlclNjcmF0Y2ggPSBbXTsNCmNvbnN0IHNlZUd1YXJkU2NyYXRjaCA9IFtdOw0KDQovLyDmnInmoLnlrZDnroDljJYgU0VF77yI5LiO5pen5a6e546w6YCQ6KGM562J5Lu377yJ77yb5q+P5Liq55uu5qCH5Y+q5bqU6LCD55So5LiA5qyhDQpjb25zdCBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlID0gKHRocmVhdGVuZWRQaWVjZSkgPT4gew0KICAgIGNvbnN0IGF0dGFja2VycyA9IHNlZUF0dGFja2VyU2NyYXRjaDsNCiAgICBjb25zdCBndWFyZHMgPSBzZWVHdWFyZFNjcmF0Y2g7DQogICAgYXR0YWNrZXJzLmxlbmd0aCA9IDA7DQogICAgZ3VhcmRzLmxlbmd0aCA9IDA7DQogICAgY29uc3QgcmF3QXR0YWNrZXJzID0gdGhyZWF0ZW5lZFBpZWNlLnRocmVhdGVuZWRCeTsNCiAgICBjb25zdCByYXdHdWFyZHMgPSB0aHJlYXRlbmVkUGllY2UuZ3VhcmRlZEJ5Ow0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF3QXR0YWNrZXJzLmxlbmd0aDsgaSsrKSBhdHRhY2tlcnMucHVzaChyYXdBdHRhY2tlcnNbaV0pOw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF3R3VhcmRzLmxlbmd0aDsgaSsrKSBndWFyZHMucHVzaChyYXdHdWFyZHNbaV0pOw0KICAgIGF0dGFja2Vycy5zb3J0KChhLCBiKSA9PiBhLm1hdGVyaWFsVmFsdWUgLSBiLm1hdGVyaWFsVmFsdWUpOw0KICAgIGd1YXJkcy5zb3J0KChhLCBiKSA9PiBhLm1hdGVyaWFsVmFsdWUgLSBiLm1hdGVyaWFsVmFsdWUpOw0KDQogICAgbGV0IGV4Y2hhbmdlU2NvcmUgPSAwOw0KICAgIGxldCBhdHRhY2tlckluZGV4ID0gMDsNCiAgICBsZXQgZ3VhcmRJbmRleCA9IDA7DQogICAgY29uc3QgdGFyZ2V0VmFsdWUgPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsNCg0KICAgIHdoaWxlIChhdHRhY2tlckluZGV4IDwgYXR0YWNrZXJzLmxlbmd0aCAmJiBndWFyZEluZGV4IDwgZ3VhcmRzLmxlbmd0aCkgew0KICAgICAgICBpZiAoZ3VhcmRJbmRleCA9PT0gMCkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSB0YXJnZXRWYWx1ZTsNCiAgICAgICAgfQ0KICAgICAgICBleGNoYW5nZVNjb3JlIC09IGF0dGFja2Vyc1thdHRhY2tlckluZGV4XS5tYXRlcmlhbFZhbHVlOw0KICAgICAgICBpZiAoYXR0YWNrZXJJbmRleCArIDEgPCBhdHRhY2tlcnMubGVuZ3RoKSB7DQogICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IGd1YXJkc1tndWFyZEluZGV4XS5tYXRlcmlhbFZhbHVlOw0KICAgICAgICB9DQogICAgICAgIGF0dGFja2VySW5kZXgrKzsNCiAgICAgICAgZ3VhcmRJbmRleCsrOw0KICAgIH0NCiAgICByZXR1cm4gZXhjaGFuZ2VTY29yZTsNCn07DQoNCi8vIOiuoeeul+WogeiDgeWAvO+8iOWfuuS6juWujOaVtOeahOWogeiDgeWFs+ezu++8iQ0KLy8g5oyJ6KKr5aiB6IOB5a2Q6IGa5ZCI77ya5q+P5Liq55uu5qCH5pyA5aSa5LiA5qyhIFNFRe+8m+WIhuWAvOWKoOe7mSB0aHJlYXRlbmVkQnlbMF0NCi8vIO+8iOWFs+ezu+aehOW7uuaMiSBwaWVjZXNJbmZvIOmhuuW6jyBwdXNo77yM5pWF5LiO5pen4oCc5pS75Ye75pa55aSW5bGC6YGN5Y6G6aaW5qyh6K6h5YiG4oCd5b2S5bGe5LiA6Ie077yJDQpjb25zdCBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMgPSAocGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvID0gbnVsbCkgPT4gew0KICAgIC8vIOe7n+iuoQ0KICAgIGlmIChjdXJyZW50UGxheWVyKSB7DQogICAgICAgIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudFtjdXJyZW50UGxheWVyXSsrOw0KICAgIH0NCg0KICAgIC8vIOWIneWni+WMluWogeiDgeexu+Wei+e7n+iuoeS/oeaBrw0KICAgIGlmIChib2FyZEluZm8pIHsNCiAgICAgICAgYm9hcmRJbmZvLmNoZWNrcyA9IFtdOyAgICAgIC8vIOWwhuWGm+S/oeaBrw0KICAgICAgICBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyA9IFtdOyAgLy8g6KKr5o2J55qE5qOL5a2QDQogICAgICAgIGJvYXJkSW5mby5jYW5DYXB0dXJlID0gW107ICAvLyDlj6/lkIPnmoTmo4vlrZANCiAgICB9DQoNCiAgICBjb25zdCBjaGVja0JvbnVzID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmNoZWNrLmJvbnVzOw0KICAgIGNvbnN0IGNhbkNhcHR1cmVTZWVuID0gbmV3IFNldCgpOw0KDQogICAgZm9yIChsZXQgdGkgPSAwOyB0aSA8IHBpZWNlc0luZm8ubGVuZ3RoOyB0aSsrKSB7DQogICAgICAgIGNvbnN0IHRocmVhdGVuZWRQaWVjZSA9IHBpZWNlc0luZm9bdGldOw0KICAgICAgICBjb25zdCBhdHRhY2tlcnMgPSB0aHJlYXRlbmVkUGllY2UudGhyZWF0ZW5lZEJ5Ow0KICAgICAgICBpZiAoIWF0dGFja2VycyB8fCBhdHRhY2tlcnMubGVuZ3RoID09PSAwKSBjb250aW51ZTsNCg0KICAgICAgICAvLyB0aHJlYXRlbmVkQnlbMF0gPSBwaWVjZXNJbmZvIOmhuuW6j+S4i+acgOWFiOaMguS4iuWogeiDgeeahOaUu+WHu+aWue+8iOS4juaXp+mmluasoeiuoeWIhuS4gOiHtO+8iQ0KICAgICAgICBjb25zdCBmaXJzdEF0dGFja2VyID0gYXR0YWNrZXJzWzBdOw0KDQogICAgICAgIC8vIOWwhuWGm++8muWPque7meWwj+mineWFiOaJi+WIhu+8jOe7neS4jeaMieWwhi/luIXmnZDmlpnlgLzlgZogU0VFDQogICAgICAgIGlmICh0aHJlYXRlbmVkUGllY2UucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgew0KICAgICAgICAgICAgaWYgKGJvYXJkSW5mbykgew0KICAgICAgICAgICAgICAgIGZvciAobGV0IGFpID0gMDsgYWkgPCBhdHRhY2tlcnMubGVuZ3RoOyBhaSsrKSB7DQogICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jaGVja3MucHVzaCh7DQogICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tlcjogYXR0YWNrZXJzW2FpXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldDogdGhyZWF0ZW5lZFBpZWNlLA0KICAgICAgICAgICAgICAgICAgICAgICAgaXNDaGVjazogdHJ1ZQ0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IGNoZWNrQm9udXM7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KDQogICAgICAgIGNvbnN0IGhhc0d1YXJkID0gdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeSAmJiB0aHJlYXRlbmVkUGllY2UuZ3VhcmRlZEJ5Lmxlbmd0aCA+IDA7DQoNCiAgICAgICAgLy8g5Y+q5oqK5a+55pS75Ye75pa55pyJ5Yip55qE5aiB6IOB6K6h5YWlIHRocmVhdFZhbHVl77yI5Y2V5ZCR6K6h5YWl77yM5LiN5YGaIHNhZmV0eSDlr7nnp7DmiaPliIbvvIkNCiAgICAgICAgaWYgKCFoYXNHdWFyZCkgew0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgIGlmIChib2FyZEluZm8pIHsNCiAgICAgICAgICAgICAgICAvLyDmlLvlh7vmlrnlkIzoibLvvJropoHkuYjlhajmmK8gY3VycmVudFBsYXllcu+8iOiusCBjYW5DYXB0dXJl77yJ77yM6KaB5LmI5YWo5LiN5piv77yI6K6wIHRocmVhdGVuZWRQaWVjZXPvvIkNCiAgICAgICAgICAgICAgICBpZiAoZmlyc3RBdHRhY2tlci5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBhaSA9IDA7IGFpIDwgYXR0YWNrZXJzLmxlbmd0aDsgYWkrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGF0dGFja2Vyc1thaV07DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbkNhcHR1cmVTZWVuLmhhcyhpbmZvKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbkNhcHR1cmVTZWVuLmFkZChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2FuQ2FwdHVyZS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMucHVzaCh0aHJlYXRlbmVkUGllY2UpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIC8vIFNFRSDmr4/nm67moIfkuIDmrKHvvJvmnInmoLnkuJTkuqTmjaLku43otZrliJnmipjljYrorqHlhaUNCiAgICAgICAgICAgIGNvbnN0IHNzZVNjb3JlID0gY2FsY3VsYXRlU3RhdGljRXhjaGFuZ2VTY29yZSh0aHJlYXRlbmVkUGllY2UpOw0KICAgICAgICAgICAgaWYgKHNzZVNjb3JlID4gMCkgew0KICAgICAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gc3NlU2NvcmUgKiAwLjU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICAvLyBzc2VTY29yZSA8PSAw77ya5LqP5o2iL+W5s+aNou+8jOS4jeiusOWogeiDgeWIhg0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KLy8g6K6h566X5a6J5YWo5YC8IC0g6YeN5p6E54mI77ya5Z+65LqOYm9hcmRJbmZv55qE5o6n5Yi25YWz57O7DQpjb25zdCBjYWxjdWxhdGVTYWZldHlWYWx1ZXMgPSAocGllY2VzSW5mbywgYm9hcmRJbmZvKSA9PiB7DQogICAgLy8gMS4g5om+5Yiw5bCG5ZKM5biFDQogICAgY29uc3QgZ2VuZXJhbEluZm8gPSBbXTsNCiAgICBwaWVjZXNJbmZvLmZvckVhY2goaW5mbyA9PiB7DQogICAgICAgIGlmIChpbmZvLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkdFTkVSQUwpIHsNCiAgICAgICAgICAgIGdlbmVyYWxJbmZvLnB1c2goaW5mbyk7DQogICAgICAgIH0NCiAgICB9KTsNCg0KICAgIGNvbnN0IHVzZUF0dGFja0JpdHMgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMpOw0KICAgIA0KICAgIGZvciAoY29uc3QgZ2VuZXJhbCBvZiBnZW5lcmFsSW5mbykgew0KICAgICAgICBjb25zdCBnZW5lcmFsQ29sb3IgPSBnZW5lcmFsLnBpZWNlLmNvbG9yOw0KICAgICAgICBjb25zdCBlbmVteUNvbG9yID0gZ2VuZXJhbENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgY29uc3QgZW5lbXlCaXRzID0gdXNlQXR0YWNrQml0cw0KICAgICAgICAgICAgPyAoZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkQXR0YWNrIDogYm9hcmRJbmZvLmJsYWNrQXR0YWNrKQ0KICAgICAgICAgICAgOiBudWxsOw0KICAgICAgICANCiAgICAgICAgLy8g5qOA5p+l5bCG5biF55qE5o6n5Yi254K55piv5ZCm6KKr5pWM5pa55qOL5a2Q5o6n5Yi2DQogICAgICAgIGZvciAoY29uc3QgY29udHJvbFBvcyBvZiBnZW5lcmFsLmNvbnRyb2wpIHsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gY29udHJvbFBvczsNCiAgICAgICAgICAgIGxldCBoYXNFbmVteUNvbnRyb2w7DQogICAgICAgICAgICBpZiAodXNlQXR0YWNrQml0cykgew0KICAgICAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbCA9IGhhc0F0dGFja0JpdChlbmVteUJpdHMsIHIgKiA5ICsgYyk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uQ29udHJvbGxlcnMgPSBib2FyZEluZm9bcl1bY107DQogICAgICAgICAgICAgICAgLy8g5YW85a65IHBpZWNlc0luZm8g5byV55So5LiO5penIHtjb2xvcn0g57uT5p6EDQogICAgICAgICAgICAgICAgaGFzRW5lbXlDb250cm9sID0gcG9zaXRpb25Db250cm9sbGVycy5zb21lKGNvbnRyb2xsZXIgPT4gew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2xvciA9IGNvbnRyb2xsZXIucGllY2UgPyBjb250cm9sbGVyLnBpZWNlLmNvbG9yIDogY29udHJvbGxlci5jb2xvcjsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSBlbmVteUNvbG9yOw0KICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDlpoLmnpzkvY3nva7mnInmlYzmlrnmo4vlrZDmjqfliLbvvIzmiaM1MOeahOWuieWFqOWAvA0KICAgICAgICAgICAgaWYgKGhhc0VuZW15Q29udHJvbCkgew0KICAgICAgICAgICAgICAgIGdlbmVyYWwuc2FmZXR5VmFsdWUgLT0gNTA7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQp9Ow0KDQovLyDluK7liqnlhbPns7vmiJjmnK/lgLzorqHnrpcNCmNvbnN0IGNhbGN1bGF0ZUFzc2lzdFZhbHVlID0gKHBpZWNlc0luZm8sIGluZm8pID0+IHsNCiAgICBjb25zdCB7IHBpZWNlLCByLCBjIH0gPSBpbmZvOw0KICAgIGxldCBhc3Npc3RWYWx1ZSA9IDA7DQogICAgDQogICAgLy8gMS4g5qOA5p+l5piv5ZCm5Li65bex5pa554Ku55qE54Ku5p6277yI5Yqg5YiG77yJDQogICAgZm9yIChjb25zdCBhbGx5SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChhbGx5SW5mby5waWVjZS5jb2xvciA9PT0gcGllY2UuY29sb3IgJiYgYWxseUluZm8gIT09IGluZm8gJiYgYWxseUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuQ0FOTk9OKSB7DQogICAgICAgICAgICAvLyDmo4Dmn6Xngq7lkozlvZPliY3mo4vlrZDmmK/lkKblnKjlkIzkuIDnm7Tnur/kuIoNCiAgICAgICAgICAgIGlmIChhbGx5SW5mby5yID09PSByIHx8IGFsbHlJbmZvLmMgPT09IGMpIHsNCiAgICAgICAgICAgICAgICAvLyDmo4Dmn6Xngq7lkozlvZPliY3mo4vlrZDkuYvpl7TmmK/lkKbmsqHmnInlhbbku5bmo4vlrZANCiAgICAgICAgICAgICAgICBsZXQgaGFzU2NyZWVuID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICBpZiAoYWxseUluZm8uciA9PT0gcikgew0KICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDooYwNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbihhbGx5SW5mby5jLCBjKSArIDE7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KGFsbHlJbmZvLmMsIGMpIC0gMTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgY29sID0gc3RhcnQ7IGNvbCA8PSBlbmQ7IGNvbCsrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiZXR3ZWVuUGllY2UgPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHIgJiYgcC5jID09PSBjb2wpOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJldHdlZW5QaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhc1NjcmVlbiA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA5YiXDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oYWxseUluZm8uciwgcikgKyAxOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heChhbGx5SW5mby5yLCByKSAtIDE7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IHJvdyA9IHN0YXJ0OyByb3cgPD0gZW5kOyByb3crKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmV0d2VlblBpZWNlID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSByb3cgJiYgcC5jID09PSBjKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiZXR3ZWVuUGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYXNTY3JlZW4gPSBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoaGFzU2NyZWVuKSB7DQogICAgICAgICAgICAgICAgICAgIGFzc2lzdFZhbHVlICs9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5hc3Npc3QuY2Fubm9uU2NyZWVuVmFsdWU7IC8vIOS4uuW3seaWueeCruaPkOS+m+eCruaetu+8jOWinuWKoOaImOacr+WAvA0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyAyLiDmo4Dmn6XmmK/lkKbkuLrmlYzmlrnngq7nmoTngq7mnrbvvIjmiaPliIbvvIkNCiAgICBmb3IgKGNvbnN0IGVuZW15SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChlbmVteUluZm8ucGllY2UuY29sb3IgIT09IHBpZWNlLmNvbG9yICYmIGVuZW15SW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5DQU5OT04pIHsNCiAgICAgICAgICAgIC8vIOajgOafpeaVjOaWueeCruWSjOW9k+WJjeaji+WtkOaYr+WQpuWcqOWQjOS4gOebtOe6v+S4ig0KICAgICAgICAgICAgaWYgKGVuZW15SW5mby5yID09PSByIHx8IGVuZW15SW5mby5jID09PSBjKSB7DQogICAgICAgICAgICAgICAgLy8g5qOA5p+l5pWM5pa554Ku5ZKM5b2T5YmN5qOL5a2Q5LmL6Ze05piv5ZCm5rKh5pyJ5YW25LuW5qOL5a2QDQogICAgICAgICAgICAgICAgbGV0IGlzRW5lbXlTY3JlZW4gPSB0cnVlOw0KICAgICAgICAgICAgICAgIGlmIChlbmVteUluZm8uciA9PT0gcikgew0KICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDooYwNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbihlbmVteUluZm8uYywgYykgKyAxOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heChlbmVteUluZm8uYywgYykgLSAxOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBjb2wgPSBzdGFydDsgY29sIDw9IGVuZDsgY29sKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJldHdlZW5QaWVjZSA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gciAmJiBwLmMgPT09IGNvbCk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYmV0d2VlblBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNFbmVteVNjcmVlbiA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA5YiXDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oZW5lbXlJbmZvLnIsIHIpICsgMTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoZW5lbXlJbmZvLnIsIHIpIC0gMTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgcm93ID0gc3RhcnQ7IHJvdyA8PSBlbmQ7IHJvdysrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiZXR3ZWVuUGllY2UgPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHJvdyAmJiBwLmMgPT09IGMpOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJldHdlZW5QaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzRW5lbXlTY3JlZW4gPSBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoaXNFbmVteVNjcmVlbikgew0KICAgICAgICAgICAgICAgICAgICBhc3Npc3RWYWx1ZSAtPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuYXNzaXN0LmNhbm5vblNjcmVlblZhbHVlOyAvLyDkuLrmlYzmlrnngq7mj5Dkvpvngq7mnrbvvIzlh4/lsJHmiJjmnK/lgLzvvIjmiaPliIbvvIkNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgcmV0dXJuIGFzc2lzdFZhbHVlOw0KfTsNCg0KLy8g6Zi75oyh5YWz57O75oiY5pyv5YC86K6h566XDQpjb25zdCBjYWxjdWxhdGVCbG9ja1ZhbHVlID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBpbmZvKSA9PiB7DQogICAgY29uc3QgeyBwaWVjZSwgciwgYyB9ID0gaW5mbzsNCiAgICBsZXQgYmxvY2tWYWx1ZSA9IDA7DQogICAgY29uc3QgZW5lbXlDb2xvciA9IHBpZWNlLmNvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICANCiAgICAvLyAxLiDpmLvmjKHmlYzkuroNCiAgICAvLyAxLjEg5qOA5p+l5piv5ZCm6Zi75oyh5a+55pa56L2m55qE6YGT6LevDQogICAgZm9yIChjb25zdCBlbmVteUluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoZW5lbXlJbmZvLnBpZWNlLmNvbG9yID09PSBlbmVteUNvbG9yICYmIGVuZW15SW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5DSEFSSU9UKSB7DQogICAgICAgICAgICAvLyDmo4Dmn6XovablkozlvZPliY3mo4vlrZDmmK/lkKblnKjlkIzkuIDnm7Tnur/kuIoNCiAgICAgICAgICAgIGlmIChlbmVteUluZm8uciA9PT0gciB8fCBlbmVteUluZm8uYyA9PT0gYykgew0KICAgICAgICAgICAgICAgIC8vIOajgOafpeS4pOiAheS5i+mXtOaYr+WQpuayoeacieWFtuWug+aji+WtkA0KICAgICAgICAgICAgICAgIGxldCBpc0Jsb2NraW5nID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoZW5lbXlJbmZvLnIgPT09IHIpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA6KGMDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oZW5lbXlJbmZvLmMsIGMpICsgMTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoZW5lbXlJbmZvLmMsIGMpIC0gMTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgY29sID0gc3RhcnQ7IGNvbCA8PSBlbmQ7IGNvbCsrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiZXR3ZWVuUGllY2UgPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHIgJiYgcC5jID09PSBjb2wpOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJldHdlZW5QaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQmxvY2tpbmcgPSBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOWIlw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKGVuZW15SW5mby5yLCByKSArIDE7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KGVuZW15SW5mby5yLCByKSAtIDE7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IHJvdyA9IHN0YXJ0OyByb3cgPD0gZW5kOyByb3crKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmV0d2VlblBpZWNlID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSByb3cgJiYgcC5jID09PSBjKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiZXR3ZWVuUGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0Jsb2NraW5nID0gZmFsc2U7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGlzQmxvY2tpbmcpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5qOA5p+l5piv5ZCm6Zi75oyh5LqG6L2m55qE56e75YqoDQogICAgICAgICAgICAgICAgICAgIGJsb2NrVmFsdWUgKz0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmJsb2NrLmVuZW15Q2hhcmlvdEJsb2NrVmFsdWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIDEuMiDmo4Dmn6XmmK/lkKbliKvlr7nmlrnpqaznmoTpqazohb8NCiAgICBmb3IgKGNvbnN0IGVuZW15SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChlbmVteUluZm8ucGllY2UuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgZW5lbXlJbmZvLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkhPUlNFKSB7DQogICAgICAgICAgICBjb25zdCBob3JzZVIgPSBlbmVteUluZm8ucjsNCiAgICAgICAgICAgIGNvbnN0IGhvcnNlQyA9IGVuZW15SW5mby5jOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDpqazohb/kvY3nva7vvJrpqaznmoTlkajlm7Q45Liq5pa55ZCR55qE6IW/55qE5L2N572uDQogICAgICAgICAgICBjb25zdCBsZWdQb3NpdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIgKyAxLCBjOiBob3JzZUMgfSwgLy8g5LiL5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIgLSAxLCBjOiBob3JzZUMgfSwgLy8g5LiK5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIsIGM6IGhvcnNlQyArIDEgfSwgLy8g5Y+z5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIsIGM6IGhvcnNlQyAtIDEgfSAgLy8g5bem5pa56IW/DQogICAgICAgICAgICBdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmo4Dmn6XlvZPliY3mo4vlrZDmmK/lkKblnKjpqazohb/kvY3nva4NCiAgICAgICAgICAgIGZvciAoY29uc3QgbGVnUG9zIG9mIGxlZ1Bvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGlmIChsZWdQb3MuciA9PT0gciAmJiBsZWdQb3MuYyA9PT0gYykgew0KICAgICAgICAgICAgICAgICAgICBibG9ja1ZhbHVlICs9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5ibG9jay5lbmVteUhvcnNlQmxvY2tWYWx1ZTsgLy8g5Yir6ams6IW/77yM5aKe5Yqg5oiY5pyv5YC8DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIDEuMyDmo4Dmn6XmmK/lkKbloLXloZ7lr7nmlrnosaHnmoTosaHnnLwNCiAgICBmb3IgKGNvbnN0IGVuZW15SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChlbmVteUluZm8ucGllY2UuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgZW5lbXlJbmZvLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkVMRVBIQU5UKSB7DQogICAgICAgICAgICBjb25zdCBlbGVwaGFudFIgPSBlbmVteUluZm8ucjsNCiAgICAgICAgICAgIGNvbnN0IGVsZXBoYW50QyA9IGVuZW15SW5mby5jOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDosaHnnLzkvY3nva7vvJrosaHnmoTlkajlm7Q05Liq5pa55ZCR55qE6LGh55y85L2N572uDQogICAgICAgICAgICBjb25zdCBleWVQb3NpdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgKyAxLCBjOiBlbGVwaGFudEMgKyAxIH0sIC8vIOWPs+S4i+ixoeecvA0KICAgICAgICAgICAgICAgIHsgcjogZWxlcGhhbnRSICsgMSwgYzogZWxlcGhhbnRDIC0gMSB9LCAvLyDlt6bkuIvosaHnnLwNCiAgICAgICAgICAgICAgICB7IHI6IGVsZXBoYW50UiAtIDEsIGM6IGVsZXBoYW50QyArIDEgfSwgLy8g5Y+z5LiK6LGh55y8DQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgLSAxLCBjOiBlbGVwaGFudEMgLSAxIH0gIC8vIOW3puS4iuixoeecvA0KICAgICAgICAgICAgXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5qOA5p+l5b2T5YmN5qOL5a2Q5piv5ZCm5Zyo6LGh55y85L2N572uDQogICAgICAgICAgICBmb3IgKGNvbnN0IGV5ZVBvcyBvZiBleWVQb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBpZiAoZXllUG9zLnIgPT09IHIgJiYgZXllUG9zLmMgPT09IGMpIHsNCiAgICAgICAgICAgICAgICAgICAgYmxvY2tWYWx1ZSArPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuYmxvY2suZW5lbXlFbGVwaGFudEJsb2NrVmFsdWU7IC8vIOWgteWhnuixoeecvO+8jOWinuWKoOaImOacr+WAvA0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyAyLiDpmLvmjKHlt7HmlrnvvIjmiaPliIbvvIkNCiAgICAvLyAyLjEg5qOA5p+l5piv5ZCm6Zi75oyh5bex5pa56L2m55qE6YGT6LevDQogICAgZm9yIChjb25zdCBhbGx5SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChhbGx5SW5mby5waWVjZS5jb2xvciA9PT0gcGllY2UuY29sb3IgJiYgYWxseUluZm8gIT09IGluZm8gJiYgYWxseUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuQ0hBUklPVCkgew0KICAgICAgICAgICAgLy8g5qOA5p+l6L2m5ZKM5b2T5YmN5qOL5a2Q5piv5ZCm5Zyo5ZCM5LiA55u057q/5LiKDQogICAgICAgICAgICBpZiAoYWxseUluZm8uciA9PT0gciB8fCBhbGx5SW5mby5jID09PSBjKSB7DQogICAgICAgICAgICAgICAgLy8g5qOA5p+l5Lik6ICF5LmL6Ze05piv5ZCm5rKh5pyJ5YW25a6D5qOL5a2QDQogICAgICAgICAgICAgICAgbGV0IGlzQmxvY2tpbmcgPSB0cnVlOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChhbGx5SW5mby5yID09PSByKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOihjA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKGFsbHlJbmZvLmMsIGMpICsgMTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoYWxseUluZm8uYywgYykgLSAxOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBjb2wgPSBzdGFydDsgY29sIDw9IGVuZDsgY29sKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJldHdlZW5QaWVjZSA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gciAmJiBwLmMgPT09IGNvbCk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYmV0d2VlblBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNCbG9ja2luZyA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA5YiXDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oYWxseUluZm8uciwgcikgKyAxOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heChhbGx5SW5mby5yLCByKSAtIDE7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IHJvdyA9IHN0YXJ0OyByb3cgPD0gZW5kOyByb3crKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmV0d2VlblBpZWNlID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSByb3cgJiYgcC5jID09PSBjKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiZXR3ZWVuUGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0Jsb2NraW5nID0gZmFsc2U7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGlzQmxvY2tpbmcpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g6Zi75oyh5bex5pa56L2m6YGT6Lev77yM5omj5YiGDQogICAgICAgICAgICAgICAgICAgIGJsb2NrVmFsdWUgLT0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmJsb2NrLmFsbHlDaGFyaW90QmxvY2tQZW5hbHR5Ow0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyAyLjIg5qOA5p+l5piv5ZCm5Yir5bex5pa56ams55qE6ams6IW/DQogICAgZm9yIChjb25zdCBhbGx5SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChhbGx5SW5mby5waWVjZS5jb2xvciA9PT0gcGllY2UuY29sb3IgJiYgYWxseUluZm8gIT09IGluZm8gJiYgYWxseUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuSE9SU0UpIHsNCiAgICAgICAgICAgIGNvbnN0IGhvcnNlUiA9IGFsbHlJbmZvLnI7DQogICAgICAgICAgICBjb25zdCBob3JzZUMgPSBhbGx5SW5mby5jOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDpqazohb/kvY3nva7vvJrpqaznmoTlkajlm7Q45Liq5pa55ZCR55qE6IW/55qE5L2N572uDQogICAgICAgICAgICBjb25zdCBsZWdQb3NpdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIgKyAxLCBjOiBob3JzZUMgfSwgLy8g5LiL5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIgLSAxLCBjOiBob3JzZUMgfSwgLy8g5LiK5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIsIGM6IGhvcnNlQyArIDEgfSwgLy8g5Y+z5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIsIGM6IGhvcnNlQyAtIDEgfSAgLy8g5bem5pa56IW/DQogICAgICAgICAgICBdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmo4Dmn6XlvZPliY3mo4vlrZDmmK/lkKblnKjpqazohb/kvY3nva4NCiAgICAgICAgICAgIGZvciAoY29uc3QgbGVnUG9zIG9mIGxlZ1Bvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGlmIChsZWdQb3MuciA9PT0gciAmJiBsZWdQb3MuYyA9PT0gYykgew0KICAgICAgICAgICAgICAgICAgICBibG9ja1ZhbHVlIC09IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5ibG9jay5hbGx5SG9yc2VCbG9ja1BlbmFsdHk7IC8vIOWIq+W3seaWuemprOiFv++8jOaJo+WIhg0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyAyLjMg5qOA5p+l5piv5ZCm5aC15aGe5bex5pa56LGh55qE6LGh55y8DQogICAgZm9yIChjb25zdCBhbGx5SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChhbGx5SW5mby5waWVjZS5jb2xvciA9PT0gcGllY2UuY29sb3IgJiYgYWxseUluZm8gIT09IGluZm8gJiYgYWxseUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuRUxFUEhBTlQpIHsNCiAgICAgICAgICAgIGNvbnN0IGVsZXBoYW50UiA9IGFsbHlJbmZvLnI7DQogICAgICAgICAgICBjb25zdCBlbGVwaGFudEMgPSBhbGx5SW5mby5jOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDosaHnnLzkvY3nva7vvJrosaHnmoTlkajlm7Q05Liq5pa55ZCR55qE6LGh55y85L2N572uDQogICAgICAgICAgICBjb25zdCBleWVQb3NpdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgKyAxLCBjOiBlbGVwaGFudEMgKyAxIH0sIC8vIOWPs+S4i+ixoeecvA0KICAgICAgICAgICAgICAgIHsgcjogZWxlcGhhbnRSICsgMSwgYzogZWxlcGhhbnRDIC0gMSB9LCAvLyDlt6bkuIvosaHnnLwNCiAgICAgICAgICAgICAgICB7IHI6IGVsZXBoYW50UiAtIDEsIGM6IGVsZXBoYW50QyArIDEgfSwgLy8g5Y+z5LiK6LGh55y8DQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgLSAxLCBjOiBlbGVwaGFudEMgLSAxIH0gIC8vIOW3puS4iuixoeecvA0KICAgICAgICAgICAgXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5qOA5p+l5b2T5YmN5qOL5a2Q5piv5ZCm5Zyo6LGh55y85L2N572uDQogICAgICAgICAgICBmb3IgKGNvbnN0IGV5ZVBvcyBvZiBleWVQb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBpZiAoZXllUG9zLnIgPT09IHIgJiYgZXllUG9zLmMgPT09IGMpIHsNCiAgICAgICAgICAgICAgICAgICAgYmxvY2tWYWx1ZSAtPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuYmxvY2suYWxseUVsZXBoYW50QmxvY2tQZW5hbHR5OyAvLyDloLXloZ7lt7HmlrnosaHnnLzvvIzmiaPliIYNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgcmV0dXJuIGJsb2NrVmFsdWU7DQp9Ow0KDQoNCi8vIC0tLSBUeXBlcyAoSW5saW5lZCB0byBhdm9pZCBpbXBvcnQgaXNzdWVzIGluIFdvcmtlcikgLS0tDQovLyAvLyB0eXBlIENvbG9yIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAncmVkJyB8ICdibGFjayc7DQovLyAvLyB0eXBlIFBpZWNlVHlwZSAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgJ2dlbmVyYWwnIHwgJ2Fkdmlzb3InIHwgJ2VsZXBoYW50JyB8ICdob3JzZScgfCAnY2hhcmlvdCcgfCAnY2Fubm9uJyB8ICdzb2xkaWVyJzsNCi8vIC8vIGludGVyZmFjZSBQaWVjZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gaW50ZXJmYWNlIFBvc2l0aW9uIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQovLyAvLyBpbnRlcmZhY2UgTW92ZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gdHlwZSBCb2FyZCAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgKFBpZWNlIHwgbnVsbClbXVtdOw0KDQovLyAtLS0gT3BlbmluZyBCb29rIFR5cGVzIC0tLQ0KLy8gT3BlbmluZyBCb29rIEVudHJ5IC0gcmVwcmVzZW50cyBwb3NzaWJsZSBtb3ZlcyBmb3IgYSBwb3NpdGlvbg0KLy8gaW50ZXJmYWNlIEJvb2tFbnRyeSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KDQovLyBJbmRpdmlkdWFsIG1vdmUgaW4gb3BlbmluZyBib29rIHdpdGggbWV0YWRhdGENCi8vIGludGVyZmFjZSBCb29rTW92ZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KDQovLyAtLS0gWm9icmlzdCBIYXNoaW5nIGZvciBPcGVuaW5nIEJvb2sgLS0tDQovLyBFYWNoIHBpZWNlIHR5cGUvY29sb3IvcG9zaXRpb24gZ2V0cyBhIHVuaXF1ZSByYW5kb20gNTMtYml0IGludGVnZXINCi8vIFVzZXMgc2VlZGVkIFJORyBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nDQpjbGFzcyBab2JyaXN0SGFzaGVyIHsNCiAgICBoYXNoVGFibGU7ICAvLyBbcm93XVtjb2xdW3BpZWNlSW5kZXhdDQogICAgcGllY2VUb0luZGV4Ow0KDQogICAgY29uc3RydWN0b3IoKSB7DQogICAgICAgIHRoaXMucGllY2VUb0luZGV4ID0gbmV3IE1hcChbDQogICAgICAgICAgICBbJ3JlZC1nZW5lcmFsJywgMF0sDQogICAgICAgICAgICBbJ3JlZC1hZHZpc29yJywgMV0sDQogICAgICAgICAgICBbJ3JlZC1lbGVwaGFudCcsIDJdLA0KICAgICAgICAgICAgWydyZWQtaG9yc2UnLCAzXSwNCiAgICAgICAgICAgIFsncmVkLWNoYXJpb3QnLCA0XSwNCiAgICAgICAgICAgIFsncmVkLWNhbm5vbicsIDVdLA0KICAgICAgICAgICAgWydyZWQtc29sZGllcicsIDZdLA0KICAgICAgICAgICAgWydibGFjay1nZW5lcmFsJywgN10sDQogICAgICAgICAgICBbJ2JsYWNrLWFkdmlzb3InLCA4XSwNCiAgICAgICAgICAgIFsnYmxhY2stZWxlcGhhbnQnLCA5XSwNCiAgICAgICAgICAgIFsnYmxhY2staG9yc2UnLCAxMF0sDQogICAgICAgICAgICBbJ2JsYWNrLWNoYXJpb3QnLCAxMV0sDQogICAgICAgICAgICBbJ2JsYWNrLWNhbm5vbicsIDEyXSwNCiAgICAgICAgICAgIFsnYmxhY2stc29sZGllcicsIDEzXSwNCiAgICAgICAgXSk7DQoNCiAgICAgICAgLy8gSW5pdGlhbGl6ZSByYW5kb20gaGFzaCB2YWx1ZXMgdXNpbmcgc2VlZGVkIFJORyAoNTMtYml0IGludGVnZXJzIHRvIGF2b2lkIHByZWNpc2lvbiBpc3N1ZXMpDQogICAgICAgIHRoaXMuaGFzaFRhYmxlID0gW107DQogICAgICAgIGNvbnN0IE1BWF9TQUZFID0gMHgxRkZGRkZGRkZGRkZGRjsgLy8gMl41MyAtIDENCiAgICAgICAgDQogICAgICAgIC8vIFNpbXBsZSBzZWVkZWQgUk5HIChMQ0cgLSBMaW5lYXIgQ29uZ3J1ZW50aWFsIEdlbmVyYXRvcikNCiAgICAgICAgbGV0IHNlZWQgPSAxMjM0NTY3ODk7IC8vIEZpeGVkIHNlZWQgZm9yIGRldGVybWluaXN0aWMgaGFzaGluZw0KICAgICAgICBjb25zdCBzZWVkZWRSYW5kb20gPSAoKSA9PiB7DQogICAgICAgICAgICBzZWVkID0gKHNlZWQgKiAxMTAzNTE1MjQ1ICsgMTIzNDUpICYgMHg3ZmZmZmZmZjsNCiAgICAgICAgICAgIHJldHVybiBzZWVkIC8gMHg3ZmZmZmZmZjsNCiAgICAgICAgfTsNCg0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgIHRoaXMuaGFzaFRhYmxlW3JdID0gW107DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgIHRoaXMuaGFzaFRhYmxlW3JdW2NdID0gW107DQogICAgICAgICAgICAgICAgZm9yIChsZXQgcCA9IDA7IHAgPCAxNDsgcCsrKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIGRldGVybWluaXN0aWMgNTMtYml0IGludGVnZXINCiAgICAgICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY11bcF0gPSBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIC8vIOWPtuivhOS8sOe8k+WtmOmUru+8mmJvYXJkSGFzaCBeIGluaXRpYXRvcktleSBeIHN0YWdlS2V5DQogICAgICAgIHRoaXMuZXZhbEluaXRpYXRvcktleXMgPSB7DQogICAgICAgICAgICByZWQ6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSksDQogICAgICAgICAgICBibGFjazogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKQ0KICAgICAgICB9Ow0KICAgICAgICB0aGlzLmV2YWxTdGFnZUtleXMgPSB7DQogICAgICAgICAgICBlYXJseTogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwNCiAgICAgICAgICAgIG1pZDogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwNCiAgICAgICAgICAgIGxhdGU6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSkNCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICBwaWVjZUluZGV4KHBpZWNlT3JLZXkpIHsNCiAgICAgICAgaWYgKHBpZWNlT3JLZXkgPT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDsNCiAgICAgICAgaWYgKHR5cGVvZiBwaWVjZU9yS2V5ID09PSAnc3RyaW5nJykgcmV0dXJuIHRoaXMucGllY2VUb0luZGV4LmdldChwaWVjZU9yS2V5KTsNCiAgICAgICAgcmV0dXJuIHRoaXMucGllY2VUb0luZGV4LmdldChgJHtwaWVjZU9yS2V5LmNvbG9yfS0ke3BpZWNlT3JLZXkudHlwZX1gKTsNCiAgICB9DQoNCiAgICBldmFsQ2FjaGVLZXkoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKSB7DQogICAgICAgIGNvbnN0IHN0YWdlS2V5ID0gdGhpcy5ldmFsU3RhZ2VLZXlzW2dhbWVTdGFnZV0gfHwgdGhpcy5ldmFsU3RhZ2VLZXlzLm1pZDsNCiAgICAgICAgcmV0dXJuIHRoaXMuaGFzaChib2FyZCkgXiB0aGlzLmV2YWxJbml0aWF0b3JLZXlzW3NlYXJjaEluaXRpYXRvcl0gXiBzdGFnZUtleTsNCiAgICB9DQoNCiAgICBldmFsQ2FjaGVLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKSB7DQogICAgICAgIGNvbnN0IHN0YWdlS2V5ID0gdGhpcy5ldmFsU3RhZ2VLZXlzW2dhbWVTdGFnZV0gfHwgdGhpcy5ldmFsU3RhZ2VLZXlzLm1pZDsNCiAgICAgICAgcmV0dXJuIGJvYXJkSGFzaCBeIHRoaXMuZXZhbEluaXRpYXRvcktleXNbc2VhcmNoSW5pdGlhdG9yXSBeIHN0YWdlS2V5Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIOaVsOWAvCBUVCBrZXnvvJrmiorooYzmo4vmlrnnvJbnoIHov5vmnIDkvY7kvY3vvIzpgb/lhY0gYGhhc2ggXiBzaWRlS2V5YCDlnKggSlMgVG9JbnQzMg0KICAgICAqIOS4i+S6p+eUn+i3qOe6oum7keeisOaSnu+8iOmCo+S8muS9vyBUVCDor6/lkb3kuK3lubbmlLnlj5jmkJzntKLmoJEv5qOL5Yqb77yJ44CCDQogICAgICog562J5Lu35LqO5pen5a2X56ym5LiyIGtleSBgJHtoYXNofToke3NpZGV9YCDnmoTljLrliIbog73lipvjgIINCiAgICAgKi8NCiAgICB0dEtleUZyb21IYXNoKGJvYXJkSGFzaCwgc2lkZSkgew0KICAgICAgICBjb25zdCBoID0gYm9hcmRIYXNoIHwgMDsgLy8gXj0g6ZO+57uT5p6c5bey5pivIEludDMyDQogICAgICAgIHJldHVybiBoICogMiArIChzaWRlID09PSAncmVkJyA/IDAgOiAxKTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDb21wdXRlIGhhc2ggZm9yIGEgYm9hcmQgcG9zaXRpb24NCiAgICAgKi8NCiAgICBoYXNoKGJvYXJkKSB7DQogICAgICAgIGxldCBoID0gMDsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlSWR4ID0gdGhpcy5waWVjZUluZGV4KHBpZWNlKTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGggXj0gdGhpcy5oYXNoVGFibGVbcl1bY11bcGllY2VJZHhdOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBoOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIE1pcnJvciBhIGJvYXJkIGhvcml6b250YWxseSAoZm9yIHN5bW1ldHJ5IGRldGVjdGlvbikNCiAgICAgKi8NCiAgICBtaXJyb3JCb2FyZChib2FyZCkgew0KICAgICAgICBjb25zdCBtaXJyb3JlZCA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpKTsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgIG1pcnJvcmVkW3JdWzggLSBjXSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBtaXJyb3JlZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBNaXJyb3IgYSBtb3ZlIGhvcml6b250YWxseQ0KICAgICAqLw0KICAgIG1pcnJvck1vdmUobW92ZSkgew0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogOCAtIG1vdmUuZnJvbS5jIH0sDQogICAgICAgICAgICB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IDggLSBtb3ZlLnRvLmMgfQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEluY3JlbWVudGFsbHkgdXBkYXRlIGhhc2ggYWZ0ZXIgYSBtb3ZlIChYT1Ig6Ieq6YCG77ya5YaN6LCD55So5LiA5qyh5Y+v6L+Y5Y6fKS4NCiAgICAgKiBtb3ZpbmdQaWVjZSAvIGNhcHR1cmVkUGllY2Ug5Y+v5Li65qOL5a2Q5a+56LGh5oiWICdjb2xvci10eXBlJyDlrZfnrKbkuLLjgIINCiAgICAgKiDpobvlnKggbWFrZU1vdmUg5LmL5YmN5Y+W5b6XIG1vdmluZ1BpZWNl77yMY2FwdHVyZWQg55SoIG1ha2VNb3ZlIOi/lOWbnuWAvOOAgg0KICAgICAqLw0KICAgIHVwZGF0ZUhhc2goY3VycmVudEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgIGxldCBuZXdIYXNoID0gY3VycmVudEhhc2g7DQogICAgICAgIGNvbnN0IG1vdmluZ0lkeCA9IHRoaXMucGllY2VJbmRleChtb3ZpbmdQaWVjZSk7DQogICAgICAgIGlmIChtb3ZpbmdJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgbmV3SGFzaCBePSB0aGlzLmhhc2hUYWJsZVttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdW21vdmluZ0lkeF07DQogICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUudG8ucl1bbW92ZS50by5jXVttb3ZpbmdJZHhdOw0KICAgICAgICB9DQogICAgICAgIGlmIChjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZElkeCA9IHRoaXMucGllY2VJbmRleChjYXB0dXJlZFBpZWNlKTsNCiAgICAgICAgICAgIGlmIChjYXB0dXJlZElkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgbmV3SGFzaCBePSB0aGlzLmhhc2hUYWJsZVttb3ZlLnRvLnJdW21vdmUudG8uY11bY2FwdHVyZWRJZHhdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBuZXdIYXNoOw0KICAgIH0NCn0NCg0KLyoqDQogKiBPcGVuaW5nIEJvb2sgTWFuYWdlcg0KICovDQpjbGFzcyBPcGVuaW5nQm9vayB7DQogICAgYm9vazsgIC8vIFpvYnJpc3QgaGFzaCAtPiBtb3Zlcw0KICAgIGhhc2hlcjsNCiAgICBlbmFibGVkOw0KICAgIG1heFBseTsgIC8vIE1heGltdW0gcGx5IHRvIHVzZSBvcGVuaW5nIGJvb2sgKGUuZy4sIDIwKQ0KDQogICAgY29uc3RydWN0b3IobWF4UGx5ID0gMTIpIHsNCiAgICAgICAgdGhpcy5ib29rID0gbmV3IE1hcCgpOw0KICAgICAgICB0aGlzLmhhc2hlciA9IG5ldyBab2JyaXN0SGFzaGVyKCk7DQogICAgICAgIHRoaXMuZW5hYmxlZCA9IHRydWU7DQogICAgICAgIHRoaXMubWF4UGx5ID0gbWF4UGx5Ow0KICAgICAgICB0aGlzLmluaXRpYWxpemVCb29rKCk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogSW5pdGlhbGl6ZSB3aXRoIGNvbW1vbiBDaGluZXNlIENoZXNzIG9wZW5pbmdzDQogICAgICovDQogICAgaW5pdGlhbGl6ZUJvb2soKSB7DQogICAgICAgIC8vIEFkZCBjbGFzc2ljIENoaW5lc2UgQ2hlc3Mgb3BlbmluZ3MgbWFudWFsbHkNCiAgICAgICAgDQogICAgICAgIC8qDQogICAgICAgIC8vIDEuIOS4reeCrui/h+ays+i9puWvueWxj+mjjumprOW5s+eCruWvuei9piAoQ2VudHJhbCBDYW5ub24gdnMgU2NyZWVuIEhvcnNlcykNCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZShbDQogICAgICAgICAgICB7IGZyb206IHsgcjogNywgYzogNyB9LCB0bzogeyByOiA3LCBjOiA0IH0gfSwgIC8vIDEuIOeCruS6jOW5s+S6lA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDcgfSwgdG86IHsgcjogMiwgYzogNiB9IH0sICAvLyAxLi4uIOmprDjov5s3DQogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogNyB9LCB0bzogeyByOiA3LCBjOiA2IH0gfSwgIC8vIDIuIOmprOS6jOi/m+S4iQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDggfSwgdG86IHsgcjogMCwgYzogNyB9IH0sICAvLyAyLi4uIOi9pjnlubM4ICAgICAgICAgICANCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA4IH0sIHRvOiB7IHI6IDksIGM6IDcgfSB9LCAgLy8gMy4g6L2m5LiA5bmz5LqMDQogICAgICAgICAgICB7IGZyb206IHsgcjogMywgYzogNiB9LCB0bzogeyByOiA0LCBjOiA2IH0gfSwgIC8vIDMuLi4g5Y2SN+i/mzENCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA3IH0sIHRvOiB7IHI6IDMsIGM6IDcgfSB9LCAgLy8gNC4g6L2m5LqM6L+b5YWtDQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogMSB9LCB0bzogeyByOiAyLCBjOiAyIH0gfSwgIC8vIDQuLi4g6amsMui/mzMNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA2LCBjOiAyIH0sIHRvOiB7IHI6IDUsIGM6IDIgfSB9LCAgLy8gNS4g5YW15LiD6L+b5LiADQogICAgICAgICAgICB7IGZyb206IHsgcjogMiwgYzogNyB9LCB0bzogeyByOiAyLCBjOiA4IH0gfSwgIC8vIDUuLi4g54KuOOW5szkNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAzLCBjOiA3IH0sIHRvOiB7IHI6IDMsIGM6IDYgfSB9LCAgLy8gNi4g6L2m5LqM5bmz5LiJDQogICAgICAgICAgICB7IGZyb206IHsgcjogMiwgYzogOCB9LCB0bzogeyByOiAxLCBjOiA4IH0gfSwgIC8vIDYuLi4g54KuOemAgDEgICAgICAgICAgDQogICAgICAgIF0sIFs4NSwgODUsIDk1LCA5MCwgOTAsIDg1LCA4NSwgODAsIDg1LCA4NSwgODUsIDg1XSk7DQoNCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihbDQogICAgICAgICAgICAn54Ku5LqM5bmz5LqUJywgJ+mprDjov5s3JywgJ+mprOS6jOi/m+S4iScsICfovaY55bmzOCcsICfovabkuIDlubPkuownLCAn5Y2SN+i/mzEnLA0KICAgICAgICAgICAgJ+i9puS6jOi/m+WFrScsICfpqawy6L+bMycsICflhbXkuIPov5vkuIAnLCAn54KuOOW5szknLCAn6L2m5LqM5bmz5LiJJywgJ+eCrjnpgIAxJywNCiAgICAgICAgICAgIF0sIFs4NSwgODUsIDk1LCA5MCwgOTAsIDg1LCA4NSwgODAsIDg1LCA4NSwgODUsIDg1XSk7DQoNCiAgICAgICAgICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyhbDQogICAgICAgICAgICAn54Ku5LqM5bmz5LqUIOmprDjov5s3IOmprOS6jOi/m+S4iSDovaY55bmzOCDovabkuIDlubPkuowg5Y2SN+i/mzEg6L2m5LqM6L+b5YWtIOmprDLov5szIOWFteS4g+i/m+S4gCDngq445bmzOSDovabkuozlubPkuIkg54KuOemAgDEnDQogICAgICAgIF0sIFs4NSwgODUsIDk1LCA5MCwgOTAsIDg1LCA4NSwgODAsIDg1LCA4NSwgODUsIDg1XSk7DQogICAgICAgICovDQogICAgfQ0KDQogICAgLyoqDQogICAgICogQWRkIGFuIG9wZW5pbmcgbGluZSB0byB0aGUgYm9vaw0KICAgICAqIEBwYXJhbSBtb3ZlcyBBcnJheSBvZiBtb3ZlcyByZXByZXNlbnRpbmcgYW4gb3BlbmluZyBsaW5lDQogICAgICogQHBhcmFtIHdlaWdodHMgT3B0aW9uYWwgd2VpZ2h0cyBmb3IgZWFjaCBtb3ZlIChkZWZhdWx0IDEwMCBmb3IgYWxsKQ0KICAgICAqLw0KICAgIGFkZE9wZW5pbmdMaW5lKG1vdmVzLCB3ZWlnaHRzKSB7DQogICAgICAgIC8vIFN0YXJ0IHdpdGggaW5pdGlhbCBib2FyZCBwb3NpdGlvbg0KICAgICAgICBjb25zdCBib2FyZCA9IHRoaXMuY3JlYXRlSW5pdGlhbEJvYXJkKCk7DQogICAgICAgIGxldCBjdXJyZW50SGFzaCA9IHRoaXMuaGFzaGVyLmhhc2goYm9hcmQpOw0KDQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW92ZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpXTsNCiAgICAgICAgICAgIGNvbnN0IHdlaWdodCA9IHdlaWdodHM/LltpXSA/PyAxMDA7DQoNCiAgICAgICAgICAgIC8vIEdldCBvciBjcmVhdGUgYm9vayBlbnRyeSBmb3IgdGhpcyBwb3NpdGlvbg0KICAgICAgICAgICAgbGV0IGVudHJ5ID0gdGhpcy5ib29rLmdldChjdXJyZW50SGFzaCk7DQogICAgICAgICAgICBpZiAoIWVudHJ5KSB7DQogICAgICAgICAgICAgICAgZW50cnkgPSB7IG1vdmVzOiBbXSB9Ow0KICAgICAgICAgICAgICAgIHRoaXMuYm9vay5zZXQoY3VycmVudEhhc2gsIGVudHJ5KTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gQWRkIG1vdmUgaWYgbm90IGFscmVhZHkgcHJlc2VudA0KICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdNb3ZlID0gZW50cnkubW92ZXMuZmluZCgNCiAgICAgICAgICAgICAgICBtID0+IG0uZnJvbS5yID09PSBtb3ZlLmZyb20uciAmJiBtLmZyb20uYyA9PT0gbW92ZS5mcm9tLmMgJiYNCiAgICAgICAgICAgICAgICAgICAgIG0udG8uciA9PT0gbW92ZS50by5yICYmIG0udG8uYyA9PT0gbW92ZS50by5jDQogICAgICAgICAgICApOw0KDQogICAgICAgICAgICBpZiAoIWV4aXN0aW5nTW92ZSkgew0KICAgICAgICAgICAgICAgIGVudHJ5Lm1vdmVzLnB1c2goew0KICAgICAgICAgICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiBtb3ZlLmZyb20uYyB9LA0KICAgICAgICAgICAgICAgICAgICB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IG1vdmUudG8uYyB9LA0KICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHdlaWdodA0KICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgd2VpZ2h0IGlmIG1vdmUgYWxyZWFkeSBleGlzdHMgKHRha2UgbWF4aW11bSkNCiAgICAgICAgICAgICAgICBleGlzdGluZ01vdmUud2VpZ2h0ID0gTWF0aC5tYXgoZXhpc3RpbmdNb3ZlLndlaWdodCwgd2VpZ2h0KTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gTWFrZSB0aGUgbW92ZSBvbiB0aGUgYm9hcmQNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkID0gYm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoIXBpZWNlKSBicmVhazsgLy8gSW52YWxpZCBsaW5lDQoNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlS2V5ID0gYCR7cGllY2UuY29sb3J9LSR7cGllY2UudHlwZX1gOw0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBjYXB0dXJlZCA/IGAke2NhcHR1cmVkLmNvbG9yfS0ke2NhcHR1cmVkLnR5cGV9YCA6IHVuZGVmaW5lZDsNCg0KICAgICAgICAgICAgLy8gVXBkYXRlIGhhc2ggaW5jcmVtZW50YWxseQ0KICAgICAgICAgICAgY3VycmVudEhhc2ggPSB0aGlzLmhhc2hlci51cGRhdGVIYXNoKGN1cnJlbnRIYXNoLCBtb3ZlLCBwaWVjZUtleSwgY2FwdHVyZWRLZXkpOw0KDQogICAgICAgICAgICAvLyBBcHBseSBtb3ZlDQogICAgICAgICAgICBib2FyZFttb3ZlLnRvLnJdW21vdmUudG8uY10gPSBwaWVjZTsNCiAgICAgICAgICAgIGJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY10gPSBudWxsOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLyoqDQogICAgICogR2V0IGJlc3QgbW92ZSBmcm9tIG9wZW5pbmcgYm9vayBmb3IgY3VycmVudCBwb3NpdGlvbg0KICAgICAqIEBwYXJhbSBib2FyZCBDdXJyZW50IGJvYXJkIHN0YXRlDQogICAgICogQHBhcmFtIHBseSBDdXJyZW50IHBseSBudW1iZXIgKDAgPSBzdGFydCBvZiBnYW1lKQ0KICAgICAqIEByZXR1cm5zIE1vdmUgZnJvbSBib29rLCBvciBudWxsIGlmIHBvc2l0aW9uIG5vdCBpbiBib29rDQogICAgICovDQogICAgZ2V0Qm9va01vdmUoYm9hcmQsIHBseSl7DQogICAgICAgIC8vIERvbid0IHVzZSBib29rIGlmIGRpc2FibGVkIG9yIHBhc3QgbWF4IHBseQ0KICAgICAgICBpZiAoIXRoaXMuZW5hYmxlZCB8fCBwbHkgPj0gdGhpcy5tYXhQbHkpIHsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgZGlzYWJsZWQgb3IgcGFzdCBtYXggcGx5JywgeyBlbmFibGVkOiB0aGlzLmVuYWJsZWQsIG1heFBseTogdGhpcy5tYXhQbHksIHBseTogcGx5IH0pOw0KICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBnZXRCb29rTW92ZSBjYWxsZWQnLCB7IHBseSB9KTsNCiAgICAgICAgDQogICAgICAgIC8vIFRyeSB0byBmaW5kIG1vdmUgZm9yIGN1cnJlbnQgcG9zaXRpb24NCiAgICAgICAgY29uc3QgaGFzaCA9IHRoaXMuaGFzaGVyLmhhc2goYm9hcmQpOw0KICAgICAgICAvL2NvbnNvbGUubG9nKCdDdXJyZW50IHBvc2l0aW9uIGhhc2g6JywgaGFzaCk7DQogICAgICAgIA0KICAgICAgICBsZXQgZW50cnkgPSB0aGlzLmJvb2suZ2V0KGhhc2gpOw0KICAgICAgICAvL2NvbnNvbGUubG9nKCdFbnRyeSBmb3VuZCBmb3IgY3VycmVudCBoYXNoOicsIGVudHJ5ID8gZW50cnkubW92ZXMubGVuZ3RoICsgJyBtb3ZlcycgOiAnbnVsbCcpOw0KICAgICAgICBpZiAoZW50cnkgJiYgZW50cnkubW92ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgY29uc29sZS5sb2coJ0FsbCBwb3NzaWJsZSBib29rIG1vdmVzIHdpdGggd2VpZ2h0czonLCBKU09OLnN0cmluZ2lmeShlbnRyeS5tb3ZlcykpOw0KICAgICAgICAgICAgLy8gQ2FsY3VsYXRlIHRvdGFsIHdlaWdodA0KICAgICAgICAgICAgY29uc3QgdG90YWxXZWlnaHQgPSBlbnRyeS5tb3Zlcy5yZWR1Y2UoKHN1bSwgbW92ZSkgPT4gc3VtICsgbW92ZS53ZWlnaHQsIDApOw0KICAgICAgICAgICAgY29uc29sZS5sb2coJ1RvdGFsIHdlaWdodDonLCB0b3RhbFdlaWdodCk7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIGxldCBtaXJyb3JlZE1vdmUgPSBmYWxzZTsNCg0KICAgICAgICAvLyBJZiBub3QgZm91bmQsIHRyeSBtaXJyb3JlZCBwb3NpdGlvbg0KICAgICAgICBpZiAoIWVudHJ5IHx8IGVudHJ5Lm1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgY29uc3QgbWlycm9yZWRCb2FyZCA9IHRoaXMuaGFzaGVyLm1pcnJvckJvYXJkKGJvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IG1pcnJvcmVkSGFzaCA9IHRoaXMuaGFzaGVyLmhhc2gobWlycm9yZWRCb2FyZCk7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gZW50cnkgZm91bmQsIHRyeWluZyBtaXJyb3JlZCBwb3NpdGlvbjonLCBtaXJyb3JlZEhhc2gpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBlbnRyeSA9IHRoaXMuYm9vay5nZXQobWlycm9yZWRIYXNoKTsNCiAgICAgICAgICAgIGlmIChlbnRyeSAmJiBlbnRyeS5tb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnRW50cnkgZm91bmQgZm9yIG1pcnJvcmVkIGhhc2g6JywgZW50cnkubW92ZXMubGVuZ3RoICsgJyBtb3ZlcycpOw0KICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ09yaWdpbmFsIG1pcnJvciBtb3ZlczonLCBKU09OLnN0cmluZ2lmeShlbnRyeS5tb3ZlcykpOw0KICAgICAgICAgICAgICAgIG1pcnJvcmVkTW92ZSA9IHRydWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ05vIGVudHJ5IGZvdW5kIGZvciBtaXJyb3JlZCBoYXNoJyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICBpZiAoIWVudHJ5IHx8IGVudHJ5Lm1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnT3BlbmluZyBib29rIG1vdmUgbm90IGZvdW5kIGZvciBjdXJyZW50IHBvc2l0aW9uJyk7DQogICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgfQ0KDQogICAgICAgIC8vIFNlbGVjdCBtb3ZlIGJhc2VkIG9uIHdlaWdodHMNCiAgICAgICAgY29uc3Qgc2VsZWN0ZWRNb3ZlID0gdGhpcy5zZWxlY3RXZWlnaHRlZE1vdmUoZW50cnkubW92ZXMpOw0KICAgICAgICBjb25zb2xlLmxvZygnT3BlbmluZyBib29rIG1vdmUgc2VsZWN0ZWQ6Jywgc2VsZWN0ZWRNb3ZlKTsNCiAgICAgICAgDQogICAgICAgIC8vIElmIHdlIHVzZWQgbWlycm9yZWQgcG9zaXRpb24sIG1pcnJvciB0aGUgbW92ZSBiYWNrDQogICAgICAgIGlmIChzZWxlY3RlZE1vdmUgJiYgbWlycm9yZWRNb3ZlKSB7DQogICAgICAgICAgICAvLyBjb25zb2xlLmxvZygnU2VsZWN0ZWQgbWlycm9yIG1vdmUgYmVmb3JlIGNvbnZlcnNpb246JywgSlNPTi5zdHJpbmdpZnkoc2VsZWN0ZWRNb3ZlKSk7DQogICAgICAgICAgICBjb25zdCBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQgPSB0aGlzLmhhc2hlci5taXJyb3JNb3ZlKHNlbGVjdGVkTW92ZSk7DQogICAgICAgICAgICAvLyBjb25zb2xlLmxvZygnQ29udmVydGVkIG1pcnJvciBtb3ZlOicsIEpTT04uc3RyaW5naWZ5KG1pcnJvcmVkTW92ZUNvbnZlcnRlZCkpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgbWlycm9yZWQgbW92ZSBoYXMgdmFsaWQgc3RydWN0dXJlDQogICAgICAgICAgICBpZiAobWlycm9yZWRNb3ZlQ29udmVydGVkICYmIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tICYmIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50byAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20uYyA9PT0gJ251bWJlcicgJiYNCiAgICAgICAgICAgICAgICB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQudG8uYyA9PT0gJ251bWJlcicpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gbWlycm9yZWRNb3ZlQ29udmVydGVkOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTWlycm9yZWQgbW92ZSBoYXMgaW52YWxpZCBzdHJ1Y3R1cmUsIHJldHVybmluZyBudWxsJyk7DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoc2VsZWN0ZWRNb3ZlKSB7DQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgc2VsZWN0ZWQgbW92ZSBoYXMgdmFsaWQgc3RydWN0dXJlDQogICAgICAgICAgICBpZiAoc2VsZWN0ZWRNb3ZlLmZyb20gJiYgc2VsZWN0ZWRNb3ZlLnRvICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIHNlbGVjdGVkTW92ZS5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBzZWxlY3RlZE1vdmUuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBzZWxlY3RlZE1vdmUudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIHNlbGVjdGVkTW92ZS50by5jID09PSAnbnVtYmVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiBzZWxlY3RlZE1vdmU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZWxlY3RlZCBtb3ZlIGhhcyBpbnZhbGlkIHN0cnVjdHVyZSwgcmV0dXJuaW5nIG51bGwnKTsNCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgcmV0dXJuIG51bGw7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogU2VsZWN0IGEgbW92ZSByYW5kb21seSBiYXNlZCBvbiB3ZWlnaHRzDQogICAgICogSGlnaGVyIHdlaWdodCA9IG1vcmUgbGlrZWx5IHRvIGJlIHNlbGVjdGVkDQogICAgICovDQogICAgc2VsZWN0V2VpZ2h0ZWRNb3ZlKG1vdmVzKSB7DQogICAgICAgIC8vIENhbGN1bGF0ZSB0b3RhbCB3ZWlnaHQNCiAgICAgICAgY29uc3QgdG90YWxXZWlnaHQgPSBtb3Zlcy5yZWR1Y2UoKHN1bSwgbW92ZSkgPT4gc3VtICsgbW92ZS53ZWlnaHQsIDApOw0KDQogICAgICAgIC8vIEdlbmVyYXRlIHJhbmRvbSBudW1iZXINCiAgICAgICAgbGV0IHJhbmRvbSA9IE1hdGgucmFuZG9tKCkgKiB0b3RhbFdlaWdodDsNCg0KICAgICAgICAvLyBTZWxlY3QgbW92ZQ0KICAgICAgICBmb3IgKGNvbnN0IG1vdmUgb2YgbW92ZXMpIHsNCiAgICAgICAgICAgIHJhbmRvbSAtPSBtb3ZlLndlaWdodDsNCiAgICAgICAgICAgIGlmIChyYW5kb20gPD0gMCkgew0KICAgICAgICAgICAgICAgIHJldHVybiB7DQogICAgICAgICAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmUudG8uciwgYzogbW92ZS50by5jIH0NCiAgICAgICAgICAgICAgICB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgLy8gRmFsbGJhY2sgKHNob3VsZCBuZXZlciByZWFjaCBoZXJlKQ0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgZnJvbTogeyByOiBtb3Zlc1swXS5mcm9tLnIsIGM6IG1vdmVzWzBdLmZyb20uYyB9LCB0bzogeyByOiBtb3Zlc1swXS50by5yLCBjOiBtb3Zlc1swXS50by5jIH0NCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBIZWxwZXIgdG8gY3JlYXRlIGluaXRpYWwgYm9hcmQgKG5lZWRlZCBmb3IgYm9vayBpbml0aWFsaXphdGlvbikNCiAgICAgKi8NCiAgICBjcmVhdGVJbml0aWFsQm9hcmQoKSB7DQogICAgICAgIGNvbnN0IGJvYXJkID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkpOw0KICAgICAgICANCiAgICAgICAgLy8gUmVkIHBpZWNlcyAoYm90dG9tIC0gcj0wLTIpDQogICAgICAgIGJvYXJkWzBdWzBdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVsxXSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzJdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bM10gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzRdID0geyB0eXBlOiAnZ2VuZXJhbCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs1XSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bNl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs3XSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzhdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFsyXVsxXSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFsyXVs3XSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVswXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bMl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzRdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVs2XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bOF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQoNCiAgICAgICAgLy8gQmxhY2sgcGllY2VzICh0b3AgLSByPTctOSkNCiAgICAgICAgYm9hcmRbOV1bMF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bMV0gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzJdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVszXSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs0XSA9IHsgdHlwZTogJ2dlbmVyYWwnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs1XSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs2XSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bN10gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzhdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzddWzFdID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbN11bN10gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVswXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVsyXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVs0XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVs2XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVs4XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KDQogICAgICAgIHJldHVybiBib2FyZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBFbmFibGUgb3IgZGlzYWJsZSBvcGVuaW5nIGJvb2sNCiAgICAgKi8NCiAgICBzZXRFbmFibGVkKGVuYWJsZWQpIHsNCiAgICAgICAgdGhpcy5lbmFibGVkID0gZW5hYmxlZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDaGVjayBpZiBvcGVuaW5nIGJvb2sgaXMgZW5hYmxlZA0KICAgICAqLw0KICAgIGlzRW5hYmxlZCgpIHsNCiAgICAgICAgcmV0dXJuIHRoaXMuZW5hYmxlZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBHZXQgc3RhdGlzdGljcyBhYm91dCB0aGUgb3BlbmluZyBib29rDQogICAgICovDQogICAgZ2V0U3RhdHMoKSB7DQogICAgICAgIGxldCB0b3RhbE1vdmVzID0gMDsNCiAgICAgICAgdGhpcy5ib29rLmZvckVhY2goZW50cnkgPT4gew0KICAgICAgICAgICAgdG90YWxNb3ZlcyArPSBlbnRyeS5tb3Zlcy5sZW5ndGg7DQogICAgICAgIH0pOw0KDQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICBwb3NpdGlvbnM6IHRoaXMuYm9vay5zaXplLA0KICAgICAgICAgICAgdG90YWxNb3Zlcw0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEFkZCBvcGVuaW5nIGxpbmUgZnJvbSB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uDQogICAgICogQHBhcmFtIG5vdGF0aW9uIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbiAoZS5nLiwgWyfngq7kuozlubPkupQnLCAn6amsOOi/mzcnXSkNCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCBhcnJheSBvZiB3ZWlnaHRzIGZvciBlYWNoIG1vdmUNCiAgICAgKi8NCiAgICBhZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihub3RhdGlvbiwgd2VpZ2h0cykgew0KICAgICAgICAvLyBDb252ZXJ0IHRyYWRpdGlvbmFsIG5vdGF0aW9uIHRvIGNvb3JkaW5hdGUgZm9ybWF0DQogICAgICAgIGNvbnN0IG1vdmVzID0gdGhpcy5ub3RhdGlvblRvTW92ZXMobm90YXRpb24pOw0KICAgICAgICAvLyBBZGQgdGhlIG1vdmVzIHRvIHRoZSBvcGVuaW5nIGJvb2sNCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZShtb3Zlcywgd2VpZ2h0cyk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQWRkIG9wZW5pbmcgbGluZSBmcm9tIHN0cmluZyB3aXRoIHNwYWNlLXNlcGFyYXRlZCB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uDQogICAgICogQHBhcmFtIG5vdGF0aW9uQXJyYXkgQXJyYXkgb2Ygc3RyaW5ncywgZWFjaCBjb250YWluaW5nIHNwYWNlLXNlcGFyYXRlZCBtb3ZlcyAoZS5nLiwgWyfngq7kuozlubPkupQg6amsOOi/mzcg6L2m5LiA5bmz5LqMJ10pDQogICAgICogQHBhcmFtIHdlaWdodHMgT3B0aW9uYWwgYXJyYXkgb2Ygd2VpZ2h0cyBmb3IgZWFjaCBtb3ZlDQogICAgICovDQogICAgYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKG5vdGF0aW9uQXJyYXksIHdlaWdodHMpIHsNCiAgICAgICAgLy8gUHJvY2VzcyBlYWNoIHN0cmluZyBpbiB0aGUgYXJyYXkNCiAgICAgICAgaWYgKCFub3RhdGlvbkFycmF5IHx8ICFBcnJheS5pc0FycmF5KG5vdGF0aW9uQXJyYXkpIHx8IG5vdGF0aW9uQXJyYXkubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICByZXR1cm47DQogICAgICAgIH0NCiAgICAgICAgbm90YXRpb25BcnJheS5mb3JFYWNoKG5vdGF0aW9uU3RyaW5nID0+IHsNCiAgICAgICAgICAgIC8vIFNwbGl0IHRoZSBzdHJpbmcgYnkgc3BhY2VzIHRvIGdldCBpbmRpdmlkdWFsIG1vdmVzDQogICAgICAgICAgICBjb25zdCBub3RhdGlvbiA9IG5vdGF0aW9uU3RyaW5nLnNwbGl0KCcgJykuZmlsdGVyKG1vdmUgPT4gbW92ZS50cmltKCkgIT09ICcnKTsNCiAgICAgICAgICAgIC8vIENhbGwgZXhpc3RpbmcgZnVuY3Rpb24gdG8gYWRkIHRoZSBsaW5lDQogICAgICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKG5vdGF0aW9uLCB3ZWlnaHRzKTsNCiAgICAgICAgfSk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQ29udmVydCBjb29yZGluYXRlLWJhc2VkIG1vdmVzIHRvIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24NCiAgICAgKiBAcGFyYW0gYm9hcmRIaXN0b3J5IEFycmF5IG9mIGJvYXJkIHN0YXRlcyByZXByZXNlbnRpbmcgdGhlIGdhbWUgaGlzdG9yeQ0KICAgICAqIEBwYXJhbSBtb3ZlSGlzdG9yeSBBcnJheSBvZiBtb3ZlcyBpbiBjb29yZGluYXRlIGZvcm1hdA0KICAgICAqIEByZXR1cm5zIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbg0KICAgICAqLw0KICAgIG1vdmVzVG9Ob3RhdGlvbihib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5KSB7DQogICAgICAgIGNvbnN0IG5vdGF0aW9uID0gW107DQogICAgICAgIGxldCBjdXJyZW50Q29sb3IgPSAncmVkJzsgLy8gUmVkIG1vdmVzIGZpcnN0DQoNCiAgICAgICAgLy8gVHlwZSB0byBwaWVjZSBjaGFyYWN0ZXIgbWFwcGluZw0KICAgICAgICBjb25zdCB0eXBlVG9QaWVjZSA9IHsNCiAgICAgICAgICAgICdnZW5lcmFsJzogeyAncmVkJzogJ+W4hScsICdibGFjayc6ICflsIYnIH0sDQogICAgICAgICAgICAnYWR2aXNvcic6IHsgJ3JlZCc6ICfku5UnLCAnYmxhY2snOiAn5aOrJyB9LA0KICAgICAgICAgICAgJ2VsZXBoYW50JzogeyAncmVkJzogJ+ebuCcsICdibGFjayc6ICfosaEnIH0sDQogICAgICAgICAgICAnaG9yc2UnOiB7ICdyZWQnOiAn6amsJywgJ2JsYWNrJzogJ+mprCcgfSwNCiAgICAgICAgICAgICdjaGFyaW90JzogeyAncmVkJzogJ+i9picsICdibGFjayc6ICfovaYnIH0sDQogICAgICAgICAgICAnY2Fubm9uJzogeyAncmVkJzogJ+eCricsICdibGFjayc6ICfngq4nIH0sDQogICAgICAgICAgICAnc29sZGllcic6IHsgJ3JlZCc6ICflhbUnLCAnYmxhY2snOiAn5Y2SJyB9DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ29sdW1uIG1hcHBpbmcgKGNvb3JkaW5hdGUgMC04IHRvIHRyYWRpdGlvbmFsIOS5nS3kuIAgZm9yIHJlZCwgOS0xIGZvciBibGFjaykNCiAgICAgICAgY29uc3QgY29sVG9DaGluZXNlID0gWyfkuZ0nLCAn5YWrJywgJ+S4gycsICflha0nLCAn5LqUJywgJ+WbmycsICfkuIknLCAn5LqMJywgJ+S4gCddOw0KICAgICAgICBjb25zdCBjb2xUb0FyYWJpYyA9IFsnOScsICc4JywgJzcnLCAnNicsICc1JywgJzQnLCAnMycsICcyJywgJzEnXTsNCg0KICAgICAgICAvLyBEaWdpdCB0byBDaGluZXNlIG51bWJlciBtYXBwaW5nIGZvciBzdGVwcw0KICAgICAgICBjb25zdCBkaWdpdFRvQ2hpbmVzZSA9IFsnJywgJ+S4gCcsICfkuownLCAn5LiJJywgJ+WbmycsICfkupQnLCAn5YWtJywgJ+S4gycsICflhasnLCAn5LmdJ107DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIHRoZXJlIGFyZSBtdWx0aXBsZSBzYW1lLXR5cGUgcGllY2VzIGluIHRoZSBzYW1lIGNvbHVtbg0KICAgICAgICBjb25zdCBoYXNTYW1lVHlwZUluQ29sdW1uID0gKGJvYXJkLCBwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGV4Y2x1ZGVSb3cpID0+IHsNCiAgICAgICAgICAgIGxldCBjb3VudCA9IDA7DQogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NvbF07DQogICAgICAgICAgICAgICAgaWYgKHIgPT09IGV4Y2x1ZGVSb3cpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSBwaWVjZVR5cGUgJiYgcGllY2UuY29sb3IgPT09IGNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgIGNvdW50Kys7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgcmV0dXJuIGNvdW50ID4gMDsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZGV0ZXJtaW5lIGZyb250L2JhY2sgbWFya2VyDQogICAgICAgIGNvbnN0IGdldEZyb250QmFja01hcmtlciA9IChib2FyZCwgcGllY2VUeXBlLCBjb2xvciwgY29sLCBjdXJyZW50Um93KSA9PiB7DQogICAgICAgICAgICBjb25zdCBzYW1lVHlwZVBpZWNlcyA9IFtdOw0KICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjb2xdOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSBwaWVjZVR5cGUgJiYgcGllY2UuY29sb3IgPT09IGNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgIHNhbWVUeXBlUGllY2VzLnB1c2gocik7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHNhbWVUeXBlUGllY2VzLmxlbmd0aCA8PSAxKSByZXR1cm4gJyc7DQogICAgICAgICAgICBpZiAoY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yIcj03LTnvvInvvIxy5YC86LaK5aSn6LaK6Z2g6L+R5pWM5pa577yM5pivIuWJjSINCiAgICAgICAgICAgICAgICBjb25zdCBzb3J0ZWRSb3dzID0gWy4uLnNhbWVUeXBlUGllY2VzXS5zb3J0KChhLCBiKSA9PiBiIC0gYSk7IC8vIEhpZ2hlciByb3dzIGZpcnN0ID0gY2xvc2VyIHRvIG9wcG9uZW50DQogICAgICAgICAgICAgICAgcmV0dXJuIHNvcnRlZFJvd3NbMF0gPT09IGN1cnJlbnRSb3cgPyAn5YmNJyA6ICflkI4nOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIhyPTAtMu+8ie+8jHLlgLzotorlsI/otorpnaDov5HmlYzmlrnvvIzmmK8i5YmNIg0KICAgICAgICAgICAgICAgIGNvbnN0IHNvcnRlZFJvd3MgPSBbLi4uc2FtZVR5cGVQaWVjZXNdLnNvcnQoKGEsIGIpID0+IGEgLSBiKTsgLy8gTG93ZXIgcm93cyBmaXJzdCA9IGNsb3NlciB0byBvcHBvbmVudA0KICAgICAgICAgICAgICAgIHJldHVybiBzb3J0ZWRSb3dzWzBdID09PSBjdXJyZW50Um93ID8gJ+WJjScgOiAn5ZCOJzsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBQcm9jZXNzIGVhY2ggbW92ZQ0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1vdmVIaXN0b3J5Lmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBtb3ZlID0gbW92ZUhpc3RvcnlbaV07DQogICAgICAgICAgICBjb25zdCBib2FyZEJlZm9yZSA9IGJvYXJkSGlzdG9yeVtpXTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRCZWZvcmVbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFwaWVjZSkgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIHBpZWNlIGZvdW5kIGF0IGZyb20gcG9zaXRpb246JywgbW92ZS5mcm9tKTsNCiAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2UudHlwZTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlQ2hhciA9IHR5cGVUb1BpZWNlW3BpZWNlVHlwZV1bcGllY2UuY29sb3JdOw0KICAgICAgICAgICAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlIGFyZSBtdWx0aXBsZSBzYW1lLXR5cGUgcGllY2VzIGluIHRoZSBzYW1lIGNvbHVtbg0KICAgICAgICAgICAgY29uc3QgaGFzRHVwbGljYXRlID0gaGFzU2FtZVR5cGVJbkNvbHVtbihib2FyZEJlZm9yZSwgcGllY2VUeXBlLCBwaWVjZS5jb2xvciwgbW92ZS5mcm9tLmMsIG1vdmUuZnJvbS5yKTsNCiAgICAgICAgICAgIC8vIEdldCBmcm9udC9iYWNrIG1hcmtlciBpZiBuZWVkZWQNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uTWFya2VyID0gaGFzRHVwbGljYXRlID8gZ2V0RnJvbnRCYWNrTWFya2VyKGJvYXJkQmVmb3JlLCBwaWVjZVR5cGUsIHBpZWNlLmNvbG9yLCBtb3ZlLmZyb20uYywgbW92ZS5mcm9tLnIpIDogJyc7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIERldGVybWluZSBub3RhdGlvbiBiYXNlZCBvbiBwaWVjZSB0eXBlIGFuZCBtb3ZlIGRpcmVjdGlvbg0KICAgICAgICAgICAgbGV0IG5vdGF0aW9uU3RyOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnaG9yc2UnIHx8IHBpZWNlVHlwZSA9PT0gJ2Fkdmlzb3InIHx8IHBpZWNlVHlwZSA9PT0gJ2VsZXBoYW50Jykgew0KICAgICAgICAgICAgICAgIC8vIERpYWdvbmFsIG1vdmluZyBwaWVjZXMgLSBvbmx5IHVzZSDov5sv6YCALCByZWNvcmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+i/m++8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gbW92ZS50by5yID4gbW92ZS5mcm9tLnIgPyAn6L+bJyA6ICfpgIAnOw0KICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCEDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIhyPTDvvInvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6L+b77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSBtb3ZlLnRvLnIgPCBtb3ZlLmZyb20uciA/ICfov5snIDogJ+mAgCc7DQogICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnIHx8IHBpZWNlVHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHBpZWNlVHlwZSA9PT0gJ2Nhbm5vbicgfHwgcGllY2VUeXBlID09PSAnc29sZGllcicpIHsNCiAgICAgICAgICAgICAgICAvLyBTdHJhaWdodCBtb3ZpbmcgcGllY2VzIC0g6L+bL+mAgC/lubMNCiAgICAgICAgICAgICAgICBpZiAobW92ZS5mcm9tLmMgPT09IG1vdmUudG8uYykgew0KICAgICAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBtb3ZlIC0g6L+bL+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGVwcyA9IE1hdGguYWJzKG1vdmUudG8uciAtIG1vdmUuZnJvbS5yKTsNCiAgICAgICAgICAgICAgICAgICAgLy8g6L+b5piv6Z2g6L+R5pWM5pa555qE5pa55ZCR77yM6YCA5piv6L+c56a75pWM5pa555qE5pa55ZCRDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/ov5vvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/ov5vvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IChpc1JlZCA/IG1vdmUudG8uciA+IG1vdmUuZnJvbS5yIDogbW92ZS50by5yIDwgbW92ZS5mcm9tLnIpID8gJ+i/mycgOiAn6YCAJzsNCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY107DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgc3RlcHMgaXMgYSB2YWxpZCBudW1iZXIgYmV0d2VlbiAxLTkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkU3RlcHMgPSBNYXRoLm1heCgxLCBNYXRoLm1pbig5LCBNYXRoLnJvdW5kKHN0ZXBzIHx8IDEpKSk7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke2RpZ2l0VG9DaGluZXNlW3ZhbGlkU3RlcHNdIHx8ICcnfWA7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnku47lj7PlvoDlt6bmmK8xLTnvvIzpnIDopoHlj43ovazliJfmmKDlsIQNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHN0ZXBzIGlzIGEgdmFsaWQgbnVtYmVyDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWxpZFN0ZXBzID0gTWF0aC5yb3VuZChzdGVwcyB8fCAxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dmFsaWRTdGVwc31gOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBtb3ZlIC0g5bmzDQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x95bmzJHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCEDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH3lubMke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1Vua25vd24gcGllY2UgdHlwZTonLCBwaWVjZVR5cGUpOw0KICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICBub3RhdGlvbi5wdXNoKG5vdGF0aW9uU3RyKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gU3dpdGNoIGNvbG9yIGZvciBuZXh0IG1vdmUNCiAgICAgICAgICAgIGN1cnJlbnRDb2xvciA9IGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIHJldHVybiBub3RhdGlvbjsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDb252ZXJ0IHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24gdG8gY29vcmRpbmF0ZSBtb3Zlcw0KICAgICAqIEBwYXJhbSBub3RhdGlvbiBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24NCiAgICAgKiBAcmV0dXJucyBBcnJheSBvZiBtb3ZlcyBpbiBjb29yZGluYXRlIGZvcm1hdA0KICAgICAqLw0KICAgIG5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvbiwgaW5pdGlhbEJvYXJkID0gbnVsbCkgew0KICAgICAgICAvLyDnoa7kv51ub3RhdGlvbuaYr+aVsOe7hOS4lOS4jeS4uuepug0KICAgICAgICBpZiAoIW5vdGF0aW9uIHx8ICFBcnJheS5pc0FycmF5KG5vdGF0aW9uKSB8fCBub3RhdGlvbi5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIHJldHVybiBbXTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICBsZXQgY3VycmVudENvbG9yID0gJ3JlZCc7IC8vIFJlZCBtb3ZlcyBmaXJzdA0KDQogICAgICAgIC8vIFBpZWNlIGNoYXJhY3RlciB0byB0eXBlIG1hcHBpbmcNCiAgICAgICAgY29uc3QgcGllY2VNYXAgPSB7DQogICAgICAgICAgICAn5bCGJzogJ2dlbmVyYWwnLCAn5biFJzogJ2dlbmVyYWwnLA0KICAgICAgICAgICAgJ+Wjqyc6ICdhZHZpc29yJywgJ+S7lSc6ICdhZHZpc29yJywNCiAgICAgICAgICAgICfosaEnOiAnZWxlcGhhbnQnLCAn55u4JzogJ2VsZXBoYW50JywNCiAgICAgICAgICAgICfpqawnOiAnaG9yc2UnLA0KICAgICAgICAgICAgJ+i9pic6ICdjaGFyaW90JywNCiAgICAgICAgICAgICfngq4nOiAnY2Fubm9uJywNCiAgICAgICAgICAgICfljZInOiAnc29sZGllcicsICflhbUnOiAnc29sZGllcicNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDb2x1bW4gbWFwcGluZyAodHJhZGl0aW9uYWwgbm90YXRpb24gdXNlcyAxLTkgZnJvbSByaWdodCB0byBsZWZ0KQ0KICAgICAgICBjb25zdCBjb2xNYXAgPSB7DQogICAgICAgICAgICAn5LiAJzogOCwgJzEnOiA4LA0KICAgICAgICAgICAgJ+S6jCc6IDcsICcyJzogNywNCiAgICAgICAgICAgICfkuIknOiA2LCAnMyc6IDYsDQogICAgICAgICAgICAn5ZubJzogNSwgJzQnOiA1LA0KICAgICAgICAgICAgJ+S6lCc6IDQsICc1JzogNCwNCiAgICAgICAgICAgICflha0nOiAzLCAnNic6IDMsDQogICAgICAgICAgICAn5LiDJzogMiwgJzcnOiAyLA0KICAgICAgICAgICAgJ+WFqyc6IDEsICc4JzogMSwNCiAgICAgICAgICAgICfkuZ0nOiAwLCAnOSc6IDANCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDaGluZXNlIG51bWJlciB0byBkaWdpdCBtYXBwaW5nDQogICAgICAgIGNvbnN0IGNoaW5lc2VOdW1iZXJNYXAgPSB7DQogICAgICAgICAgICAn5LiAJzogMSwgJzEnOiAxLA0KICAgICAgICAgICAgJ+S6jCc6IDIsICcyJzogMiwNCiAgICAgICAgICAgICfkuIknOiAzLCAnMyc6IDMsDQogICAgICAgICAgICAn5ZubJzogNCwgJzQnOiA0LA0KICAgICAgICAgICAgJ+S6lCc6IDUsICc1JzogNSwNCiAgICAgICAgICAgICflha0nOiA2LCAnNic6IDYsDQogICAgICAgICAgICAn5LiDJzogNywgJzcnOiA3LA0KICAgICAgICAgICAgJ+WFqyc6IDgsICc4JzogOCwNCiAgICAgICAgICAgICfkuZ0nOiA5LCAnOSc6IDkNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBJbml0aWFsIHBvc2l0aW9ucyBvZiBwaWVjZXMgKHJlZCBhbmQgYmxhY2spDQogICAgICAgIC8vIOS/ruWkje+8muS4juaWsOWdkOagh+ezu+e7n+S/neaMgeS4gOiHtO+8jOe6ouaWueWcqOW6lemDqO+8iHI9MC0y77yJ77yM6buR5pa55Zyo6aG26YOo77yIcj03LTnvvIkNCiAgICAgICAgY29uc3QgZGVmYXVsdEluaXRpYWxQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAncmVkLWdlbmVyYWwnOiB7IHI6IDAsIGM6IDQgfSwNCiAgICAgICAgICAgICdyZWQtYWR2aXNvcic6IFt7IHI6IDAsIGM6IDMgfSwgeyByOiAwLCBjOiA1IH1dLA0KICAgICAgICAgICAgJ3JlZC1lbGVwaGFudCc6IFt7IHI6IDAsIGM6IDIgfSwgeyByOiAwLCBjOiA2IH1dLA0KICAgICAgICAgICAgJ3JlZC1ob3JzZSc6IFt7IHI6IDAsIGM6IDEgfSwgeyByOiAwLCBjOiA3IH1dLA0KICAgICAgICAgICAgJ3JlZC1jaGFyaW90JzogW3sgcjogMCwgYzogMCB9LCB7IHI6IDAsIGM6IDggfV0sDQogICAgICAgICAgICAncmVkLWNhbm5vbic6IFt7IHI6IDIsIGM6IDEgfSwgeyByOiAyLCBjOiA3IH1dLA0KICAgICAgICAgICAgJ3JlZC1zb2xkaWVyJzogW3sgcjogMywgYzogMCB9LCB7IHI6IDMsIGM6IDIgfSwgeyByOiAzLCBjOiA0IH0sIHsgcjogMywgYzogNiB9LCB7IHI6IDMsIGM6IDggfV0sDQogICAgICAgICAgICAnYmxhY2stZ2VuZXJhbCc6IHsgcjogOSwgYzogNCB9LA0KICAgICAgICAgICAgJ2JsYWNrLWFkdmlzb3InOiBbeyByOiA5LCBjOiAzIH0sIHsgcjogOSwgYzogNSB9XSwNCiAgICAgICAgICAgICdibGFjay1lbGVwaGFudCc6IFt7IHI6IDksIGM6IDIgfSwgeyByOiA5LCBjOiA2IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWhvcnNlJzogW3sgcjogOSwgYzogMSB9LCB7IHI6IDksIGM6IDcgfV0sDQogICAgICAgICAgICAnYmxhY2stY2hhcmlvdCc6IFt7IHI6IDksIGM6IDAgfSwgeyByOiA5LCBjOiA4IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWNhbm5vbic6IFt7IHI6IDcsIGM6IDEgfSwgeyByOiA3LCBjOiA3IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLXNvbGRpZXInOiBbeyByOiA2LCBjOiAwIH0sIHsgcjogNiwgYzogMiB9LCB7IHI6IDYsIGM6IDQgfSwgeyByOiA2LCBjOiA2IH0sIHsgcjogNiwgYzogOCB9XQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIFRyYWNrIHBpZWNlIHBvc2l0aW9ucyBhcyBtb3ZlcyBhcmUgbWFkZQ0KICAgICAgICBsZXQgcGllY2VQb3NpdGlvbnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGRlZmF1bHRJbml0aWFsUG9zaXRpb25zKSk7DQogICAgICAgIA0KICAgICAgICAvLyBJZiBpbml0aWFsIGJvYXJkIGlzIHByb3ZpZGVkLCBpbml0aWFsaXplIHBpZWNlIHBvc2l0aW9ucyBmcm9tIGl0DQogICAgICAgIGlmIChpbml0aWFsQm9hcmQpIHsNCiAgICAgICAgICAgIC8vIFJlc2V0IHBpZWNlIHBvc2l0aW9ucyBiYXNlZCBvbiBpbml0aWFsIGJvYXJkDQogICAgICAgICAgICBwaWVjZVBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICAncmVkLWdlbmVyYWwnOiB7IHI6IC0xLCBjOiAtMSB9LA0KICAgICAgICAgICAgICAgICdyZWQtYWR2aXNvcic6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtZWxlcGhhbnQnOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWhvcnNlJzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1jaGFyaW90JzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1jYW5ub24nOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLXNvbGRpZXInOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stZ2VuZXJhbCc6IHsgcjogLTEsIGM6IC0xIH0sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWFkdmlzb3InOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stZWxlcGhhbnQnOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2staG9yc2UnOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stY2hhcmlvdCc6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1jYW5ub24nOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stc29sZGllcic6IFtdDQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBQb3B1bGF0ZSBwaWVjZSBwb3NpdGlvbnMgZnJvbSBpbml0aWFsIGJvYXJkDQogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGluaXRpYWxCb2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtwaWVjZS5jb2xvcn0tJHtwaWVjZS50eXBlfWA7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAocGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgcGllY2VQb3NpdGlvbnNba2V5XSA9IHsgciwgYyB9Ow0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1trZXldLnB1c2goeyByLCBjIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGZpbmQgcGllY2UgcG9zaXRpb24NCiAgICAgICAgY29uc3QgZmluZFBpZWNlUG9zaXRpb24gPSAocGllY2VUeXBlLCBjb2xvciwgY29sLCBkaXJlY3Rpb24sIGJvYXJkLCBmcm9udEJhY2tNYXJrZXIgPSBudWxsKSA9PiB7DQogICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtjb2xvcn0tJHtwaWVjZVR5cGV9YDsNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2tleV07DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHBvc2l0aW9ucyBleGlzdCBhbmQgYXJlIHZhbGlkDQogICAgICAgICAgICBpZiAoIXBvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIHBvc2l0aW9ucyBmb3VuZCBmb3IgcGllY2U6Jywga2V5KTsNCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHBvc2l0aW9uczsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gRmluZCBwaWVjZXMgb24gdGhlIHNwZWNpZmllZCBjb2x1bW4NCiAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBwb3NpdGlvbnMuZmlsdGVyKHBvcyA9PiBwb3MuYyA9PT0gY29sKTsNCg0KICAgICAgICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gY2FuZGlkYXRlcyBmb3VuZCBmb3IgcGllY2U6Jywga2V5LCAnb24gY29sdW1uOicsIGNvbCk7DQogICAgICAgICAgICAgICAgLy8gQWRkaXRpb25hbCBkZWJ1ZyBpbmZvIGZvciBjYW5ub24NCiAgICAgICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnY2Fubm9uJyAmJiBjb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnREVCVUc6IENhbmRpZGF0ZXMgYWZ0ZXIgZmlsdGVyOicsIGNhbmRpZGF0ZXMpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID09PSAxKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZXNbMF07DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIElmIGZyb250L2JhY2sgbWFya2VyIGlzIHByb3ZpZGVkLCB1c2UgaXQgdG8gZGV0ZXJtaW5lIHRoZSBwaWVjZQ0KICAgICAgICAgICAgaWYgKGZyb250QmFja01hcmtlciA9PT0gJ+WJjScpIHsNCiAgICAgICAgICAgICAgICAvLyDliY3ngq7vvJrpnaDov5HmlYzmlrnnmoTmo4vlrZANCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJpy5YC86L6D5aSn55qE5pu06Z2g6L+R5pWM5pa577yI5YmN77yJDQogICAgICAgICAgICAgICAgLy8g6buR5pa577yacuWAvOi+g+Wwj+eahOabtOmdoOi/keaVjOaWue+8iOWJje+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9IGVsc2UgaWYgKGZyb250QmFja01hcmtlciA9PT0gJ+WQjicpIHsNCiAgICAgICAgICAgICAgICAvLyDlkI7ngq7vvJrpnaDov5Hlt7HmlrnnmoTmo4vlrZANCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJpy5YC86L6D5bCP55qE5pu06Z2g6L+R5bex5pa577yI5ZCO77yJDQogICAgICAgICAgICAgICAgLy8g6buR5pa577yacuWAvOi+g+Wkp+eahOabtOmdoOi/keW3seaWue+8iOWQju+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIElmIG11bHRpcGxlIHBpZWNlcyBvbiB0aGUgc2FtZSBjb2x1bW4gYW5kIG5vIG1hcmtlciwgZGV0ZXJtaW5lIGJhc2VkIG9uIGRpcmVjdGlvbg0KICAgICAgICAgICAgLy8g5a+55LqO5ZCM5LiA5YiX55qE5qOL5a2Q77yM6YCa6L+H5q+U6L6DcuWAvOadpeWMuuWIhg0KICAgICAgICAgICAgaWYgKGRpcmVjdGlvbiA9PT0gJ+i/mycpIHsNCiAgICAgICAgICAgICAgICAvLyDov5vmmK/lkJHmlYzmlrnmlrnlkJHnp7vliqjvvIzmiYDku6XpgInmi6nmm7TpnaDov5Hlt7HmlrnnmoTmo4vlrZDvvIjlkI7vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfSBlbHNlIGlmIChkaXJlY3Rpb24gPT09ICfpgIAnKSB7DQogICAgICAgICAgICAgICAgLy8g6YCA5piv5ZCR5bex5pa55pa55ZCR56e75Yqo77yM5omA5Lul6YCJ5oup5pu06Z2g6L+R5pWM5pa555qE5qOL5a2Q77yI5YmN77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZXNbMF07IC8vIERlZmF1bHQgdG8gZmlyc3QgaWYgZGlyZWN0aW9uIGlzICflubMnIGFuZCBubyBtYXJrZXINCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gdXBkYXRlIHBpZWNlIHBvc2l0aW9uDQogICAgICAgIGNvbnN0IHVwZGF0ZVBpZWNlUG9zaXRpb24gPSAocGllY2VUeXBlLCBjb2xvciwgb2xkUG9zLCBuZXdQb3MpID0+IHsNCiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbG9yfS0ke3BpZWNlVHlwZX1gOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNba2V5XTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcG9zaXRpb25zIGV4aXN0IGFuZCBhcmUgdmFsaWQNCiAgICAgICAgICAgIGlmICghcG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBObyBwb3NpdGlvbnMgZm91bmQgZm9yIHBpZWNlOicsIGtleSk7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnMuciA9IG5ld1Bvcy5yOw0KICAgICAgICAgICAgICAgIHBvc2l0aW9ucy5jID0gbmV3UG9zLmM7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCBpbmRleCA9IHBvc2l0aW9ucy5maW5kSW5kZXgocG9zID0+IHBvcy5yID09PSBvbGRQb3MuciAmJiBwb3MuYyA9PT0gb2xkUG9zLmMpOw0KICAgICAgICAgICAgaWYgKGluZGV4ICE9PSAtMSkgew0KICAgICAgICAgICAgICAgIHBvc2l0aW9uc1tpbmRleF0uciA9IG5ld1Bvcy5yOw0KICAgICAgICAgICAgICAgIHBvc2l0aW9uc1tpbmRleF0uYyA9IG5ld1Bvcy5jOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IENvdWxkIG5vdCBmaW5kIHBpZWNlIHBvc2l0aW9uIHRvIHVwZGF0ZTonLCBvbGRQb3MsICdpbicsIHBvc2l0aW9ucyk7DQogICAgICAgICAgICB9DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIHBvc2l0aW9uIGlzIHZhbGlkDQogICAgICAgIGNvbnN0IGlzVmFsaWRQb3MgPSAociwgYykgPT4gciA+PSAwICYmIHIgPCAxMCAmJiBjID49IDAgJiYgYyA8IDk7DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBob3JzZSBtb3Zlcw0KICAgICAgICBjb25zdCBnZXRIb3JzZU1vdmVzID0gKHBvcywgY29sb3IpID0+IHsNCiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107DQogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgZHI6IC0yLCBkYzogLTEgfSwgeyBkcjogLTIsIGRjOiAxIH0sDQogICAgICAgICAgICAgICAgeyBkcjogLTEsIGRjOiAtMiB9LCB7IGRyOiAtMSwgZGM6IDIgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAxLCBkYzogLTIgfSwgeyBkcjogMSwgZGM6IDIgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAyLCBkYzogLTEgfSwgeyBkcjogMiwgZGM6IDEgfQ0KICAgICAgICAgICAgXTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGhvcnNlIGNhbiBtb3ZlIGluIHRoZSBkaXJlY3Rpb24NCiAgICAgICAgICAgIGNvbnN0IGNhbk1vdmUgPSAoZHIsIGRjLCBibG9ja2VkUiwgYmxvY2tlZEMpID0+IHsNCiAgICAgICAgICAgICAgICBpZiAoIWlzVmFsaWRQb3MociArIGJsb2NrZWRSLCBjICsgYmxvY2tlZEMpKSByZXR1cm4gZmFsc2U7DQogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICB9Ow0KDQogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0sIGluZGV4KSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgYmxvY2tlZFIgPSBkciA+IDAgPyAxIDogZHIgPCAwID8gLTEgOiAwOw0KICAgICAgICAgICAgICAgIGNvbnN0IGJsb2NrZWRDID0gZGMgPiAwID8gMSA6IGRjIDwgMCA/IC0xIDogMDsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgcGF0aCBpcyBibG9ja2VkDQogICAgICAgICAgICAgICAgaWYgKChpbmRleCA8IDIgfHwgaW5kZXggPj0gNikgJiYgYmxvY2tlZFIgIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gVmVydGljYWwgYmxvY2tlZA0KICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbk1vdmUoZHIsIGRjLCBibG9ja2VkUiwgMCkpIHJldHVybjsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGJsb2NrZWRDICE9PSAwKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgYmxvY2tlZA0KICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbk1vdmUoZHIsIGRjLCAwLCBibG9ja2VkQykpIHJldHVybjsNCiAgICAgICAgICAgICAgICB9DQoNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7DQogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobmV3UiwgbmV3QykpIHsNCiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSk7DQoNCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGVsZXBoYW50IG1vdmVzDQogICAgICAgIGNvbnN0IGdldEVsZXBoYW50TW92ZXMgPSAocG9zLCBjb2xvcikgPT4gew0KICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyBkcjogLTIsIGRjOiAtMiB9LCB7IGRyOiAtMiwgZGM6IDIgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAyLCBkYzogLTIgfSwgeyBkcjogMiwgZGM6IDIgfQ0KICAgICAgICAgICAgXTsNCg0KICAgICAgICAgICAgLy8gRWxlcGhhbnQncyB0ZXJyaXRvcnkgLSByZWQgZWxlcGhhbnRzIGNhbiBvbmx5IGJlIGluIHI8PTQsIGJsYWNrIGVsZXBoYW50cyBpbiByPj01DQogICAgICAgICAgICBjb25zdCBpc0luVGVycml0b3J5ID0gKHIpID0+IHsNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gciA8PSA0IDogciA+PSA1Ow0KICAgICAgICAgICAgfTsNCg0KICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9KSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgbWlkUiA9IHIgKyBkciAvIDI7DQogICAgICAgICAgICAgICAgY29uc3QgbWlkQyA9IGMgKyBkYyAvIDI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOw0KDQogICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgbWlkIHBvc2l0aW9uIGlzIGVtcHR5IGFuZCBuZXcgcG9zaXRpb24gaXMgdmFsaWQNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhtaWRSLCBtaWRDKSAmJiBpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpICYmIGlzSW5UZXJyaXRvcnkobmV3UikpIHsNCiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSk7DQoNCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGFkdmlzb3IgbW92ZXMNCiAgICAgICAgY29uc3QgZ2V0QWR2aXNvck1vdmVzID0gKHBvcywgY29sb3IpID0+IHsNCiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107DQogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgZHI6IC0xLCBkYzogLTEgfSwgeyBkcjogLTEsIGRjOiAxIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMSwgZGM6IC0xIH0sIHsgZHI6IDEsIGRjOiAxIH0NCiAgICAgICAgICAgIF07DQoNCiAgICAgICAgICAgIC8vIEFkdmlzb3IncyB0ZXJyaXRvcnkgKHBhbGFjZSkgLSByZWQgYWR2aXNvcnMgaW4gcj0wLTIsYz0zLTUsIGJsYWNrIGFkdmlzb3JzIGluIHI9Ny05LGM9My01DQogICAgICAgICAgICBjb25zdCBpc0luUGFsYWNlID0gKHIsIGMpID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCByUmFuZ2UgPSBjb2xvciA9PT0gJ3JlZCcgPyBbMCwgMl0gOiBbNywgOV07DQogICAgICAgICAgICAgICAgcmV0dXJuIHIgPj0gclJhbmdlWzBdICYmIHIgPD0gclJhbmdlWzFdICYmIGMgPj0gMyAmJiBjIDw9IDU7DQogICAgICAgICAgICB9Ow0KDQogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0pID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7DQogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobmV3UiwgbmV3QykgJiYgaXNJblBhbGFjZShuZXdSLCBuZXdDKSkgew0KICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCg0KICAgICAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBib2FyZCB0byB0cmFjayBtb3Zlcw0KICAgICAgICBsZXQgdGVtcEJvYXJkID0gdGhpcy5jcmVhdGVJbml0aWFsQm9hcmQoKTsNCiAgICAgICAgDQogICAgICAgIC8vIEVuc3VyZSB0ZW1wQm9hcmQgaXMgcHJvcGVybHkgaW5pdGlhbGl6ZWQNCiAgICAgICAgaWYgKCF0ZW1wQm9hcmQgfHwgdGVtcEJvYXJkLmxlbmd0aCAhPT0gMTApIHsNCiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgYm9hcmQgaW5pdGlhbGl6YXRpb24nKTsNCiAgICAgICAgICAgIHJldHVybiBbXTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy8gVmVyaWZ5IGFsbCByb3dzIGhhdmUgOSBjb2x1bW5zDQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTA7IGkrKykgew0KICAgICAgICAgICAgaWYgKCF0ZW1wQm9hcmRbaV0gfHwgdGVtcEJvYXJkW2ldLmxlbmd0aCAhPT0gOSkgew0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtpXSA9IEFycmF5KDkpLmZpbGwobnVsbCk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICBjb25zb2xlLmxvZygnVG90YWwgbW92ZXM6Jywgbm90YXRpb24ubGVuZ3RoKTsNCiAgICAgICAgbm90YXRpb24uZm9yRWFjaChtb3ZlTm90YXRpb24gPT4gew0KDQoNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gUGFyc2UgdGhlIG1vdmUgbm90YXRpb24gLSBrZWVwIGxhc3QgZ3JvdXAgb3B0aW9uYWwNCiAgICAgICAgICAgIGNvbnN0IHJlZ2V4ID0gLyhb5YmN5ZCOXSk/KFvlsIbluIXlo6vku5XosaHnm7jpqazovabngq7lhbXljZJdKShb5LiA5LqM5LiJ5Zub5LqU5YWt5LiD5YWr5LmdMTIzNDU2Nzg5XSkoW+i/m+mAgOW5s10pKFvkuIDkuozkuInlm5vkupTlha3kuIPlhavkuZ0xMjM0NTY3ODldKT8vOw0KICAgICAgICAgICAgY29uc3QgbWF0Y2ggPSBtb3ZlTm90YXRpb24ubWF0Y2gocmVnZXgpOw0KDQogICAgICAgICAgICBpZiAoIW1hdGNoKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBtb3ZlIG5vdGF0aW9uOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCBbLCBmcm9udEJhY2tNYXJrZXIsIHBpZWNlQ2hhciwgZnJvbUNvbE5vdGF0aW9uLCBkaXJlY3Rpb24sIHRvQ29sT3JTdGVwTm90YXRpb25dID0gbWF0Y2g7DQogICAgICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZU1hcFtwaWVjZUNoYXJdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBHZXQgY29sdW1uIG1hcHBpbmcgYmFzZWQgb24gY3VycmVudCBjb2xvciAoYmxhY2sgc2VlcyBjb2x1bW5zIG1pcnJvcmVkKQ0KICAgICAgICAgICAgbGV0IGZyb21Db2wgPSBjb2xNYXBbZnJvbUNvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sgKGZyb20gYmxhY2sncyBwZXJzcGVjdGl2ZSkNCiAgICAgICAgICAgICAgICBmcm9tQ29sID0gOCAtIGZyb21Db2w7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEZpbmQgdGhlIGN1cnJlbnQgcG9zaXRpb24gb2YgdGhlIHBpZWNlDQogICAgICAgICAgICBjb25zdCBmcm9tUG9zID0gZmluZFBpZWNlUG9zaXRpb24ocGllY2VUeXBlLCBjdXJyZW50Q29sb3IsIGZyb21Db2wsIGRpcmVjdGlvbiwgdGVtcEJvYXJkLCBmcm9udEJhY2tNYXJrZXIpOw0KDQogICAgICAgICAgICBpZiAoIWZyb21Qb3MpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZmluZCBwaWVjZSBwb3NpdGlvbiBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgbGV0IHRvUG9zOw0KDQogICAgICAgICAgICBpZiAoZGlyZWN0aW9uID09PSAn5bmzJykgew0KICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgbW92ZW1lbnQNCiAgICAgICAgICAgICAgICBsZXQgdG9Db2wgPSBjb2xNYXBbdG9Db2xPclN0ZXBOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgaWYgKHRvQ29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uOicsIHRvQ29sT3JTdGVwTm90YXRpb24sICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjayB3aGVuIG1vdmluZyBob3Jpem9udGFsbHkNCiAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgIHRvQ29sID0gOCAtIHRvQ29sOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICB0b1BvcyA9IHsgcjogZnJvbVBvcy5yLCBjOiB0b0NvbCB9Ow0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBvciBkaWFnb25hbCBtb3ZlbWVudA0KICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXBzID0gY2hpbmVzZU51bWJlck1hcFt0b0NvbE9yU3RlcE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChzdGVwcyA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgc3RlcCBjb3VudDonLCB0b0NvbE9yU3RlcE5vdGF0aW9uLCAnZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdob3JzZScpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gSG9yc2UgbW92ZXMgaW4gTC1zaGFwZQ0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0SG9yc2VNb3Zlcyhmcm9tUG9zLCBjdXJyZW50Q29sb3IpOw0KICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24NCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOw0KICAgICAgICAgICAgICAgICAgICBsZXQgdGFyZ2V0Q29sID0gY29sTWFwW3RhcmdldENvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGhvcnNlOicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sNCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnZWxlcGhhbnQnKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEVsZXBoYW50IG1vdmVzIGRpYWdvbmFsbHkgMiBzdGVwcw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0RWxlcGhhbnRNb3Zlcyhmcm9tUG9zLCBjdXJyZW50Q29sb3IpOw0KICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24NCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOw0KICAgICAgICAgICAgICAgICAgICBsZXQgdGFyZ2V0Q29sID0gY29sTWFwW3RhcmdldENvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGVsZXBoYW50OicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sNCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnYWR2aXNvcicpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gQWR2aXNvciBtb3ZlcyBkaWFnb25hbGx5IDEgc3RlcA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0QWR2aXNvck1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7DQogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247DQogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgYWR2aXNvcjonLCB0YXJnZXRDb2xOb3RhdGlvbiwgJ2luIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrDQogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldENvbCA9IDggLSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIG1vdmUgdGhhdCBtYXRjaGVzIGJvdGggZGlyZWN0aW9uIGFuZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZGlyZWN0aW9uIChyb3cpDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbk1hdGNoID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yID4gZnJvbVBvcy5yIDogbW92ZS5yIDwgZnJvbVBvcy5yKSA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgY29sdW1uDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2x1bW5NYXRjaCA9IG1vdmUuYyA9PT0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOw0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyBTdHJhaWdodCBsaW5lIG1vdmVtZW50IChjaGFyaW90LCBjYW5ub24sIHNvbGRpZXIpDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXAgPSBkaXJlY3Rpb24gPT09ICfov5snID8gKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAxIDogLTEpICogc3RlcHMgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAtMSA6IDEpICogc3RlcHM7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSBmcm9tUG9zLnIgKyBzdGVwOw0KICAgICAgICAgICAgICAgICAgICBpZiAobmV3UiA8IDAgfHwgbmV3UiA+PSAxMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCByb3cgcG9zaXRpb24gYWZ0ZXIgbW92ZTonLCBuZXdSLCAnZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHsgcjogbmV3UiwgYzogZnJvbVBvcy5jIH07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAoIXRvUG9zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignQ291bGQgbm90IGRldGVybWluZSB0YXJnZXQgcG9zaXRpb24gZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEFkZCB0aGUgbW92ZSB0byB0aGUgbGlzdA0KICAgICAgICAgICAgbW92ZXMucHVzaCh7IGZyb206IHsgcjogZnJvbVBvcy5yLCBjOiBmcm9tUG9zLmMgfSwgdG86IHsgcjogdG9Qb3MuciwgYzogdG9Qb3MuYyB9IH0pOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGVyZSdzIGEgY2FwdHVyZWQgcGllY2UNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkUGllY2UgPSB0ZW1wQm9hcmRbdG9Qb3Mucl1bdG9Qb3MuY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIElmIHRoZXJlJ3MgYSBjYXB0dXJlZCBwaWVjZSwgcmVtb3ZlIGl0IGZyb20gcGllY2VQb3NpdGlvbnMNCiAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBgJHtjYXB0dXJlZFBpZWNlLmNvbG9yfS0ke2NhcHR1cmVkUGllY2UudHlwZX1gOw0KICAgICAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkUG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNbY2FwdHVyZWRLZXldOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjYXB0dXJlZFBvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgICAgICAvLyDlsIYv5biF5LiN5Lya6KKr5ZCD5o6J77yM5omA5Lul5Y+q5aSE55CG5YW25LuW5qOL5a2QDQogICAgICAgICAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlLnR5cGUgIT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmVtb3ZlIHRoZSBjYXB0dXJlZCBwb3NpdGlvbiBmcm9tIHRoZSBhcnJheQ0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY2FwdHVyZWRQb3NpdGlvbnMpKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlZFBvc2l0aW9ucyA9IGNhcHR1cmVkUG9zaXRpb25zLmZpbHRlcihwb3MgPT4gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiAocG9zLnIgIT09IHRvUG9zLnIgfHwgcG9zLmMgIT09IHRvUG9zLmMpDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV0gPSB1cGRhdGVkUG9zaXRpb25zOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFZlcmlmeSByZW1vdmFsIHdhcyBzdWNjZXNzZnVsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RpbGxFeGlzdHMgPSB1cGRhdGVkUG9zaXRpb25zLnNvbWUocG9zID0+IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgcG9zLnIgPT09IHRvUG9zLnIgJiYgcG9zLmMgPT09IHRvUG9zLmMNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzdGlsbEV4aXN0cykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IENhcHR1cmVkIHBpZWNlIHN0aWxsIGV4aXN0cyBpbiBwaWVjZVBvc2l0aW9ucyEnKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygn4pyFIFNVQ0NFU1M6IENhcHR1cmVkIHBpZWNlIHJlbW92ZWQgZnJvbSBwaWVjZVBvc2l0aW9ucycpOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBVbmV4cGVjdGVkIG5vbi1hcnJheSBwb3NpdGlvbnMgZm9yIHBpZWNlOicsIGNhcHR1cmVkS2V5KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogTm8gcG9zaXRpb25zIGZvdW5kIGZvciBjYXB0dXJlZCBwaWVjZTonLCBjYXB0dXJlZEtleSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBWZXJpZnkgdGhlIGNhcHR1cmVkIHBpZWNlIGhhcyBiZWVuIHJlbW92ZWQNCiAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBgJHtjYXB0dXJlZFBpZWNlLmNvbG9yfS0ke2NhcHR1cmVkUGllY2UudHlwZX1gOw0KICAgICAgICAgICAgICAgIGNvbnN0IGZpbmFsUG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNbY2FwdHVyZWRLZXldOw0KICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpbmFsUG9zaXRpb25zKSkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGlsbEV4aXN0cyA9IGZpbmFsUG9zaXRpb25zLnNvbWUocG9zID0+IA0KICAgICAgICAgICAgICAgICAgICAgICAgcG9zICYmIHBvcy5yID09PSB0b1Bvcy5yICYmIHBvcy5jID09PSB0b1Bvcy5jDQogICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgICAgIGlmIChzdGlsbEV4aXN0cykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignRVJST1I6IENhcHR1cmVkIHBpZWNlIHN0aWxsIGV4aXN0cyBpbiBwaWVjZVBvc2l0aW9uczonLCBjYXB0dXJlZFBpZWNlLCAnYXQnLCB0b1Bvcyk7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU1VDQ0VTUzogQ2FwdHVyZWQgcGllY2UgcmVtb3ZlZCBmcm9tIHBpZWNlUG9zaXRpb25zJyk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIE1ha2UgdGhlIG1vdmUgb24gdGhlIHRlbXBvcmFyeSBib2FyZCBmaXJzdCBiZWZvcmUgdXBkYXRpbmcgcGllY2UgcG9zaXRpb25zDQogICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhmcm9tUG9zLnIsIGZyb21Qb3MuYykgJiYgaXNWYWxpZFBvcyh0b1Bvcy5yLCB0b1Bvcy5jKSAmJiANCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbZnJvbVBvcy5yXSAmJiB0ZW1wQm9hcmRbdG9Qb3Mucl0pIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IHRlbXBCb2FyZFtmcm9tUG9zLnJdW2Zyb21Qb3MuY107DQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW3RvUG9zLnJdW3RvUG9zLmNdID0gcGllY2U7DQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2Zyb21Qb3Mucl1bZnJvbVBvcy5jXSA9IG51bGw7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogSW52YWxpZCBwb3NpdGlvbnMgZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uLCBmcm9tUG9zLCB0b1Bvcyk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgcGllY2UgcG9zaXRpb24gaW4gcGllY2VQb3NpdGlvbnMNCiAgICAgICAgICAgIHVwZGF0ZVBpZWNlUG9zaXRpb24ocGllY2VUeXBlLCBjdXJyZW50Q29sb3IsIGZyb21Qb3MsIHRvUG9zKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gU3dpdGNoIGNvbG9yIGZvciBuZXh0IG1vdmUNCiAgICAgICAgICAgIGN1cnJlbnRDb2xvciA9IGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIH0pOw0KDQogICAgICAgIHJldHVybiBtb3ZlczsNCiAgICB9DQp9DQoNCi8vIC0tLSBDb25zdGFudHMgLS0tDQoNCi8vIEluaXRpYWxpemUgT3BlbmluZyBCb29rDQpjb25zdCBvcGVuaW5nQm9vayA9IG5ldyBPcGVuaW5nQm9vaygxMik7DQoNCmNvbnN0IFBJRUNFX1ZBTFVFUyA9IHsNCiAgZ2VuZXJhbDogMTAwMDAsICAgICAvLyDlsIYv5biFDQogIGNoYXJpb3Q6IDkwMCwgICAgICAgLy8g6L2mDQogIGNhbm5vbjogNDUwLCAgICAgICAgLy8g54KuDQogIGhvcnNlOiA0MDAsICAgICAgICAgLy8g6amsDQogIGVsZXBoYW50OiAyMDAsICAgICAgLy8g6LGhL+ebuA0KICBhZHZpc29yOiAyMDAsICAgICAgIC8vIOWjqy/ku5UNCiAgc29sZGllcjogMTAwLCAgICAgICAvLyDlhbUv5Y2SDQp9Ow0KDQovLyAtLS0gUGllY2UtU3F1YXJlIFRhYmxlcyAtLS0NCmNvbnN0IFBTVF9TT0xESUVSID0gWw0KICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogIFsxMCwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDEwXSwNCiAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICBbMTAsIDE1LCAyNSwgMzAsIDMwLCAzMCwgMjUsIDE1LCAxMF0sDQogIFs1LCAxMCwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxMCwgNV0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQpdOw0KY29uc3QgUFNUX0NIQVJJT1QgPSBbDQogIFs1LCAxMCwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgNV0sDQogIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICBbMTAsIDEyLCAxNSwgMTUsIDE1LCAxNSwgMTUsIDEyLCAxMF0sDQogIFs1LCAxMCwgMTIsIDEwLCAxMCwgMTAsIDEyLCAxMCwgNV0sDQogIFsxMCwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDEwXSwNCiAgWzAsIDEwLCA1LCAxMCwgNSwgMTAsIDUsIDEwLCAwXQ0KXTsNCmNvbnN0IFBTVF9IT1JTRSA9IFsNCiAgWzAsIC01LCAwLCAwLCAwLCAwLCAwLCAtNSwgMF0sDQogIFswLCA1LCAxNSwgMTAsIDEwLCAxMCwgMTUsIDUsIDBdLA0KICBbNSwgNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCA1LCA1XSwNCiAgWzUsIDEwLCAyMCwgMjUsIDI1LCAyNSwgMjAsIDEwLCA1XSwNCiAgWzAsIDUsIDE1LCAyMCwgMjAsIDIwLCAxNSwgNSwgMF0sDQogIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgWzAsIDAsIDUsIDUsIDUsIDUsIDUsIDAsIDBdLA0KICBbMCwgLTUsIDAsIDUsIDUsIDUsIDAsIC01LCAwXSwNCiAgWzAsIC0xMCwgLTUsIDAsIDAsIDAsIC01LCAtMTAsIDBdDQpdOw0KY29uc3QgUFNUX0NBTk5PTiA9IFsNCiAgWzAsIDAsIDUsIDEwLCAxMCwgMTAsIDUsIDAsIDBdLA0KICBbMCwgNSwgMTUsIDEwLCAxMCwgMTAsIDE1LCA1LCAwXSwNCiAgWzAsIDUsIDE1LCAyNSwgMjUsIDI1LCAxNSwgNSwgMF0sDQogIFswLCA1LCAxMCwgMTUsIDE1LCAxNSwgMTAsIDUsIDBdLA0KICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgWzAsIDUsIDUsIDUsIDUsIDUsIDUsIDUsIDBdLA0KICBbNSwgMTUsIDIwLCAzMCwgMzAsIDMwLCAyMCwgMTUsIDVdLCANCiAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0NCl07DQpjb25zdCBQU1RfREVGRU5TRSA9IFsNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDIwLCAzMCwgMjAsIDAsIDAsIDBdDQpdOw0KDQpjb25zdCBnZXRQU1RWYWx1ZSA9ICh0eXBlLCBjb2xvciwgciwgYykgPT4gew0KICBjb25zdCByb3dJZHggPSBjb2xvciA9PT0gJ3JlZCcgPyByIDogKDkgLSByKTsNCiAgbGV0IHRhYmxlID0gW107DQogIHN3aXRjaCAodHlwZSkgew0KICAgIGNhc2UgJ3NvbGRpZXInOiB0YWJsZSA9IFBTVF9TT0xESUVSOyBicmVhazsNCiAgICBjYXNlICdjaGFyaW90JzogdGFibGUgPSBQU1RfQ0hBUklPVDsgYnJlYWs7DQogICAgY2FzZSAnaG9yc2UnOiB0YWJsZSA9IFBTVF9IT1JTRTsgYnJlYWs7DQogICAgY2FzZSAnY2Fubm9uJzogdGFibGUgPSBQU1RfQ0FOTk9OOyBicmVhazsNCiAgICBkZWZhdWx0OiB0YWJsZSA9IFBTVF9ERUZFTlNFOyBicmVhazsgDQogIH0NCiAgcmV0dXJuIHRhYmxlW3Jvd0lkeF0/LltjXSB8fCAwOw0KfTsNCg0KY29uc3QgaXNWYWxpZFBvcyA9IChyLCBjKSA9PiByID49IDAgJiYgciA8IFJPV1MgJiYgYyA+PSAwICYmIGMgPCBDT0xTOw0KDQovLyDojrflj5bmo4vlrZDnmoTlqIHog4Hnm67moIflkozkv53miqTnm67moIcNCmNvbnN0IGdldFBpZWNlVGFyZ2V0cyA9IChib2FyZCwgcG9zLCBwaWVjZSkgPT4gew0KICBjb25zdCB0aHJlYXQgPSBbXTsgICAgICAgICAgIC8vIOW9k+WJjeaji+WtkOWogeiDgeeahOaVjOaWueaji+WtkA0KICBjb25zdCBndWFyZCA9IFtdOyAgICAgICAvLyDlvZPliY3mo4vlrZDkv53miqTnmoTlt7Hmlrnmo4vlrZANCiAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KDQogIGNvbnN0IGFkZElmVmFsaWQgPSAodHIsIHRjKSA9PiB7DQogICAgaWYgKGlzVmFsaWRQb3ModHIsIHRjKSkgew0KICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFt0cl1bdGNdOw0KICAgICAgICBpZiAodGFyZ2V0KSB7DQogICAgICAgICAgICBpZiAodGFyZ2V0LmNvbG9yICE9PSBwaWVjZS5jb2xvcikgew0KICAgICAgICAgICAgICAgIC8vIOaVjOaWueaji+WtkO+8jOWKoOWFpeWogeiDgeWIl+ihqA0KICAgICAgICAgICAgICAgIHRocmVhdC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDlt7Hmlrnmo4vlrZDvvIzliqDlhaXkv53miqTliJfooajvvIzlsIbluIXkuI3pnIDopoHkuovlkI7nmoTkv53miqQNCiAgICAgICAgICAgICAgICBpZiAodGFyZ2V0LnR5cGUgIT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgIGd1YXJkLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICB9Ow0KICANCg0KDQogIHN3aXRjaCAocGllY2UudHlwZSkgew0KICAgIGNhc2UgJ2dlbmVyYWwnOiANCiAgICAgIFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBpZiAobmMgPj0gMyAmJiBuYyA8PSA1KSB7DQogICAgICAgICAgaWYgKGlzUmVkICYmIG5yID49IDAgJiYgbnIgPD0gMikgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA3ICYmIG5yIDw9IDkpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdhZHZpc29yJzoNCiAgICAgIFtbMSwgMV0sIFsxLCAtMV0sIFstMSwgMV0sIFstMSwgLTFdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGlmIChuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDcgJiYgbnIgPD0gOSkgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2VsZXBoYW50JzoNCiAgICAgIFtbMiwgMl0sIFsyLCAtMl0sIFstMiwgMl0sIFstMiwgLTJdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGNvbnN0IGV5ZVIgPSByICsgZHIgLyAyLCBleWVDID0gYyArIGRjIC8gMjsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MobnIsIG5jKSAmJiBib2FyZFtleWVSXVtleWVDXSA9PT0gbnVsbCkgew0KICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA8PSA0KSBhZGRJZlZhbGlkKG5yLCBuYyk7IA0KICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA1KSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnaG9yc2UnOg0KICAgICAgW1syLCAxXSwgWzIsIC0xXSwgWy0yLCAxXSwgWy0yLCAtMV0sIFsxLCAyXSwgWzEsIC0yXSwgWy0xLCAyXSwgWy0xLCAtMl1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgY29uc3QgbGVnUiA9IHIgKyAoTWF0aC5hYnMoZHIpID09PSAyID8gTWF0aC5zaWduKGRyKSA6IDApOw0KICAgICAgICBjb25zdCBsZWdDID0gYyArIChNYXRoLmFicyhkYykgPT09IDIgPyBNYXRoLnNpZ24oZGMpIDogMCk7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKGxlZ1IsIGxlZ0MpICYmIGJvYXJkW2xlZ1JdW2xlZ0NdID09PSBudWxsKSB7DQogICAgICAgICAgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2NoYXJpb3QnOg0KICAgICAgW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7DQogICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIHsNCiAgICAgICAgICAgIC8vIOepuuS9jee9ru+8jOS4jeWBmuWkhOeQhg0KICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgICB9DQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2Nhbm5vbic6DQogICAgICBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGxldCBzY3JlZW5Gb3VuZCA9IGZhbHNlOw0KICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7DQogICAgICAgICAgaWYgKCFzY3JlZW5Gb3VuZCkgew0KICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgLy8g56m65L2N572u77yM5LiN5YGa5aSE55CGDQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICBzY3JlZW5Gb3VuZCA9IHRydWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdICE9PSBudWxsKSB7DQogICAgICAgICAgICAgIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgICAgfQ0KICAgICAgICAgIG5yICs9IGRyOyBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdzb2xkaWVyJzogew0KICAgICAgLy8g57qi5pa55YW15Yid5aeL5L2N572u5Zyocj0z77yM5ZCR5YmN6LWw5pivcuWinuWkp++8iOWQkeS4i++8ie+8m+m7keaWueWFteWIneWni+S9jee9ruWcqHI9Nu+8jOWQkeWJjei1sOaYr3Llh4/lsI/vvIjlkJHkuIrvvIkNCiAgICAgIGNvbnN0IGZvcndhcmQgPSBpc1JlZCA/IDEgOiAtMTsNCiAgICAgIC8vIOe6ouaWueWFtei/h+ays+adoeS7tuaYr3IgPj0gNe+8jOm7keaWueWFtei/h+ays+adoeS7tuaYr3IgPD0gNA0KICAgICAgLy8g5rKz55WM5L2N5LqOcj005ZKMcj015LmL6Ze077yM57qi5pa55YW16ZyA6KaB6LWw5Yiwcj015omN6IO96L+H5rKz77yM6buR5pa55YW16ZyA6KaB6LWw5Yiwcj005omN6IO96L+H5rKzDQogICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBpc1JlZCA/IHIgPj0gNSA6IHIgPD0gNDsNCiAgICAgIGFkZElmVmFsaWQociArIGZvcndhcmQsIGMpOw0KICAgICAgaWYgKGNyb3NzZWRSaXZlcikgew0KICAgICAgICBhZGRJZlZhbGlkKHIsIGMgLSAxKTsNCiAgICAgICAgYWRkSWZWYWxpZChyLCBjICsgMSk7DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogIH0NCiAgcmV0dXJuIHsgdGhyZWF0LCBndWFyZCB9Ow0KfTsNCg0KLy8gYWxsaWVzT3V0OiDlj6/pgInvvIzmlLbpm4blj6/kv53miqTnmoTlt7HmlrnokL3ngrnvvIjkuI3lkKvlsIbluIXvvInvvIzkvpvlhbPns7vorqHnrpflpI3nlKjvvIzpgb/lhY3kuozmrKHlsITnur8NCmNvbnN0IGdldFBpZWNlTW92ZXMgPSAoYm9hcmQsIHBvcywgcGllY2UsIGFsbGllc091dCA9IG51bGwpID0+IHsNCiAgY29uc3QgbW92ZXMgPSBbXTsNCiAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KDQogIGNvbnN0IGFkZEFsbHkgPSAodHIsIHRjLCB0YXJnZXQpID0+IHsNCiAgICBpZiAoYWxsaWVzT3V0ICYmIHRhcmdldCAmJiB0YXJnZXQuY29sb3IgPT09IHBpZWNlLmNvbG9yICYmIHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgIGFsbGllc091dC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgIH0NCiAgfTsNCg0KICBjb25zdCBhZGRJZlZhbGlkID0gKHRyLCB0YykgPT4gew0KICAgIGlmIChpc1ZhbGlkUG9zKHRyLCB0YykpIHsNCiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbdHJdW3RjXTsNCiAgICAgICAgaWYgKCF0YXJnZXQgfHwgdGFyZ2V0LmNvbG9yICE9PSBwaWVjZS5jb2xvcikgew0KICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGFkZEFsbHkodHIsIHRjLCB0YXJnZXQpOw0KICAgICAgICB9DQogICAgfQ0KICB9Ow0KDQogIHN3aXRjaCAocGllY2UudHlwZSkgew0KICAgIGNhc2UgJ2dlbmVyYWwnOiANCiAgICAgIFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBpZiAobmMgPj0gMyAmJiBuYyA8PSA1KSB7DQogICAgICAgICAgaWYgKGlzUmVkICYmIG5yID49IDAgJiYgbnIgPD0gMikgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA3ICYmIG5yIDw9IDkpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdhZHZpc29yJzoNCiAgICAgIFtbMSwgMV0sIFsxLCAtMV0sIFstMSwgMV0sIFstMSwgLTFdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGlmIChuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDcgJiYgbnIgPD0gOSkgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2VsZXBoYW50JzoNCiAgICAgIFtbMiwgMl0sIFsyLCAtMl0sIFstMiwgMl0sIFstMiwgLTJdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGNvbnN0IGV5ZVIgPSByICsgZHIgLyAyLCBleWVDID0gYyArIGRjIC8gMjsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MobnIsIG5jKSAmJiBib2FyZFtleWVSXVtleWVDXSA9PT0gbnVsbCkgew0KICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA8PSA0KSBhZGRJZlZhbGlkKG5yLCBuYyk7IA0KICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA1KSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnaG9yc2UnOg0KICAgICAgW1syLCAxXSwgWzIsIC0xXSwgWy0yLCAxXSwgWy0yLCAtMV0sIFsxLCAyXSwgWzEsIC0yXSwgWy0xLCAyXSwgWy0xLCAtMl1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgY29uc3QgbGVnUiA9IHIgKyAoTWF0aC5hYnMoZHIpID09PSAyID8gTWF0aC5zaWduKGRyKSA6IDApOw0KICAgICAgICBjb25zdCBsZWdDID0gYyArIChNYXRoLmFicyhkYykgPT09IDIgPyBNYXRoLnNpZ24oZGMpIDogMCk7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKGxlZ1IsIGxlZ0MpICYmIGJvYXJkW2xlZ1JdW2xlZ0NdID09PSBudWxsKSB7DQogICAgICAgICAgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2NoYXJpb3QnOg0KICAgICAgW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7DQogICAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICBpZiAodGFyZ2V0ID09PSBudWxsKSB7DQogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAodGFyZ2V0LmNvbG9yICE9PSBwaWVjZS5jb2xvcikgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIGVsc2UgYWRkQWxseShuciwgbmMsIHRhcmdldCk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgICB9DQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2Nhbm5vbic6DQogICAgICAvLyDnnYDms5Xku43lj6rlkKvmlYzmlrnpmpTmiZPvvJvlt7HmlrnpmpTmiZPkv53miqTnlLEgZmlsbENhbm5vblJlbGF0aW9ucyDnu5/kuIDlpITnkIYNCiAgICAgIFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgbGV0IHNjcmVlbkZvdW5kID0gZmFsc2U7DQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgc2NyZWVuRm91bmQgPSB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSAhPT0gbnVsbCkgew0KICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXS5jb2xvciAhPT0gcGllY2UuY29sb3IpIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgIH0NCiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnc29sZGllcic6IHsNCiAgICAgIC8vIOe6ouaWueWFteWIneWni+S9jee9ruWcqHI9M++8jOWQkeWJjei1sOaYr3Llop7lpKfvvIjlkJHkuIvvvInvvJvpu5HmlrnlhbXliJ3lp4vkvY3nva7lnKhyPTbvvIzlkJHliY3otbDmmK9y5YeP5bCP77yI5ZCR5LiK77yJDQogICAgICBjb25zdCBmb3J3YXJkID0gaXNSZWQgPyAxIDogLTE7DQogICAgICAvLyDnuqLmlrnlhbXov4fmsrPmnaHku7bmmK9yID49IDXvvIzpu5HmlrnlhbXov4fmsrPmnaHku7bmmK9yIDw9IDQNCiAgICAgIC8vIOays+eVjOS9jeS6jnI9NOWSjHI9NeS5i+mXtO+8jOe6ouaWueWFtemcgOimgei1sOWIsHI9NeaJjeiDvei/h+ays++8jOm7keaWueWFtemcgOimgei1sOWIsHI9NOaJjeiDvei/h+aysw0KICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gaXNSZWQgPyByID49IDUgOiByIDw9IDQ7DQogICAgICBhZGRJZlZhbGlkKHIgKyBmb3J3YXJkLCBjKTsNCiAgICAgIGlmIChjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgYWRkSWZWYWxpZChyLCBjIC0gMSk7DQogICAgICAgIGFkZElmVmFsaWQociwgYyArIDEpOw0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICB9DQogIHJldHVybiBtb3ZlczsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOaOp+WItueCuQ0KY29uc3QgZ2V0UGllY2VDb250cm9sID0gKGJvYXJkLCBwb3MsIHBpZWNlKSA9PiB7DQogIGNvbnN0IGNvbnRyb2wgPSBbXTsNCiAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KDQogIGNvbnN0IGFkZElmVmFsaWQgPSAodHIsIHRjKSA9PiB7DQogICAgaWYgKGlzVmFsaWRQb3ModHIsIHRjKSkgew0KICAgICAgICBjb250cm9sLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgfQ0KICB9Ow0KDQogIC8vIOWvueS6jumdnueCruaji+WtkO+8jOaOp+WItueCueWPquWMheaLrOWFtuWPr+S7peaJk+WIsOeahOepuuS9jee9ru+8jOWNs+WmguaenOaVjOaWueaji+WtkOi/m+WFpei/meS6m+eCueWwhuiiq+aUu+WHuw0KICBpZiAocGllY2UudHlwZSAhPT0gJ2Nhbm5vbicpIHsNCiAgICAvLyDojrflj5bmiYDmnInlj6/og73nmoTnp7vliqjkvY3nva7vvIznhLblkI7ov4fmu6TmjonmnInmo4vlrZDnmoTkvY3nva4NCiAgICBjb25zdCBtb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHBvcywgcGllY2UpOw0KICAgIG1vdmVzLmZvckVhY2gobW92ZSA9PiB7DQogICAgICAvLyDlj6rmt7vliqDnqbrkvY3nva7kvZzkuLrmjqfliLbngrkNCiAgICAgIGlmIChib2FyZFttb3ZlLnJdW21vdmUuY10gPT09IG51bGwpIHsNCiAgICAgICAgY29udHJvbC5wdXNoKG1vdmUpOw0KICAgICAgfQ0KICAgIH0pOw0KICB9IGVsc2Ugew0KICAgIC8vIOWvueS6jueCruaji+WtkO+8jOmcgOimgeeJueauiuiuoeeul+aOp+WItueCue+8jOaOp+WItueCueWPquWMheaLrOWFtuWPr+S7peaJk+WIsOeahOepuuS9jee9ru+8jOWNs+WmguaenOaVjOaWueaji+WtkOi/m+WFpei/meS6m+eCueWwhuiiq+aUu+WHuw0KICAgIC8vIOeCruiDveaOp+WItueahOaYr+esrDHkuKrngq7lj7DkuYvlkI7vvIjkuI3lkKvngq7lj7DvvInnrKwy5Liq54Ku5Y+w5LmL5YmN77yI5LiN5ZCr54Ku5Y+w77yJ55qE5omA5pyJ56m65L2N572uDQogICAgLy8g5aaC5p6c5rKh5pyJ56ysMuS4queCruWPsOmCo+S5iOWwseaYr+esrDHkuKrngq7lj7DkuYvlkI7vvIjkuI3lkKvngq7lj7DvvInnmoTmiYDmnInnqbrkvY3nva4NCiAgICBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgbGV0IHNjcmVlbkZvdW5kQ291bnQgPSAwOw0KICAgICAgDQogICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpICYmIHNjcmVlbkZvdW5kQ291bnQgPCAyKSB7DQogICAgICAgIGNvbnN0IGN1cnJlbnRQaWVjZSA9IGJvYXJkW25yXVtuY107DQogICAgICAgIA0KICAgICAgICBpZiAoY3VycmVudFBpZWNlICE9PSBudWxsKSB7DQogICAgICAgICAgLy8g5om+5Yiw5LiA5Liq54Ku5Y+w77yM5aKe5Yqg6K6h5pWwDQogICAgICAgICAgc2NyZWVuRm91bmRDb3VudCsrOw0KICAgICAgICB9IGVsc2UgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDEpIHsNCiAgICAgICAgICAvLyDnrKwx5Liq54Ku5Y+w5LmL5ZCO77yM56ysMuS4queCruWPsOS5i+WJjeeahOepuuS9jee9ru+8jOa3u+WKoOWIsOaOp+WItueCuQ0KICAgICAgICAgIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgfQ0KICAgIH0pOw0KICB9DQoNCiAgcmV0dXJuIGNvbnRyb2w7DQp9Ow0KDQpjb25zdCBpc0ZseWluZ0dlbmVyYWwgPSAoYm9hcmQpID0+IHsNCiAgY29uc3QgcmVkRyA9IGdldEdlbmVyYWxQb3MoYm9hcmQsICdyZWQnKTsNCiAgY29uc3QgYmxhY2tHID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgJ2JsYWNrJyk7DQogIGlmICghcmVkRyB8fCAhYmxhY2tHIHx8IHJlZEcuYyAhPT0gYmxhY2tHLmMpIHJldHVybiBmYWxzZTsNCiAgDQogIC8vIOehruS/neW+queOr+aWueWQkeato+ehru+8jOS7jui+g+Wwj+eahHLliLDovoPlpKfnmoRyDQogIGNvbnN0IHN0YXJ0UiA9IE1hdGgubWluKGJsYWNrRy5yLCByZWRHLnIpICsgMTsNCiAgY29uc3QgZW5kUiA9IE1hdGgubWF4KGJsYWNrRy5yLCByZWRHLnIpIC0gMTsNCiAgDQogIGZvciAobGV0IHIgPSBzdGFydFI7IHIgPD0gZW5kUjsgcisrKSB7DQogICAgaWYgKGJvYXJkW3JdW3JlZEcuY10gIT09IG51bGwpIHJldHVybiBmYWxzZTsNCiAgfQ0KICByZXR1cm4gdHJ1ZTsNCn07DQoNCi8vIOaXoCBib2FyZEluZm8g5pe255qE5b+r6YCf5bCG5Yab5qOA5rWL77ya5bCG5L2N57yT5a2YICsg5LuO5bCG5L2N5Zub5ZCR5bCE57q/77yI6L2mL+Wwhi/ngq7lkIjlubbvvIkNCmNvbnN0IGlzQ2hlY2tSYXcgPSAoYm9hcmQsIGNvbG9yKSA9PiB7DQogICAgY29uc3QgZ2VuZXJhbFBvcyA9IGdldEdlbmVyYWxQb3MoYm9hcmQsIGNvbG9yKTsNCiAgICBpZiAoIWdlbmVyYWxQb3MpIHJldHVybiB0cnVlOw0KDQogICAgY29uc3QgZW5lbXlDb2xvciA9IGNvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICBjb25zdCB7IHI6IGdyLCBjOiBnYyB9ID0gZ2VuZXJhbFBvczsNCg0KICAgIC8vIOebtOe6v++8muesrOS4gOWtkOS4uuaVjOi9pi/lsIbliJnlsIblhpvvvJvotorov4fngq7mnrblkI7nrKzkuozlrZDkuLrmlYzngq7liJnlsIblhpsNCiAgICBjb25zdCBkaXJlY3Rpb25zID0gW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXTsNCiAgICBmb3IgKGNvbnN0IFtkciwgZGNdIG9mIGRpcmVjdGlvbnMpIHsNCiAgICAgICAgbGV0IG5yID0gZ3IgKyBkcjsNCiAgICAgICAgbGV0IG5jID0gZ2MgKyBkYzsNCiAgICAgICAgbGV0IHNlZW4gPSAwOw0KDQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHApIHsNCiAgICAgICAgICAgICAgICBzZWVuKys7DQogICAgICAgICAgICAgICAgaWYgKHNlZW4gPT09IDEpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgKHAudHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHAudHlwZSA9PT0gJ2dlbmVyYWwnKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdjYW5ub24nKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBuciArPSBkcjsNCiAgICAgICAgICAgIG5jICs9IGRjOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g6ams77ya5LuO5bCG5L2N5Y+N5o6o77yM6ams6IW/5Zyo6ams5LiA5L6n77yI5LiOIGdldFBpZWNlTW92ZXMg5LiA6Ie077yJDQogICAgY29uc3QgaG9yc2VNb3ZlcyA9IFtbMiwgMV0sIFsyLCAtMV0sIFstMiwgMV0sIFstMiwgLTFdLCBbMSwgMl0sIFsxLCAtMl0sIFstMSwgMl0sIFstMSwgLTJdXTsNCiAgICBmb3IgKGNvbnN0IFtkciwgZGNdIG9mIGhvcnNlTW92ZXMpIHsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGRyOw0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICAgIGNvbnN0IGxlZ1IgPSBuciAtIChNYXRoLmFicyhkcikgPT09IDIgPyBNYXRoLnNpZ24oZHIpIDogMCk7DQogICAgICAgICAgICBjb25zdCBsZWdDID0gbmMgLSAoTWF0aC5hYnMoZGMpID09PSAyID8gTWF0aC5zaWduKGRjKSA6IDApOw0KICAgICAgICAgICAgaWYgKGJvYXJkW2xlZ1JdW2xlZ0NdID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdob3JzZScpIHsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5aOr77yI5Lmd5a6r5YaF77yJDQogICAgY29uc3QgYWR2aXNvck1vdmVzID0gW1sxLCAxXSwgWzEsIC0xXSwgWy0xLCAxXSwgWy0xLCAtMV1dOw0KICAgIGZvciAoY29uc3QgW2RyLCBkY10gb2YgYWR2aXNvck1vdmVzKSB7DQogICAgICAgIGNvbnN0IG5yID0gZ3IgKyBkcjsNCiAgICAgICAgY29uc3QgbmMgPSBnYyArIGRjOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhuciwgbmMpICYmDQogICAgICAgICAgICAoKGNvbG9yID09PSAncmVkJyAmJiBuciA+PSAwICYmIG5yIDw9IDIpIHx8IChjb2xvciA9PT0gJ2JsYWNrJyAmJiBuciA+PSA3ICYmIG5yIDw9IDkpKSAmJg0KICAgICAgICAgICAgbmMgPj0gMyAmJiBuYyA8PSA1KSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnYWR2aXNvcicpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOWFte+8muato+WJjeaWueWni+e7iOWPr+aUu++8m+W3puWPs+S7hei/h+ays+WFtQ0KICAgIGNvbnN0IGVuZW15Rm9yd2FyZCA9IGVuZW15Q29sb3IgPT09ICdyZWQnID8gMSA6IC0xOw0KICAgIGNvbnN0IGZvcndhcmRGcm9tUiA9IGdyIC0gZW5lbXlGb3J3YXJkOw0KICAgIGlmIChpc1ZhbGlkUG9zKGZvcndhcmRGcm9tUiwgZ2MpKSB7DQogICAgICAgIGNvbnN0IHAgPSBib2FyZFtmb3J3YXJkRnJvbVJdW2djXTsNCiAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgIH0NCiAgICB9DQogICAgZm9yIChjb25zdCBkYyBvZiBbMSwgLTFdKSB7DQogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkYzsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MoZ3IsIG5jKSkgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW2dyXVtuY107DQogICAgICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7DQogICAgICAgICAgICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyBnciA+PSA1IDogZ3IgPD0gNDsNCiAgICAgICAgICAgICAgICBpZiAoY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIHJldHVybiBmYWxzZTsNCn07DQoNCmNvbnN0IGlzQ2hlY2sgPSAoYm9hcmQsIGNvbG9yLCBwaWVjZXNJbmZvID0gbnVsbCwgYm9hcmRJbmZvID0gbnVsbCkgPT4gew0KICAgIC8vIOS8mOWFiOS9v+eUqOmihOiuoeeul+eahOWwhuWGm+eKtuaAgQ0KICAgIGlmIChib2FyZEluZm8pIHsNCiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRJc0luQ2hlY2sgOiBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2s7DQogICAgfQ0KDQogICAgLy8g5aaC5p6c5pyJcGllY2VzSW5mb++8jOS5n+WPr+S7peS7juS4reiOt+WPluWwhuWGm+eKtuaAgQ0KICAgIGlmIChwaWVjZXNJbmZvICYmIHBpZWNlc0luZm8ubGVuZ3RoID4gMCkgew0KICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gcGllY2VzSW5mb1swXS5yZWRJc0luQ2hlY2sgOiBwaWVjZXNJbmZvWzBdLmJsYWNrSXNJbkNoZWNrOw0KICAgIH0NCg0KICAgIHJldHVybiBpc0NoZWNrUmF3KGJvYXJkLCBjb2xvcik7DQp9Ow0KDQovLyDlkIjms5XnnYDms5XvvJrkvKrlkIjms5UgKyDkuI3pgIHlsIYv5LiN6aOe5bCG77yIbWFrZS91bm1ha2XvvIkNCmNvbnN0IGdldFZhbGlkTW92ZXMgPSAoYm9hcmQsIHBvcykgPT4gew0KICBjb25zdCBwaWVjZSA9IGJvYXJkW3Bvcy5yXVtwb3MuY107DQogIGlmICghcGllY2UpIHJldHVybiBbXTsNCiAgY29uc3QgcHNldWRvTW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCBwb3MsIHBpZWNlKTsNCiAgcmV0dXJuIGZpbHRlckxlZ2FsTW92ZXMoYm9hcmQsIHBvcywgcGllY2UsIHBzZXVkb01vdmVzKTsNCn07DQoNCmNvbnN0IGlzVmFsaWRQbGFjZW1lbnQgPSAodHlwZSwgY29sb3IsIHIsIGMpID0+IHsNCiAgICBjb25zdCBpc1JlZCA9IGNvbG9yID09PSAncmVkJzsNCiAgICBzd2l0Y2godHlwZSkgew0KICAgICAgICBjYXNlICdnZW5lcmFsJzoNCiAgICAgICAgICAgIC8vIOW4heWwhuWPquiDveWcqOS5neWuq+S4reW/g+eahOS4gOadoee6v+S4ig0KICAgICAgICAgICAgaWYgKGMgPCAzIHx8IGMgPiA1KSByZXR1cm4gZmFsc2U7DQogICAgICAgICAgICBpZiAoaXNSZWQpIHJldHVybiByID49IDAgJiYgciA8PSAyOw0KICAgICAgICAgICAgZWxzZSByZXR1cm4gciA+PSA3ICYmIHIgPD0gOTsNCiAgICAgICAgY2FzZSAnYWR2aXNvcic6DQogICAgICAgICAgICAvLyDlo6vlj6rog73lnKjkuZ3lrqvnmoQ15Liq54K55LmL5LiADQogICAgICAgICAgICBjb25zdCB2YWxpZEFkdmlzb3JQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgcmVkOiBbWzAsIDNdLCBbMCwgNV0sIFsxLCA0XSwgWzIsIDNdLCBbMiwgNV1dLA0KICAgICAgICAgICAgICAgIGJsYWNrOiBbWzcsIDNdLCBbNywgNV0sIFs4LCA0XSwgWzksIDNdLCBbOSwgNV1dDQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgcmV0dXJuIHZhbGlkQWR2aXNvclBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ10uc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgIGNhc2UgJ2VsZXBoYW50JzoNCiAgICAgICAgICAgIC8vIOebuOWPquiDveWcqOW3seaWueWNiuWcuueahDfkuKrngrnkuYvkuIANCiAgICAgICAgICAgIGNvbnN0IHZhbGlkRWxlcGhhbnRQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgcmVkOiBbWzAsIDJdLCBbMCwgNl0sIFsyLCAwXSwgWzIsIDRdLCBbMiwgOF0sIFs0LCAyXSwgWzQsIDZdXSwNCiAgICAgICAgICAgICAgICBibGFjazogW1s1LCAyXSwgWzUsIDZdLCBbNywgMF0sIFs3LCA0XSwgWzcsIDhdLCBbOSwgMl0sIFs5LCA2XV0NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICByZXR1cm4gdmFsaWRFbGVwaGFudFBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ10uc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgIGNhc2UgJ3NvbGRpZXInOg0KICAgICAgICAgICAgLy8g5YW155qE5L2N572u6ZmQ5Yi277ya6L+H5rKz5YmN5Y+q6IO95Zyo5YG25pWw5YiX77yM6L+H5rKz5ZCO5Y+v5Lul5Zyo5Lu75L2V5YiXDQogICAgICAgICAgICAvLyDnuqLmlrnlhbXov4fmsrPmnaHku7bmmK9yID49IDXvvIzpu5HmlrnlhbXov4fmsrPmnaHku7bmmK9yIDw9IDQNCiAgICAgICAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGlzUmVkID8gciA+PSA1IDogciA8PSA0Ow0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoIWNyb3NzZWRSaXZlcikgew0KICAgICAgICAgICAgICAgIC8vIOi/h+ays+WJjeWPquiDveWcqOWBtuaVsOWIl++8iGM9MCwyLDQsNiw477yJDQogICAgICAgICAgICAgICAgaWYgKCFbMCwgMiwgNCwgNiwgOF0uaW5jbHVkZXMoYykpIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5YW155qE5L2N572u6ZmQ5Yi277ya6L+H5rKz5YmN5Y+q6IO95Zyo5YW15L2N5ZKM5YW15L2N5YmN5pa577yM6L+H5rKz5ZCO5pWM5pa55Y2K5Zy66YO95ZCI5rOVDQogICAgICAgICAgICBjb25zdCB2YWxpZFNvbGRpZXJQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgcmVkOiB7DQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWueWIneWni+WFteS9je+8mnI9MywgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbDogW1szLCAwXSwgWzMsIDJdLCBbMywgNF0sIFszLCA2XSwgWzMsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa55YW15L2N5YmN5pa577yacj00LCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBmb3J3YXJkOiBbWzQsIDBdLCBbNCwgMl0sIFs0LCA0XSwgWzQsIDZdLCBbNCwgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov4fmsrPnur/vvJpyPj01DQogICAgICAgICAgICAgICAgICAgIGNyb3NzZWRSaXZlcjogciA+PSA1DQogICAgICAgICAgICAgICAgfSwNCiAgICAgICAgICAgICAgICBibGFjazogew0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnliJ3lp4vlhbXkvY3vvJpyPTYsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGluaXRpYWw6IFtbNiwgMF0sIFs2LCAyXSwgWzYsIDRdLCBbNiwgNl0sIFs2LCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueWFteS9jeWJjeaWue+8mnI9NSwgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgZm9yd2FyZDogW1s1LCAwXSwgWzUsIDJdLCBbNSwgNF0sIFs1LCA2XSwgWzUsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+H5rKz57q/77yacjw9NA0KICAgICAgICAgICAgICAgICAgICBjcm9zc2VkUml2ZXI6IHIgPD0gNA0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICANCiAgICAgICAgICAgIGNvbnN0IHNvbGRpZXJJbmZvID0gdmFsaWRTb2xkaWVyUG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXTsNCiAgICAgICAgICAgIGNvbnN0IGlzSW5pdGlhbFBvcyA9IHNvbGRpZXJJbmZvLmluaXRpYWwuc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgICAgICBjb25zdCBpc0ZvcndhcmRQb3MgPSBzb2xkaWVySW5mby5mb3J3YXJkLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoc29sZGllckluZm8uY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgICAgICAgICAgLy8g6L+H5rKz5ZCO5pWM5pa55Y2K5Zy66YO95ZCI5rOVDQogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIOi/h+ays+WJjeWPquiDveWcqOWFteS9jeWSjOWFteS9jeWJjeaWuQ0KICAgICAgICAgICAgICAgIHJldHVybiBpc0luaXRpYWxQb3MgfHwgaXNGb3J3YXJkUG9zOw0KICAgICAgICAgICAgfQ0KICAgICAgICBkZWZhdWx0Og0KICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgfQ0KfTsNCg0KY29uc3QgY2hlY2tHYW1lU3RhdGUgPSAoYm9hcmQsIHR1cm4sIHBpZWNlc0luZm8gPSBudWxsLCBib2FyZEluZm8gPSBudWxsKSA9PiB7DQogICAgLy8g5LyY5YWI5L2/55So6aKE6K6h566X55qEZ2FtZVN0YXRlDQogICAgaWYgKGJvYXJkSW5mbyAmJiBib2FyZEluZm8uZ2FtZVN0YXRlKSB7DQogICAgICAgIHJldHVybiBib2FyZEluZm8uZ2FtZVN0YXRlOw0KICAgIH0NCiAgICANCiAgICAvLyDmsqHmnInpooTorqHnrpfnu5Pmnpzml7bvvIzmiafooYzljp/lp4vorqHnrpcNCiAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsNCiAgICBmb3IobGV0IHI9MDsgcjxST1dTOyByKyspIHsNCiAgICAgICAgZm9yKGxldCBjPTA7IGM8Q09MUzsgYysrKSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbcl1bY10/LmNvbG9yID09PSB0dXJuKSB7DQogICAgICAgICAgICAgICAgaWYgKGdldFZhbGlkTW92ZXMoYm9hcmQsIHtyLGN9KS5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmIChoYXNNb3ZlcykgYnJlYWs7DQogICAgfQ0KDQogICAgaWYgKGhhc01vdmVzKSByZXR1cm4geyBzdGF0dXM6ICdwbGF5aW5nJyB9Ow0KDQogICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2soYm9hcmQsIHR1cm4sIHBpZWNlc0luZm8sIGJvYXJkSW5mbyk7DQogICAgY29uc3Qgb3Bwb25lbnQgPSB0dXJuID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICANCiAgICBpZiAoaW5DaGVjaykgew0KICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfSBlbHNlIHsNCiAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgIH0NCn07DQoNCg0KDQovLyDlop7lvLrnmoTmuLjmiI/pmLbmrrXor4bliKsNCmNvbnN0IGdldEdhbWVQaGFzZSA9IChib2FyZCkgPT4gew0KICAvKg0KICBjb25zdCBwaWVjZUNvdW50ID0gY291bnRQaWVjZXMoYm9hcmQpOw0KICANCiAgaWYgKHBpZWNlQ291bnQgPD0gOCkgcmV0dXJuICdlbmRnYW1lJzsNCiAgaWYgKHBpZWNlQ291bnQgPD0gMTYpIHJldHVybiAnbWlkZGxlZ2FtZSc7DQogIHJldHVybiAnb3BlbmluZyc7DQogICovDQogIHJldHVybiAnb3BlbmluZyc7DQp9Ow0KDQovLyDliqjmgIHmnYPph43orqHnrpcNCmNvbnN0IGNhbGN1bGF0ZUR5bmFtaWNXZWlnaHRzID0gKHBoYXNlKSA9PiB7DQogIHN3aXRjaCAocGhhc2UpIHsNCiAgICBjYXNlICdvcGVuaW5nJzoNCiAgICAgIHJldHVybiB7IG1hdGVyaWFsOiA4LCBwb3NpdGlvbjogMiwgdGFjdGljOiA2LCBzYWZldHk6IDQsIG1vYmlsaXR5OiA3LCB0aHJlYXQ6IDMgfTsNCiAgICBjYXNlICdtaWRkbGVnYW1lJzoNCiAgICAgIHJldHVybiB7IG1hdGVyaWFsOiA2LCBwb3NpdGlvbjogOSwgdGFjdGljOiA3LCBzYWZldHk6IDYsIG1vYmlsaXR5OiA4LCB0aHJlYXQ6IDcgfTsNCiAgICBjYXNlICdlbmRnYW1lJzoNCiAgICAgIHJldHVybiB7IG1hdGVyaWFsOiA5LCBwb3NpdGlvbjogNywgdGFjdGljOiAyLCBzYWZldHk6IDgsIG1vYmlsaXR5OiA0LCB0aHJlYXQ6IDkgfTsNCiAgICBkZWZhdWx0Og0KICAgICAgcmV0dXJuIHsgbWF0ZXJpYWw6IDgsIHBvc2l0aW9uOiA1LCB0YWN0aWM6IDUsIHNhZmV0eTogNiwgbW9iaWxpdHk6IDUsIHRocmVhdDogNSB9Ow0KICB9DQp9Ow0KDQovLyDorqHnrpfmo4vlrZDmgLvmlbANCmNvbnN0IGNvdW50UGllY2VzID0gKGJvYXJkKSA9PiB7DQogIGxldCBjb3VudCA9IDA7DQogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgIGlmIChib2FyZFtyXVtjXSkgY291bnQrKzsNCiAgICB9DQogIH0NCiAgcmV0dXJuIGNvdW50Ow0KfTsNCg0KLy8g5a6e5L6L5YyWWm9icmlzdEhhc2hlcg0KY29uc3Qgem9icmlzdEhhc2hlciA9IG5ldyBab2JyaXN0SGFzaGVyKCk7DQoNCi8vIOe9ruaNouihqOWunueOsO+8iOWuuemHj+e6piAyXjIw77yM6YG/5YWNIE1hcCDov4flpKfmi5bmhaIgR0PvvIkNCmNsYXNzIFRyYW5zcG9zaXRpb25UYWJsZSB7DQogICAgY29uc3RydWN0b3Ioc2l6ZSA9IE1hdGgucG93KDIsIDIwKSkgew0KICAgICAgICB0aGlzLnRhYmxlID0gbmV3IE1hcCgpOw0KICAgICAgICB0aGlzLnNpemUgPSBzaXplOw0KICAgICAgICB0aGlzLmhhc2hlciA9IHpvYnJpc3RIYXNoZXI7DQogICAgICAgIC8vIOe7n+iuoeS/oeaBrw0KICAgICAgICB0aGlzLnN0YXRzID0gew0KICAgICAgICAgICAgaGl0czogMCwNCiAgICAgICAgICAgIG1pc3NlczogMCwNCiAgICAgICAgICAgIGV4YWN0SGl0czogMCwNCiAgICAgICAgICAgIGxvd2VyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgdXBwZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICBzdG9yZXM6IDAsDQogICAgICAgICAgICBscnVFdmljdGlvbnM6IDAsDQogICAgICAgICAgICBjbGVhcnM6IDANCiAgICAgICAgfTsNCiAgICB9DQogICAgDQogICAgc3RvcmUoa2V5LCBkZXB0aCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlID0gbnVsbCwgbW92ZVNlcXVlbmNlID0gbnVsbCkgew0KICAgICAgICBpZiAodGhpcy50YWJsZS5zaXplID49IHRoaXMuc2l6ZSkgew0KICAgICAgICAgICAgLy8g566A5Y2V55qETFJV562W55Wl77ya56e76Zmk56ys5LiA5Liq5YWD57SgDQogICAgICAgICAgICBjb25zdCBmaXJzdEtleSA9IHRoaXMudGFibGUua2V5cygpLm5leHQoKS52YWx1ZTsNCiAgICAgICAgICAgIHRoaXMudGFibGUuZGVsZXRlKGZpcnN0S2V5KTsNCiAgICAgICAgICAgIHRoaXMuc3RhdHMubHJ1RXZpY3Rpb25zKys7DQogICAgICAgIH0NCiAgICAgICAgdGhpcy50YWJsZS5zZXQoa2V5LCB7IGRlcHRoLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUsIG1vdmVTZXF1ZW5jZSB9KTsNCiAgICAgICAgdGhpcy5zdGF0cy5zdG9yZXMrKzsNCiAgICB9DQogICAgDQogICAgcmV0cmlldmUoa2V5KSB7DQogICAgICAgIGNvbnN0IGVudHJ5ID0gdGhpcy50YWJsZS5nZXQoa2V5KSB8fCBudWxsOw0KICAgICAgICBpZiAoZW50cnkpIHsNCiAgICAgICAgICAgIHRoaXMuc3RhdHMuaGl0cysrOw0KICAgICAgICAgICAgLy8g57uf6K6h5LiN5ZCM57G75Z6L55qE5ZG95LitDQogICAgICAgICAgICBzd2l0Y2ggKGVudHJ5LmZsYWcpIHsNCiAgICAgICAgICAgICAgICBjYXNlICdleGFjdCc6DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMuZXhhY3RIaXRzKys7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIGNhc2UgJ2xvd2VyYm91bmQnOg0KICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLmxvd2VyYm91bmRIaXRzKys7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIGNhc2UgJ3VwcGVyYm91bmQnOg0KICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLnVwcGVyYm91bmRIaXRzKys7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgdGhpcy5zdGF0cy5taXNzZXMrKzsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gZW50cnk7DQogICAgfQ0KICAgIA0KICAgIGNsZWFyKCkgew0KICAgICAgICB0aGlzLnRhYmxlLmNsZWFyKCk7DQogICAgICAgIHRoaXMuc3RhdHMuY2xlYXJzKys7DQogICAgfQ0KICAgIA0KICAgIC8vIOiOt+WPlue7n+iuoeS/oeaBr+W5tuiuoeeul+WRveS4reeOhw0KICAgIGdldFN0YXRzKCkgew0KICAgICAgICBjb25zdCB0b3RhbEFjY2Vzc2VzID0gdGhpcy5zdGF0cy5oaXRzICsgdGhpcy5zdGF0cy5taXNzZXM7DQogICAgICAgIGNvbnN0IGhpdFJhdGUgPSB0b3RhbEFjY2Vzc2VzID4gMCA/ICh0aGlzLnN0YXRzLmhpdHMgLyB0b3RhbEFjY2Vzc2VzICogMTAwKS50b0ZpeGVkKDIpIDogMDsNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIC4uLnRoaXMuc3RhdHMsDQogICAgICAgICAgICB0b3RhbEFjY2Vzc2VzLA0KICAgICAgICAgICAgaGl0UmF0ZSwNCiAgICAgICAgICAgIGN1cnJlbnRTaXplOiB0aGlzLnRhYmxlLnNpemUsDQogICAgICAgICAgICBtYXhTaXplOiB0aGlzLnNpemUsDQogICAgICAgICAgICBmaWxsUGVyY2VudGFnZTogKHRoaXMudGFibGUuc2l6ZSAvIHRoaXMuc2l6ZSAqIDEwMCkudG9GaXhlZCgyKQ0KICAgICAgICB9Ow0KICAgIH0NCiAgICANCiAgICAvLyDph43nva7nu5/orqHkv6Hmga8NCiAgICByZXNldFN0YXRzKCkgew0KICAgICAgICB0aGlzLnN0YXRzID0gew0KICAgICAgICAgICAgaGl0czogMCwNCiAgICAgICAgICAgIG1pc3NlczogMCwNCiAgICAgICAgICAgIGV4YWN0SGl0czogMCwNCiAgICAgICAgICAgIGxvd2VyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgdXBwZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICBzdG9yZXM6IDAsDQogICAgICAgICAgICBscnVFdmljdGlvbnM6IDAsDQogICAgICAgICAgICBjbGVhcnM6IDANCiAgICAgICAgfTsNCiAgICB9DQp9DQoNCi8vIOaAp+iDvee7n+iuoQ0KbGV0IHBlcmZTdGF0cyA9IHsNCiAgICBldmFsdWF0ZUJvYXJkQ291bnQ6IHsgcmVkOiAwLCBibGFjazogMCB9LA0KICAgIHByZXBhcmVTZWFyY2hJbmZvQ291bnQ6IHsgcmVkOiAwLCBibGFjazogMCB9LA0KICAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwNCiAgICBhbHBoYUJldGFDYWxsczogMCwgIC8vIOaAu+iwg+eUqOasoeaVsA0KICAgIG5vZGVzU2VhcmNoZWQ6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHmkJzntKLnmoToioLngrnmlbANCiAgICBtb3Zlc0dlbmVyYXRlZDoge30sIC8vIOaMiea3seW6pue7n+iuoeeUn+aIkOeahOi1sOazleaVsA0KICAgIGN1dG9mZnM6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHliarmnp3mrKHmlbANCiAgICAvLyDlkIjms5XmgKfot6/lvoTvvJrkvKrlkIjms5XnlJ/miJDph4/jgIHor5XotbDlkIjms5XmgKfmo4DmtYvjgIHpnZ7ms5Xot7Pov4fjgIHlrp7pmYXov5vlhaXmkJzntKLnmoTlkIjms5XnnYANCiAgICBwc2V1ZG9Nb3Zlc0dlbmVyYXRlZDogMCwNCiAgICBsZWdhbGl0eUNoZWNrczogMCwNCiAgICBpbGxlZ2FsTW92ZXNTa2lwcGVkOiAwLA0KICAgIGxlZ2FsTW92ZXNTZWFyY2hlZDogMCwNCiAgICAvLyBab2JyaXN077ya5YWo55uY6YeN566X5qyh5pWwIC8g5aKe6YeP5pu05paw5qyh5pWwIC8g5qCh6aqM5LiN5LiA6Ie077yI5LuFIHZlcmlmeSDmqKHlvI/vvIkNCiAgICBmdWxsSGFzaENvdW50OiAwLA0KICAgIGluY3JlbWVudGFsSGFzaFVwZGF0ZXM6IDAsDQogICAgaGFzaE1pc21hdGNoZXM6IDAsDQogICAgZXZhbHVhdGVCb2FyZE1zOiAwLA0KICAgIHByZXBhcmVTZWFyY2hJbmZvTXM6IDAsDQogICAgc3RhcnRUaW1lOiBEYXRlLm5vdygpDQp9Ow0KDQovLyDph43nva7nu5/orqHvvIjmr4/mrKHmkJzntKLlvIDlp4vml7bosIPnlKjvvIkNCmNvbnN0IHJlc2V0UGVyZlN0YXRzID0gKCkgPT4gew0KICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsNCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscyA9IDA7DQogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWQgPSB7fTsNCiAgICBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWQgPSB7fTsNCiAgICBwZXJmU3RhdHMuY3V0b2ZmcyA9IHt9Ow0KICAgIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCA9IDA7DQogICAgcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzID0gMDsNCiAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCA9IDA7DQogICAgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCA9IDA7DQogICAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQgPSAwOw0KICAgIHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzID0gMDsNCiAgICBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMgPSAwOw0KICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMgPSAwOw0KICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zID0gMDsNCiAgICBwZXJmU3RhdHMuc3RhcnRUaW1lID0gRGF0ZS5ub3coKTsNCn07DQoNCmNvbnN0IHNuYXBzaG90UGVyZlN0YXRzID0gKCkgPT4gew0KICAgIGNvbnN0IGVsYXBzZWQgPSBEYXRlLm5vdygpIC0gcGVyZlN0YXRzLnN0YXJ0VGltZTsNCiAgICBjb25zdCB0dFN0YXRzID0gdHJhbnNwb3NpdGlvblRhYmxlLmdldFN0YXRzKCk7DQogICAgY29uc3QgZGVwdGhzID0gT2JqZWN0LmtleXMocGVyZlN0YXRzLm5vZGVzU2VhcmNoZWQpLnNvcnQoKGEsIGIpID0+IE51bWJlcihhKSAtIE51bWJlcihiKSk7DQogICAgY29uc3QgYnlEZXB0aCA9IHt9Ow0KICAgIGZvciAoY29uc3QgZCBvZiBkZXB0aHMpIHsNCiAgICAgICAgYnlEZXB0aFtkXSA9IHsNCiAgICAgICAgICAgIG5vZGVzOiBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSB8fCAwLA0KICAgICAgICAgICAgbW92ZXM6IHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSB8fCAwLA0KICAgICAgICAgICAgY3V0b2ZmczogcGVyZlN0YXRzLmN1dG9mZnNbZF0gfHwgMA0KICAgICAgICB9Ow0KICAgIH0NCiAgICByZXR1cm4gew0KICAgICAgICBlbGFwc2VkTXM6IGVsYXBzZWQsDQogICAgICAgIGRlZmVyTGVnYWxpdHk6IFNFQVJDSF9ERUZFUl9MRUdBTElUWSwNCiAgICAgICAgaW5jcmVtZW50YWxab2JyaXN0OiBTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCwNCiAgICAgICAgbGVhZkF0dGFja0JpdHM6IFNFQVJDSF9MRUFGX0FUVEFDS19CSVRTLA0KICAgICAgICBldmFsdWF0ZUJvYXJkOiB7IC4uLnBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgfSwNCiAgICAgICAgcHJlcGFyZVNlYXJjaEluZm86IHsgLi4ucGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnQgfSwNCiAgICAgICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzOiB7IC4uLnBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudCB9LA0KICAgICAgICBhbHBoYUJldGFDYWxsczogcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzLA0KICAgICAgICBwc2V1ZG9Nb3Zlc0dlbmVyYXRlZDogcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkLA0KICAgICAgICBsZWdhbGl0eUNoZWNrczogcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzLA0KICAgICAgICBpbGxlZ2FsTW92ZXNTa2lwcGVkOiBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCwNCiAgICAgICAgbGVnYWxNb3Zlc1NlYXJjaGVkOiBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkLA0KICAgICAgICBmdWxsSGFzaENvdW50OiBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCwNCiAgICAgICAgaW5jcmVtZW50YWxIYXNoVXBkYXRlczogcGVyZlN0YXRzLmluY3JlbWVudGFsSGFzaFVwZGF0ZXMsDQogICAgICAgIGhhc2hNaXNtYXRjaGVzOiBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMsDQogICAgICAgIGV2YWx1YXRlQm9hcmRNczogcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcywNCiAgICAgICAgcHJlcGFyZVNlYXJjaEluZm9NczogcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvTXMsDQogICAgICAgIHR0OiB0dFN0YXRzLA0KICAgICAgICBieURlcHRoDQogICAgfTsNCn07DQoNCi8vIOaJk+WNsOe7n+iuoeS/oeaBrw0KY29uc3QgbG9nUGVyZlN0YXRzID0gKGN1cnJlbnRQbGF5ZXIpID0+IHsNCiAgICBjb25zdCBzbmFwID0gc25hcHNob3RQZXJmU3RhdHMoKTsNCiAgICBjb25zb2xlLmxvZyhg8J+TiiDmgKfog73nu5/orqEgKCR7Y3VycmVudFBsYXllcn0pIC0gJHtzbmFwLmVsYXBzZWRNc31tczpgKTsNCiAgICBjb25zb2xlLmxvZyhgICAgZXZhbHVhdGVCb2FyZDogcmVkPSR7c25hcC5ldmFsdWF0ZUJvYXJkLnJlZH0sIGJsYWNrPSR7c25hcC5ldmFsdWF0ZUJvYXJkLmJsYWNrfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBwcmVwYXJlU2VhcmNoSW5mbzogcmVkPSR7c25hcC5wcmVwYXJlU2VhcmNoSW5mby5yZWR9LCBibGFjaz0ke3NuYXAucHJlcGFyZVNlYXJjaEluZm8uYmxhY2t9YCk7DQogICAgY29uc29sZS5sb2coYCAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlczogcmVkPSR7c25hcC5jYWxjdWxhdGVUaHJlYXRWYWx1ZXMucmVkfSwgYmxhY2s9JHtzbmFwLmNhbGN1bGF0ZVRocmVhdFZhbHVlcy5ibGFja31gKTsNCiAgICBjb25zb2xlLmxvZyhgICAgYWxwaGFCZXRh6LCD55So5qyh5pWwOiAke3NuYXAuYWxwaGFCZXRhQ2FsbHN9YCk7DQogICAgY29uc29sZS5sb2coYCAgIOWQiOazleaApzogcHNldWRvPSR7c25hcC5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZH0sIGNoZWNrcz0ke3NuYXAubGVnYWxpdHlDaGVja3N9LCBpbGxlZ2FsU2tpcD0ke3NuYXAuaWxsZWdhbE1vdmVzU2tpcHBlZH0sIGxlZ2FsU2VhcmNoZWQ9JHtzbmFwLmxlZ2FsTW92ZXNTZWFyY2hlZH1gKTsNCiAgICBjb25zb2xlLmxvZyhgICAgWm9icmlzdDogaW5jcmVtZW50YWw9JHtzbmFwLmluY3JlbWVudGFsWm9icmlzdH0sIGZ1bGxIYXNoPSR7c25hcC5mdWxsSGFzaENvdW50fSwgaW5jclVwZGF0ZXM9JHtzbmFwLmluY3JlbWVudGFsSGFzaFVwZGF0ZXN9LCBtaXNtYXRjaGVzPSR7c25hcC5oYXNoTWlzbWF0Y2hlc31gKTsNCiAgICBjb25zb2xlLmxvZyhgICAgbGVhZkF0dGFja0JpdHM9JHtzbmFwLmxlYWZBdHRhY2tCaXRzfSBldmFsTXM9JHtNYXRoLnJvdW5kKHNuYXAuZXZhbHVhdGVCb2FyZE1zKX0gcHJlcGFyZU1zPSR7TWF0aC5yb3VuZChzbmFwLnByZXBhcmVTZWFyY2hJbmZvTXMpfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBUVDogaGl0cz0ke3NuYXAudHQuaGl0c30sIG1pc3Nlcz0ke3NuYXAudHQubWlzc2VzfSwgaGl0UmF0ZT0ke3NuYXAudHQuaGl0UmF0ZX0lLCBzdG9yZXM9JHtzbmFwLnR0LnN0b3Jlc30sIHNpemU9JHtzbmFwLnR0LmN1cnJlbnRTaXplfWApOw0KICAgIA0KICAgIGNvbnN0IGRlcHRocyA9IE9iamVjdC5rZXlzKHNuYXAuYnlEZXB0aCk7DQogICAgaWYgKGRlcHRocy5sZW5ndGggPiAwKSB7DQogICAgICAgIGNvbnNvbGUubG9nKCcgICDmjInmt7Hluqbnu5/orqE6Jyk7DQogICAgICAgIGZvciAoY29uc3QgZCBvZiBkZXB0aHMpIHsNCiAgICAgICAgICAgIGNvbnN0IHJvdyA9IHNuYXAuYnlEZXB0aFtkXTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICAgIOa3seW6piR7ZH06IOiKgueCuT0ke3Jvdy5ub2Rlc30sIOi1sOazlT0ke3Jvdy5tb3Zlc30sIOWJquaenT0ke3Jvdy5jdXRvZmZzfWApOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KY29uc3QgdHJhbnNwb3NpdGlvblRhYmxlID0gbmV3IFRyYW5zcG9zaXRpb25UYWJsZSgpOw0KDQovLyDlj7bor4TkvLDnvJPlrZjvvIjlrozmlbTlvaLlir/liIbvvInvvJvmr4/mrKEgZ2V0QmVzdE1vdmUg5riF56m6DQpjb25zdCBFVkFMX0NBQ0hFX01BWCA9IE1hdGgucG93KDIsIDE4KTsNCmNvbnN0IGV2YWxDYWNoZSA9IG5ldyBNYXAoKTsNCmNvbnN0IGNsZWFyRXZhbENhY2hlID0gKCkgPT4gew0KICAgIGV2YWxDYWNoZS5jbGVhcigpOw0KfTsNCg0KLy8g5Ymq5p6d5byA5YWz77ya5a6M5pW06K+E5Lyw5LiL6Iul5byA5bGA5Ye65bqf5qOL5YiZ5YWI5YWz77yM5L+d5qOL5Yqb5YaN6YeN5qCH5a6aDQpjb25zdCBTRUFSQ0hfRU5BQkxFX05NUCA9IGZhbHNlOw0KY29uc3QgU0VBUkNIX0VOQUJMRV9MTVIgPSBmYWxzZTsNCg0KLy8g552A5rOV5ZCI5rOV5oCn77yadHJ1ZT3mkJzntKLlhoXor5XotbDml7bmo4DmtYvvvIjlj6/ot7Pov4fliarmnp3mnKrop6blj4rnnYDms5XvvInvvJtmYWxzZT1wcmVwYXJlIOaXtuWFqOmHjyBmaWx0ZXJMZWdhbE1vdmVz77yI5pen6Lev5b6E77yJDQpsZXQgU0VBUkNIX0RFRkVSX0xFR0FMSVRZID0gdHJ1ZTsNCg0KLy8gWm9icmlzdC9UVO+8mnRydWU95pCc57Si5YaF5aKe6YeP57u05oqk5bGA6Z2i5ZOI5biMICsg5pWw5YC8IFRUIGtlee+8m2ZhbHNlPeavj+iKgueCueWFqOebmCBoYXNoICsg5a2X56ym5LiyIGtlee+8iOaXp+i3r+W+hO+8jOS+v+S6jiBBL0LvvIkNCmxldCBTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCA9IHRydWU7DQovLyDosIPor5XvvJrlop7ph4/lkI7kuI7lhajnm5ggaGFzaCDmr5Tlr7nvvIjku4XmoKHpqozohJrmnKzlvIDlkK/vvIzmraPlvI/mkJzntKLlhbPpl63vvIkNCmxldCBTRUFSQ0hfWk9CUklTVF9WRVJJRlkgPSBmYWxzZTsNCg0KLy8g5pCc57Si5ZCv5Y+R77ya5p2A5qOL6KGoICsg5Y6G5Y+y5ZCv5Y+R77yI5q+P5qyhIGdldEJlc3RNb3ZlIOmHjee9ru+8iQ0KbGV0IGtpbGxlck1vdmVzID0gW107DQpsZXQgaGlzdG9yeVRhYmxlID0gbnVsbDsNCg0KY29uc3QgcmVzZXRTZWFyY2hIZXVyaXN0aWNzID0gKG1heERlcHRoKSA9PiB7DQogICAga2lsbGVyTW92ZXMgPSBBcnJheShtYXhEZXB0aCArIDIpLmZpbGwobnVsbCkubWFwKCgpID0+IFtudWxsLCBudWxsXSk7DQogICAgaGlzdG9yeVRhYmxlID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogMTAgfSwgKCkgPT4NCiAgICAgICAgQXJyYXkuZnJvbSh7IGxlbmd0aDogOSB9LCAoKSA9Pg0KICAgICAgICAgICAgQXJyYXkuZnJvbSh7IGxlbmd0aDogMTAgfSwgKCkgPT4gQXJyYXkoOSkuZmlsbCgwKSkNCiAgICAgICAgKQ0KICAgICk7DQp9Ow0KDQpjb25zdCBpc1NhbWVNb3ZlID0gKGEsIGIpID0+DQogICAgYSAmJiBiICYmDQogICAgYS5mcm9tLnIgPT09IGIuZnJvbS5yICYmIGEuZnJvbS5jID09PSBiLmZyb20uYyAmJg0KICAgIGEudG8uciA9PT0gYi50by5yICYmIGEudG8uYyA9PT0gYi50by5jOw0KDQpjb25zdCBzdG9yZUtpbGxlck1vdmUgPSAoZGVwdGgsIG1vdmUpID0+IHsNCiAgICBpZiAoZGVwdGggPCAwIHx8IGRlcHRoID49IGtpbGxlck1vdmVzLmxlbmd0aCB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGNvbnN0IHNsb3QgPSBraWxsZXJNb3Zlc1tkZXB0aF07DQogICAgaWYgKGlzU2FtZU1vdmUoc2xvdFswXSwgbW92ZSkpIHJldHVybjsNCiAgICBzbG90WzFdID0gc2xvdFswXTsNCiAgICBzbG90WzBdID0geyBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiBtb3ZlLmZyb20uYyB9LCB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IG1vdmUudG8uYyB9IH07DQp9Ow0KDQpjb25zdCBhZGRIaXN0b3J5U2NvcmUgPSAobW92ZSwgZGVwdGgpID0+IHsNCiAgICBpZiAoIWhpc3RvcnlUYWJsZSB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGNvbnN0IHsgZnJvbSwgdG8gfSA9IG1vdmU7DQogICAgaGlzdG9yeVRhYmxlW2Zyb20ucl1bZnJvbS5jXVt0by5yXVt0by5jXSArPSBkZXB0aCAqIGRlcHRoOw0KfTsNCg0KY29uc3QgZ2V0SGlzdG9yeVNjb3JlID0gKG1vdmUpID0+IHsNCiAgICBpZiAoIWhpc3RvcnlUYWJsZSB8fCAhbW92ZSkgcmV0dXJuIDA7DQogICAgY29uc3QgeyBmcm9tLCB0byB9ID0gbW92ZTsNCiAgICByZXR1cm4gaGlzdG9yeVRhYmxlW2Zyb20ucl1bZnJvbS5jXVt0by5yXVt0by5jXSB8fCAwOw0KfTsNCg0KLy8gV29ya2VyIG1lc3NhZ2UgaGFuZGxpbmcNCmlmICh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcpIHsNCiAgICBzZWxmLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKGUpIHsNCiAgICBjb25zdCB7IHR5cGUsIHBheWxvYWQgfSA9IGUuZGF0YTsNCiAgICANCiAgICBzd2l0Y2ggKHR5cGUpIHsgICAgICAgICAgICANCiAgICAgICAgY2FzZSAnU0VBUkNIJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogc2VhcmNoQm9hcmQsIHR1cm46IHNlYXJjaFR1cm4sIGRlcHRoOiBzZWFyY2hEZXB0aCwgcmFuZG9tbmVzczogc2VhcmNoUmFuZG9tbmVzcywgZ2FtZUlkLCBvcGVuaW5nQm9va0VuYWJsZWQ6IHNlYXJjaE9wZW5pbmdCb29rRW5hYmxlZCA9IHRydWUsIHBseTogc2VhcmNoUGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0OiBzZWFyY2hFbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzOiBzZWFyY2hFeGFjdFJvb3RTY29yZXMgPSBmYWxzZSwgZGVmZXJMZWdhbGl0eTogc2VhcmNoRGVmZXJMZWdhbGl0eSwgaW5jcmVtZW50YWxab2JyaXN0OiBzZWFyY2hJbmNyZW1lbnRhbFpvYnJpc3QsIGxlYWZBdHRhY2tCaXRzOiBzZWFyY2hMZWFmQXR0YWNrQml0cywgem9icmlzdFZlcmlmeTogc2VhcmNoWm9icmlzdFZlcmlmeSB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoRGVmZXJMZWdhbGl0eSA9PT0gJ2Jvb2xlYW4nKSB7DQogICAgICAgICAgICAgICAgU0VBUkNIX0RFRkVSX0xFR0FMSVRZID0gc2VhcmNoRGVmZXJMZWdhbGl0eTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoSW5jcmVtZW50YWxab2JyaXN0ID09PSAnYm9vbGVhbicpIHsNCiAgICAgICAgICAgICAgICBTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCA9IHNlYXJjaEluY3JlbWVudGFsWm9icmlzdDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoTGVhZkF0dGFja0JpdHMgPT09ICdib29sZWFuJykgew0KICAgICAgICAgICAgICAgIFNFQVJDSF9MRUFGX0FUVEFDS19CSVRTID0gc2VhcmNoTGVhZkF0dGFja0JpdHM7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBTRUFSQ0hfWk9CUklTVF9WRVJJRlkgPSAhIXNlYXJjaFpvYnJpc3RWZXJpZnk7DQogICAgICAgICAgICAvLyBTZXQgb3BlbmluZyBib29rIGVuYWJsZWQgc3RhdHVzDQogICAgICAgICAgICBvcGVuaW5nQm9vay5zZXRFbmFibGVkKHNlYXJjaE9wZW5pbmdCb29rRW5hYmxlZCk7DQogICAgICAgICAgICAvLyDorrDlvZXmkJzntKLlvIDlp4vml7bpl7QNCiAgICAgICAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgICAgICAgICAgLy8g5omn6KGM5pCc57SiDQogICAgICAgICAgICBjb25zdCBiZXN0U2VhcmNoTW92ZSA9IGdldEJlc3RNb3ZlKHNlYXJjaEJvYXJkLCBzZWFyY2hUdXJuLCBzZWFyY2hEZXB0aCwgc2VhcmNoUmFuZG9tbmVzcywgc2VhcmNoUGx5LCBzZWFyY2hFbmFibGVUaW1lTGltaXQsIHNlYXJjaEV4YWN0Um9vdFNjb3Jlcyk7DQogICAgICAgICAgICAvLyDorrDlvZXmkJzntKLnu5PmnZ/ml7bpl7TlubborqHnrpfmgJ3ogIPml7bpl7QNCiAgICAgICAgICAgIGNvbnN0IGVuZFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKTsNCiAgICAgICAgICAgIGNvbnN0IHRoaW5raW5nVGltZSA9IGVuZFRpbWUgLSBzdGFydFRpbWU7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOajgOafpeaYr+WQpuadpeiHquW8gOWxgOW6kw0KICAgICAgICAgICAgY29uc3QgYm9va01vdmVTZWFyY2ggPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShzZWFyY2hCb2FyZCwgc2VhcmNoUGx5KTsNCiAgICAgICAgICAgIGNvbnN0IGZyb21Cb29rU2VhcmNoID0gISFib29rTW92ZVNlYXJjaCAmJiBKU09OLnN0cmluZ2lmeShib29rTW92ZVNlYXJjaCkgPT09IEpTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5re75Yqg5oCn6IO957uf6K6h5pel5b+XDQogICAgICAgICAgICBsb2dQZXJmU3RhdHMoc2VhcmNoVHVybik7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOa3u+WKoOaAneiAg+aXtumXtOaXpeW/lw0KICAgICAgICAgICAgY29uc29sZS5sb2coYFNlYXJjaCBjb21wbGV0ZWQgaW4gJHtNYXRoLnJvdW5kKHRoaW5raW5nVGltZSl9bXMsIGdhbWVJZD0ke2dhbWVJZH0sIGJlc3RNb3ZlPSR7SlNPTi5zdHJpbmdpZnkoYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmUpfSwgc2Vjb25kQmVzdE1vdmU9JHtKU09OLnN0cmluZ2lmeShiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZSl9LCBmcm9tQm9vaz0ke2Zyb21Cb29rU2VhcmNofWApOw0KICAgICAgICAgICAgLy8g5Y+R6YCB5pCc57Si57uT5p6c5ZKM5oCd6ICD5pe26Ze0DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ1NFQVJDSF9DT01QTEVURScsIA0KICAgICAgICAgICAgICAgIHBheWxvYWQ6IHsgDQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlOiBiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSwgDQogICAgICAgICAgICAgICAgICAgIHNlY29uZEJlc3RNb3ZlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZSwgDQogICAgICAgICAgICAgICAgICAgIGdhbWVJZCwgDQogICAgICAgICAgICAgICAgICAgIGZyb21Cb29rOiBmcm9tQm9va1NlYXJjaCwgDQogICAgICAgICAgICAgICAgICAgIHRoaW5raW5nVGltZTogTWF0aC5yb3VuZCh0aGlua2luZ1RpbWUpLCAvLyDlm5voiI3kupTlhaXliLDmr6vnp5INCiAgICAgICAgICAgICAgICAgICAgbW92ZVNlcXVlbmNlOiBiZXN0U2VhcmNoTW92ZS5tb3ZlU2VxdWVuY2UsDQogICAgICAgICAgICAgICAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kTW92ZVNlcXVlbmNlLA0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNjb3JlOiBiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZVNjb3JlLA0KICAgICAgICAgICAgICAgICAgICBzZWNvbmRCZXN0TW92ZVNjb3JlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZVNjb3JlLA0KICAgICAgICAgICAgICAgICAgICBhbGxNb3Zlc1dpdGhTY29yZXM6IGJlc3RTZWFyY2hNb3ZlLmFsbE1vdmVzV2l0aFNjb3JlcyB8fCBbXSwNCiAgICAgICAgICAgICAgICAgICAgY29tcGxldGVkRGVwdGg6IGJlc3RTZWFyY2hNb3ZlLmNvbXBsZXRlZERlcHRoLA0KICAgICAgICAgICAgICAgICAgICBwZXJmOiBzbmFwc2hvdFBlcmZTdGF0cygpDQogICAgICAgICAgICAgICAgfSANCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnZ2V0VmFsaWRNb3Zlcyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHZtQm9hcmQsIHBvczogdm1Qb3MgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBzeW5jR2VuZXJhbFBvc0NhY2hlKHZtQm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgdmFsaWRNb3ZlcyA9IGdldFZhbGlkTW92ZXModm1Cb2FyZCwgdm1Qb3MpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ3ZhbGlkTW92ZXMnLA0KICAgICAgICAgICAgICAgIG1vdmVzOiB2YWxpZE1vdmVzDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnZ2V0UGllY2VSZWxhdGlvbnMnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBwckJvYXJkLCBwb3M6IHByUG9zIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBwckJvYXJkW3ByUG9zLnJdW3ByUG9zLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDosIPnlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE5qOL5a2Q5L+h5oGv5ZKMYm9hcmRJbmZvDQogICAgICAgICAgICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZShwckJvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRFdmFsdWF0aW9uID0gZXZhbHVhdGVCb2FyZChwckJvYXJkLCBmYWxzZSwgbnVsbCwgMCwgbnVsbCwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlc0luZm8gPSBib2FyZEV2YWx1YXRpb24ucGllY2VzSW5mbzsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5ib2FyZEluZm87DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIGJvYXJkSW5mbyDmoLzlhoXlj6/og73mmK8gcGllY2VzSW5mbyDlvJXnlKjvvIznu5/kuIDmmKDlsITkuLoge3IsY30g5L6bIFVJIOS9v+eUqA0KICAgICAgICAgICAgY29uc3QgcmF3Q29udHJvbGxlcnMgPSBib2FyZEluZm9bcHJQb3Mucl1bcHJQb3MuY10gfHwgW107DQogICAgICAgICAgICBjb25zdCBjb250cm9sbGVycyA9IHJhd0NvbnRyb2xsZXJzLm1hcCgoY3RybCkgPT4gKHsgcjogY3RybC5yLCBjOiBjdHJsLmMgfSkpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBsZXQgcmVsYXRpb25zID0gew0KICAgICAgICAgICAgICAgIHRocmVhdDogW10sIA0KICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeTogW10sIA0KICAgICAgICAgICAgICAgIGd1YXJkOiBbXSwgDQogICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwgDQogICAgICAgICAgICAgICAgY29udHJvbDogW10sDQogICAgICAgICAgICAgICAgY29udHJvbGxlcnMNCiAgICAgICAgICAgIH07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOWmguaenOeCueWHu+eahOaYr+aji+WtkO+8jOi/lOWbnuivpeaji+WtkOeahOWFs+ezu+S/oeaBrw0KICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgY3VycmVudCBwaWVjZSBpbmZvDQogICAgICAgICAgICAgICAgY29uc3QgY3VycmVudFBpZWNlSW5mbyA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gcHJQb3MuciAmJiBwLmMgPT09IHByUG9zLmMpOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGllY2VJbmZvKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgcmVsYXRpb25zDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRocmVhdCA9IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0Lm1hcCh0aHJlYXRQaWVjZSA9PiAoeyByOiB0aHJlYXRQaWVjZS5yLCBjOiB0aHJlYXRQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGhyZWF0ZW5lZEJ5ID0gY3VycmVudFBpZWNlSW5mby50aHJlYXRlbmVkQnkubWFwKHRocmVhdGVuZWRCeVBpZWNlID0+ICh7IHI6IHRocmVhdGVuZWRCeVBpZWNlLnIsIGM6IHRocmVhdGVuZWRCeVBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBndWFyZCA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmQubWFwKGd1YXJkUGllY2UgPT4gKHsgcjogZ3VhcmRQaWVjZS5yLCBjOiBndWFyZFBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBndWFyZGVkQnkgPSBjdXJyZW50UGllY2VJbmZvLmd1YXJkZWRCeS5tYXAoZ3VhcmRlZEJ5UGllY2UgPT4gKHsgcjogZ3VhcmRlZEJ5UGllY2UuciwgYzogZ3VhcmRlZEJ5UGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2wgPSAoY3VycmVudFBpZWNlSW5mby5jb250cm9sIHx8IFtdKS5tYXAoY29udHJvbFBvcyA9PiAoeyByOiBjb250cm9sUG9zLnIsIGM6IGNvbnRyb2xQb3MuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICByZWxhdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQsIA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5LCANCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkLCANCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkZWRCeSwgDQogICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sLA0KICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbGxlcnMNCiAgICAgICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZVJlbGF0aW9ucycsDQogICAgICAgICAgICAgICAgcmVsYXRpb25zOiByZWxhdGlvbnMNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdjaGVja0dhbWVTdGF0ZSc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGNnc0JvYXJkLCB0dXJuOiBjZ3NUdXJuLCByZXF1ZXN0SWQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBnYW1lU3RhdGUgPSBjaGVja0dhbWVTdGF0ZShjZ3NCb2FyZCwgY2dzVHVybik7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAnZ2FtZVN0YXRlJywNCiAgICAgICAgICAgICAgICBzdGF0ZTogZ2FtZVN0YXRlLA0KICAgICAgICAgICAgICAgIHJlcXVlc3RJZA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2V2YWx1YXRlQm9hcmQnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBldmFsQm9hcmQsIHR1cm46IGV2YWxUdXJuLCBpc1JlcGxheSA9IGZhbHNlLCBkZXB0aCA9IDEgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICAvLyDmiZPljbDmjqXmlLbnmoTlj4LmlbANCiAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ2V2YWx1YXRlQm9hcmQgY2FsbGVkIHdpdGg6JywgeyB0dXJuOiBldmFsVHVybiwgaXNSZXBsYXksIGRlcHRoIH0pOw0KICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoZXZhbEJvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgY29uc3QgZGV0YWlsZWRFdmFsID0gZXZhbHVhdGVCb2FyZChldmFsQm9hcmQsIGlzUmVwbGF5LCBldmFsVHVybiwgZGVwdGgsIGV2YWxUdXJuLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2RldGFpbGVkRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZGV0YWlsZWRFdmFsDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQoNCiAgICAgICAgY2FzZSAnZXZhbHVhdGVQaWVjZSc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHBpZWNlRXZhbEJvYXJkLCBwb3M6IHBpZWNlRXZhbFBvcywgdHVybiB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gcGllY2VFdmFsQm9hcmRbcGllY2VFdmFsUG9zLnJdW3BpZWNlRXZhbFBvcy5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFwaWVjZSkgew0KICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogew0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiAwDQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQogICAgICAgICAgICBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDkuLvliqjosIPnlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE6K+E5Lyw5L+h5oGvDQogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5ri45oiP6Zi25q61DQogICAgICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UocGllY2VFdmFsQm9hcmQpOw0KICAgICAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgICAgIGNvbnN0IGJvYXJkRXZhbHVhdGlvbiA9IGV2YWx1YXRlQm9hcmQocGllY2VFdmFsQm9hcmQsIGZhbHNlLCB0dXJuLCAwLCB0dXJuLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIOS7jmV2YWx1YXRlQm9hcmTnmoTov5Tlm57lgLzkuK3mib7liLDlvZPliY3mo4vlrZDnmoTkv6Hmga8NCiAgICAgICAgICAgICAgICBjdXJyZW50UGllY2VJbmZvID0gYm9hcmRFdmFsdWF0aW9uLnBpZWNlc0luZm8uZmluZCgNCiAgICAgICAgICAgICAgICAgICAgcCA9PiBwLnIgPT09IHBpZWNlRXZhbFBvcy5yICYmIHAuYyA9PT0gcGllY2VFdmFsUG9zLmMNCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGllY2VJbmZvKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOW6lOeUqOadg+mHjeW5tui/lOWbnuWNleS4quaji+WtkOeahOivhOS8sOWAvA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBldmFsdWF0aW9uID0gew0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IGN1cnJlbnRQaWVjZUluZm8ubWF0ZXJpYWxWYWx1ZSAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogY3VycmVudFBpZWNlSW5mby5wb3NpdGlvblZhbHVlICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiBjdXJyZW50UGllY2VJbmZvLm1vYmlsaXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiBjdXJyZW50UGllY2VJbmZvLnRocmVhdFZhbHVlICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IGN1cnJlbnRQaWVjZUluZm8uc2FmZXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogY3VycmVudFBpZWNlSW5mby50YWN0aWNWYWx1ZSAqIFZBTFVFX1dFSUdIVFMudGFjdGljDQogICAgICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZXZhbHVhdGlvbg0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDlpoLmnpzku43nhLbmib7kuI3liLDmo4vlrZDkv6Hmga/vvIzov5Tlm57pu5jorqTlgLwNCiAgICAgICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMA0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnaXNDaGVjayc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGNCb2FyZCwgY29sb3I6IGNDb2xvciwgcmVxdWVzdElkIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgc3luY0dlbmVyYWxQb3NDYWNoZShjQm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2soY0JvYXJkLCBjQ29sb3IpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2NoZWNrJywNCiAgICAgICAgICAgICAgICBpc0NoZWNrOiBpbkNoZWNrLA0KICAgICAgICAgICAgICAgIHJlcXVlc3RJZA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2lzVmFsaWRQbGFjZW1lbnQnOiB7DQogICAgICAgICAgICBjb25zdCB7IHR5cGU6IGlwVHlwZSwgY29sb3I6IGlwQ29sb3IsIHIsIGMgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCB2YWxpZFBsYWNlbWVudCA9IGlzVmFsaWRQbGFjZW1lbnQoaXBUeXBlLCBpcENvbG9yLCByLCBjKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICd2YWxpZFBsYWNlbWVudCcsDQogICAgICAgICAgICAgICAgaXNWYWxpZDogdmFsaWRQbGFjZW1lbnQNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcnOiB7DQogICAgICAgICAgICBjb25zdCB7IG1vdmVzLCB3ZWlnaHRzIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgLy8gQWRkIHRoZSBvcGVuaW5nIGxpbmUgdG8gdGhlIG9wZW5pbmcgYm9vaw0KICAgICAgICAgICAgb3BlbmluZ0Jvb2suYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKFttb3Zlc10sIHdlaWdodHMpOw0KICAgICAgICAgICAgLy8gU2VuZCBjb25maXJtYXRpb24NCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnb3BlbmluZ0xpbmVBZGRlZCcsIA0KICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUgDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnbW92ZXNUb05vdGF0aW9uJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5IH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3Qgbm90YXRpb24gPSBvcGVuaW5nQm9vay5tb3Zlc1RvTm90YXRpb24oYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ25vdGF0aW9uJywgDQogICAgICAgICAgICAgICAgbm90YXRpb246IG5vdGF0aW9uIA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ25vdGF0aW9uVG9Nb3Zlcyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgbm90YXRpb246IG5vdGF0aW9uU3RyaW5nLCBpbml0aWFsQm9hcmQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBtb3Zlc0Zyb21Ob3RhdGlvbiA9IG9wZW5pbmdCb29rLm5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvblN0cmluZywgaW5pdGlhbEJvYXJkKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnbW92ZXMnLCANCiAgICAgICAgICAgICAgICBtb3ZlczogbW92ZXNGcm9tTm90YXRpb24gDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnc2V0VmFsdWVXZWlnaHRzJzogew0KICAgICAgICAgICAgVkFMVUVfV0VJR0hUUyA9IHsgLi4uVkFMVUVfV0VJR0hUUywgLi4ucGF5bG9hZCB9Ow0KICAgICAgICAgICAgY29uc29sZS5sb2coJ1VwZGF0ZWQgVkFMVUVfV0VJR0hUUzonLCBWQUxVRV9XRUlHSFRTKTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KICAgIC8vIE92ZXJyaWRlIGNvbnNvbGUubG9nIHRvIHNlbmQgbWVzc2FnZXMgYmFjayB0byBtYWluIHRocmVhZA0KICAgIGNvbnN0IG9yaWdpbmFsQ29uc29sZUxvZyA9IGNvbnNvbGUubG9nOw0KICAgIGNvbnNvbGUubG9nID0gZnVuY3Rpb24oLi4uYXJncykgew0KICAgICAgICAvLyBTZW5kIHRvIG1haW4gdGhyZWFkDQogICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgdHlwZTogJ2xvZycsDQogICAgICAgICAgICBkYXRhOiBhcmdzLmpvaW4oJyAnKQ0KICAgICAgICB9KTsNCiAgICAgICAgDQogICAgICAgIC8vIEFsc28gbG9nIHRvIHdvcmtlciBjb25zb2xlDQogICAgICAgIG9yaWdpbmFsQ29uc29sZUxvZy5hcHBseShjb25zb2xlLCBhcmdzKTsNCiAgICB9Ow0KfQ0KDQovLyDnqbrnnYDliarmnp3vvJrmnInov5vmlLvlrZDlipvml7bmiY3lhYHorrjvvIjpgb/lhY3lsIYv5aOrL+ixoeaui+WxgOmAvOedgOivr+WJqu+8iQ0KY29uc3QgY2FuRG9OdWxsTW92ZSA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKCFwIHx8IHAuY29sb3IgIT09IGNvbG9yKSBjb250aW51ZTsNCiAgICAgICAgICAgIGlmIChwLnR5cGUgPT09ICdjaGFyaW90JyB8fCBwLnR5cGUgPT09ICdob3JzZScgfHwgcC50eXBlID09PSAnY2Fubm9uJyB8fCBwLnR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiBmYWxzZTsNCn07DQoNCi8vIOaQnOe0oueUqCBUVCBrZXnvvJrlop7ph4/mqKHlvI/kuLogbnVtYmVy77yM5pen5qih5byP5Li6IGAke2hhc2h9OiR7c2lkZX1gIOWtl+espuS4sg0KY29uc3QgbWFrZVNlYXJjaFRUS2V5ID0gKGJvYXJkLCBjdXJyZW50UGxheWVyLCBib2FyZEhhc2gpID0+IHsNCiAgICBpZiAoU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QpIHsNCiAgICAgICAgcmV0dXJuIHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChib2FyZEhhc2gsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIH0NCiAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOw0KICAgIHJldHVybiBgJHt6b2JyaXN0SGFzaGVyLmhhc2goYm9hcmQpfToke2N1cnJlbnRQbGF5ZXJ9YDsNCn07DQoNCi8vIOi1sOWtkOWQjueahOWtkOiKgueCueWxgOmdouWTiOW4jO+8iOS7heWinumHj+aooeW8j+acieaEj+S5ie+8m+mhu+WcqCBtYWtlIOWJjeS/neWtmCBtb3ZpbmdQaWVjZe+8iQ0KY29uc3QgY2hpbGRCb2FyZEhhc2ggPSAoYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpID0+IHsNCiAgICBpZiAoIVNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUKSByZXR1cm4gYm9hcmRIYXNoOw0KICAgIHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzKys7DQogICAgcmV0dXJuIHpvYnJpc3RIYXNoZXIudXBkYXRlSGFzaChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7DQp9Ow0KDQpjb25zdCB2ZXJpZnlCb2FyZEhhc2ggPSAoYm9hcmQsIGV4cGVjdGVkSGFzaCkgPT4gew0KICAgIGlmICghU0VBUkNIX1pPQlJJU1RfVkVSSUZZKSByZXR1cm47DQogICAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsNCiAgICBjb25zdCBmdWxsID0gem9icmlzdEhhc2hlci5oYXNoKGJvYXJkKTsNCiAgICBpZiAoZnVsbCAhPT0gZXhwZWN0ZWRIYXNoKSB7DQogICAgICAgIHBlcmZTdGF0cy5oYXNoTWlzbWF0Y2hlcysrOw0KICAgIH0NCn07DQoNCi8vIOaQnOe0oueUqOWHgOWIhu+8muWujOaVtOW9ouWKv+ivhOS8sO+8iOWFs+ezuy/lqIHog4Ev5a6J5YWoL+acuuWKqO+8ie+8jOS7hei3s+i/h+e7iOWxgOedgOazleaemuS4vu+8m+W4piBab2JyaXN0IOe8k+WtmA0KY29uc3Qgc3RhdGljU2VhcmNoRXZhbCA9IChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGJvYXJkSGFzaCA9IDApID0+IHsNCiAgICBsZXQgY2FjaGVLZXk7DQogICAgaWYgKFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUKSB7DQogICAgICAgIGNhY2hlS2V5ID0gem9icmlzdEhhc2hlci5ldmFsQ2FjaGVLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsNCiAgICB9IGVsc2Ugew0KICAgICAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOw0KICAgICAgICBjYWNoZUtleSA9IHpvYnJpc3RIYXNoZXIuZXZhbENhY2hlS2V5KGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSk7DQogICAgfQ0KICAgIGlmIChldmFsQ2FjaGUuaGFzKGNhY2hlS2V5KSkgew0KICAgICAgICByZXR1cm4gZXZhbENhY2hlLmdldChjYWNoZUtleSk7DQogICAgfQ0KICAgIGNvbnN0IGV2YWxSZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGJvYXJkLCBmYWxzZSwgc2VhcmNoSW5pdGlhdG9yLCAwLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgeyBmb3JTZWFyY2hMZWFmOiB0cnVlIH0pOw0KICAgIGNvbnN0IG9wcG9uZW50ID0gc2VhcmNoSW5pdGlhdG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICBjb25zdCBuZXQgPSBldmFsUmVzdWx0W3NlYXJjaEluaXRpYXRvcl0udG90YWwgLSBldmFsUmVzdWx0W29wcG9uZW50XS50b3RhbDsNCiAgICBpZiAoZXZhbENhY2hlLnNpemUgPj0gRVZBTF9DQUNIRV9NQVgpIHsNCiAgICAgICAgLy8g566A5Y2V5reY5rGw5pyA5pep5YaZ5YWl55qE5LiA5om577yM6YG/5YWNIE1hcCDml6DpmZDmtqgNCiAgICAgICAgbGV0IGRyb3AgPSAwOw0KICAgICAgICBmb3IgKGNvbnN0IGsgb2YgZXZhbENhY2hlLmtleXMoKSkgew0KICAgICAgICAgICAgZXZhbENhY2hlLmRlbGV0ZShrKTsNCiAgICAgICAgICAgIGlmICgrK2Ryb3AgPj0gNDA5NikgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQogICAgZXZhbENhY2hlLnNldChjYWNoZUtleSwgbmV0KTsNCiAgICByZXR1cm4gbmV0Ow0KfTsNCg0KLy8g55Sf5oiQ5b2T5YmN5pa55ZCD5a2Q552A77yI5L6b6Z2Z6buY5pCc57Si77yJDQpjb25zdCBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoID0gKGJvYXJkLCBjdXJyZW50UGxheWVyKSA9PiB7DQogICAgY29uc3QgY2FwdHVyZXMgPSBbXTsNCiAgICBjb25zdCBkZWZlciA9IFNFQVJDSF9ERUZFUl9MRUdBTElUWTsNCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcGllY2UgfHwgcGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIGNvbnRpbnVlOw0KICAgICAgICAgICAgY29uc3QgcHNldWRvID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlKTsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCArPSBwc2V1ZG8ubGVuZ3RoOw0KICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IHBzZXVkbyA6IGZpbHRlckxlZ2FsTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSwgcHNldWRvKTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdXNlTW92ZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCB0byA9IHVzZU1vdmVzW2ldOw0KICAgICAgICAgICAgICAgIGlmIChib2FyZFt0by5yXVt0by5jXSkgew0KICAgICAgICAgICAgICAgICAgICBjYXB0dXJlcy5wdXNoKHsgZnJvbTogeyByLCBjIH0sIHRvIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICByZXR1cm4gY2FwdHVyZXM7DQp9Ow0KDQovLyDpnZnpu5jmkJzntKLvvJpzdGFuZC1wYXQg55So5a6M5pW05b2i5Yq/6K+E5Lyw77yb5LuF5a+55ZCD5a2Q5bu25Ly477yIUVPiiaQz77yJDQpjb25zdCBxdWllc2NlbmNlID0gKA0KICAgIGIsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLA0KICAgIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBxc0RlcHRoLCBib2FyZEhhc2ggPSAwDQopID0+IHsNCiAgICBjb25zdCBzdGFuZFBhdCA9IHN0YXRpY1NlYXJjaEV2YWwoYiwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGJvYXJkSGFzaCk7DQoNCiAgICBpZiAocXNEZXB0aCA8PSAwKSB7DQogICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgIH0NCg0KICAgIGlmIChtYXhpbWl6aW5nKSB7DQogICAgICAgIGlmIChzdGFuZFBhdCA+PSBiZXRhKSB7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoc3RhbmRQYXQgPiBhbHBoYSkgew0KICAgICAgICAgICAgYWxwaGEgPSBzdGFuZFBhdDsNCiAgICAgICAgfQ0KICAgIH0gZWxzZSB7DQogICAgICAgIGlmIChzdGFuZFBhdCA8PSBhbHBoYSkgew0KICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgIH0NCiAgICAgICAgaWYgKHN0YW5kUGF0IDwgYmV0YSkgew0KICAgICAgICAgICAgYmV0YSA9IHN0YW5kUGF0Ow0KICAgICAgICB9DQogICAgfQ0KDQogICAgbGV0IGNhcHR1cmVzID0gZ2VuZXJhdGVDYXB0dXJlc0ZvclNlYXJjaChiLCBjdXJyZW50UGxheWVyKTsNCiAgICBpZiAoY2FwdHVyZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgIH0NCg0KICAgIC8vIE1WVi1MVkHvvJrlhYjor5XlkIPlpKflrZANCiAgICBjYXB0dXJlcy5zb3J0KChhLCBiTW92ZSkgPT4gew0KICAgICAgICBjb25zdCBzY29yZUEgPQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW2EudG8ucl1bYS50by5jXSwgZ2FtZVN0YWdlKSAqIDE2IC0NCiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYlthLmZyb20ucl1bYS5mcm9tLmNdLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCBzY29yZUIgPQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW2JNb3ZlLnRvLnJdW2JNb3ZlLnRvLmNdLCBnYW1lU3RhZ2UpICogMTYgLQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW2JNb3ZlLmZyb20ucl1bYk1vdmUuZnJvbS5jXSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgcmV0dXJuIHNjb3JlQiAtIHNjb3JlQTsNCiAgICB9KTsNCg0KICAgIGxldCBiZXN0RXZhbCA9IHN0YW5kUGF0Ow0KICAgIGxldCBiZXN0TW92ZVNlcXVlbmNlID0gW107DQogICAgY29uc3QgZGVmZXIgPSBTRUFSQ0hfREVGRVJfTEVHQUxJVFk7DQoNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNhcHR1cmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBjYXB0dXJlc1tpXTsNCiAgICAgICAgY29uc3QgbW92aW5nUGllY2UgPSBiW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107DQogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZU1vdmUoYiwgbW92ZS5mcm9tLCBtb3ZlLnRvKTsNCiAgICAgICAgaWYgKGRlZmVyICYmIGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllcikpIHsNCiAgICAgICAgICAgIHVubWFrZU1vdmUoYiwgbW92ZS5mcm9tLCBtb3ZlLnRvLCBjYXB0dXJlZCk7DQogICAgICAgICAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCsrOw0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCiAgICAgICAgY29uc3QgbmV4dEhhc2ggPSBjaGlsZEJvYXJkSGFzaChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7DQogICAgICAgIHZlcmlmeUJvYXJkSGFzaChiLCBuZXh0SGFzaCk7DQogICAgICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQrKzsNCiAgICAgICAgY29uc3QgbmV4dFBsYXllciA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBjb25zdCBuZXh0TWF4aW1pemluZyA9IG5leHRQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgY29uc3QgcmVzdWx0ID0gcXVpZXNjZW5jZSgNCiAgICAgICAgICAgIGIsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBxc0RlcHRoIC0gMSwgbmV4dEhhc2gNCiAgICAgICAgKTsNCiAgICAgICAgdW5tYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8sIGNhcHR1cmVkKTsNCg0KICAgICAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlLCAuLi4ocmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGFscGhhKSB7DQogICAgICAgICAgICAgICAgYWxwaGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmUsIC4uLihyZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV07DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmV0YSkgew0KICAgICAgICAgICAgICAgIGJldGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UgfTsNCn07DQoNCi8vIGFscGhhQmV0Ye+8muivhOS8sOWni+e7iOS7jiBzZWFyY2hJbml0aWF0b3Ig6KeS5bqm77ybVFQgKyBraWxsZXIvaGlzdG9yeSArIOepuuedgOWJquaenSArIExNUiArIFFTDQovLyBib2FyZEhhc2jvvJrlop7ph48gWm9icmlzdCDlsYDpnaLlk4jluIzvvIjkuI3lkKvooYzmo4vmlrnvvInvvJvml6fmqKHlvI/kuIvlj6/kvKAgMA0KY29uc3QgYWxwaGFCZXRhID0gKA0KICAgIGIsIGQsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLA0KICAgIHNlYXJjaERlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gY3VycmVudFBsYXllciwgZ2FtZVN0YWdlID0gJ21pZCcsDQogICAgYWxsb3dOdWxsID0gdHJ1ZSwgYm9hcmRIYXNoID0gMA0KKSA9PiB7DQogICAgY29uc3Qgb3JpZ2luYWxBbHBoYSA9IGFscGhhOw0KICAgIGNvbnN0IG9yaWdpbmFsQmV0YSA9IGJldGE7DQoNCiAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMrKzsNCiAgICBpZiAoIXBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKSBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSA9IDA7DQogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0rKzsNCg0KICAgIC8vIOWPtuiKgueCue+8muWujOaVtOW9ouWKv+ivhOS8sCArIOWQg+WtkOmdmem7mOaQnOe0ou+8iFFT4omkM++8iQ0KICAgIGlmIChkID09PSAwKSB7DQogICAgICAgIHJldHVybiBxdWllc2NlbmNlKA0KICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgMywgYm9hcmRIYXNoDQogICAgICAgICk7DQogICAgfQ0KDQogICAgLy8g572u5o2i6KGo5o6i5rWL77yIa2V5IOWQq+ihjOaji+aWue+8jOmBv+WFjeWQjOW9ouS4jeWQjOi1sOaWueWGsueqge+8iQ0KICAgIGNvbnN0IHR0S2V5ID0gbWFrZVNlYXJjaFRUS2V5KGIsIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSGFzaCk7DQogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZSh0dEtleSk7DQogICAgbGV0IHR0TW92ZSA9IG51bGw7DQogICAgaWYgKHR0RW50cnkpIHsNCiAgICAgICAgdHRNb3ZlID0gdHRFbnRyeS5iZXN0TW92ZSB8fCBudWxsOw0KICAgICAgICBpZiAodHRFbnRyeS5kZXB0aCA+PSBkKSB7DQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnZXhhY3QnKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHR0RW50cnkudmFsdWUsDQogICAgICAgICAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogdHRFbnRyeS5tb3ZlU2VxdWVuY2UgfHwgKHR0TW92ZSA/IFt0dE1vdmVdIDogW10pDQogICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICdsb3dlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlID49IGJldGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ3VwcGVyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3Qgc2VhcmNoSW5mbyA9IHByZXBhcmVTZWFyY2hJbmZvKGIsIGN1cnJlbnRQbGF5ZXIsIGdhbWVTdGFnZSwgc2VhcmNoSW5pdGlhdG9yLCBkKTsNCiAgICBjb25zdCBhYlBpZWNlc0luZm8gPSBzZWFyY2hJbmZvLnBpZWNlc0luZm87DQogICAgY29uc3QgYWJCb2FyZEluZm8gPSBzZWFyY2hJbmZvLmJvYXJkSW5mbzsNCiAgICBjb25zdCBjdXJyZW50UGxheWVyQ29sb3IgPSBjdXJyZW50UGxheWVyOw0KICAgIGNvbnN0IGluQ2hlY2sgPSBzZWFyY2hJbmZvLmluQ2hlY2sgfHwNCiAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ3JlZCcgJiYgYWJCb2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fA0KICAgICAgICAgICAgICAgICAgICAoY3VycmVudFBsYXllckNvbG9yID09PSAnYmxhY2snICYmIGFiQm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKTsNCg0KICAgIGNvbnN0IHRlcm1pbmFsU2NvcmUgPSAobWF0ZUluQ2hlY2spID0+IHsNCiAgICAgICAgY29uc3QgaXNJbml0aWF0b3JXaW5uZXIgPSBjdXJyZW50UGxheWVyQ29sb3IgIT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgY29uc3QgYmFzZVNjb3JlID0gaXNJbml0aWF0b3JXaW5uZXIgPyAxMDAwMDAgOiAtMTAwMDAwOw0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgdmFsdWU6IGJhc2VTY29yZSArIChpc0luaXRpYXRvcldpbm5lciA/IGQgOiAoc2VhcmNoRGVwdGggLSBkKSksDQogICAgICAgICAgICBtb3ZlU2VxdWVuY2U6IFtdLA0KICAgICAgICAgICAgdGVybWluYWw6IG1hdGVJbkNoZWNrID8gJ2NoZWNrbWF0ZScgOiAnc3RhbGVtYXRlJw0KICAgICAgICB9Ow0KICAgIH07DQoNCiAgICAvLyDml6DkvKrlkIjms5XnnYDvvJrnm7TmjqXnu4jlsYDvvIjmnoHlsJHop4HvvJvpgJrluLjoh7PlsJHmnInlsIbnmoTotbDliqjvvIkNCiAgICBpZiAoIXNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdCB8fCBzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3QubGVuZ3RoID09PSAwKSB7DQogICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGFiQm9hcmRJbmZvLmdhbWVTdGF0ZTsNCiAgICAgICAgaWYgKGdhbWVTdGF0ZSAmJiAoZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ2NoZWNrbWF0ZScgfHwgZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ3N0YWxlbWF0ZScpKSB7DQogICAgICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGdhbWVTdGF0ZS53aW5uZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgICAgIGNvbnN0IGJhc2VTY29yZSA9IGlzSW5pdGlhdG9yV2lubmVyID8gMTAwMDAwIDogLTEwMDAwMDsNCiAgICAgICAgICAgIGNvbnN0IHN0ZXBzRnJvbVJvb3QgPSBzZWFyY2hEZXB0aCAtIGQ7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogYmFzZVNjb3JlICsgKGlzSW5pdGlhdG9yV2lubmVyID8gZCA6IHN0ZXBzRnJvbVJvb3QpLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIHRlcm1pbmFsU2NvcmUoaW5DaGVjayk7DQogICAgfQ0KDQogICAgLy8g56m6552A5Ymq5p6d77ya5LuFIG1heGltaXppbmfvvJvlrozmlbTor4TkvLDkuIvkv53lrojlkK/nlKgNCiAgICBpZiAoDQogICAgICAgIFNFQVJDSF9FTkFCTEVfTk1QICYmDQogICAgICAgIGFsbG93TnVsbCAmJg0KICAgICAgICBtYXhpbWl6aW5nICYmDQogICAgICAgIGQgPj0gMyAmJg0KICAgICAgICAhaW5DaGVjayAmJg0KICAgICAgICBjYW5Eb051bGxNb3ZlKGIsIGN1cnJlbnRQbGF5ZXJDb2xvcikNCiAgICApIHsNCiAgICAgICAgY29uc3QgbnVsbFIgPSBkID49IDYgPyAzIDogMjsNCiAgICAgICAgY29uc3QgbnVsbERlcHRoID0gZCAtIDEgLSBudWxsUjsNCiAgICAgICAgaWYgKG51bGxEZXB0aCA+PSAwKSB7DQogICAgICAgICAgICBjb25zdCBudWxsUGxheWVyID0gY3VycmVudFBsYXllckNvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgICAgIGNvbnN0IG51bGxNYXhpbWl6aW5nID0gbnVsbFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICAgICAgLy8g56m6552A5LiN5pS55Y+Y5bGA6Z2i5ZOI5biM77yM5LuF6KGM5qOL5pa55Y+Y5YyW77yIVFQga2V5IOWQqyBzaWRl77yJDQogICAgICAgICAgICBjb25zdCBudWxsUmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgICAgIGIsIG51bGxEZXB0aCwgYmV0YSAtIDFlLTYsIGJldGEsIG51bGxNYXhpbWl6aW5nLCBudWxsUGxheWVyLA0KICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgZmFsc2UsIGJvYXJkSGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIGlmIChudWxsUmVzdWx0LnZhbHVlID49IGJldGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogbnVsbFJlc3VsdC52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgbGV0IG1vdmVzID0gc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0Ow0KDQogICAgaWYgKCFwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0pIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSA9IDA7DQogICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdICs9IG1vdmVzLmxlbmd0aDsNCg0KICAgIGNvbnN0IGtpbGxlcnNBdERlcHRoID0gKGtpbGxlck1vdmVzW2RdIHx8IFtudWxsLCBudWxsXSk7DQogICAgbW92ZXMgPSBzb3J0TW92ZXMobW92ZXMsIGIsIGN1cnJlbnRQbGF5ZXJDb2xvciwgYWJQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGFiQm9hcmRJbmZvLCB7DQogICAgICAgIHR0TW92ZSwNCiAgICAgICAga2lsbGVyczoga2lsbGVyc0F0RGVwdGgNCiAgICB9KTsNCg0KICAgIGNvbnN0IHN0b3JlVFQgPSAodmFsdWUsIGJlc3RNb3ZlLCBtb3ZlU2VxdWVuY2UpID0+IHsNCiAgICAgICAgbGV0IGZsYWc7DQogICAgICAgIGlmICh2YWx1ZSA8PSBvcmlnaW5hbEFscGhhKSBmbGFnID0gJ3VwcGVyYm91bmQnOw0KICAgICAgICBlbHNlIGlmICh2YWx1ZSA+PSBvcmlnaW5hbEJldGEpIGZsYWcgPSAnbG93ZXJib3VuZCc7DQogICAgICAgIGVsc2UgZmxhZyA9ICdleGFjdCc7DQogICAgICAgIHRyYW5zcG9zaXRpb25UYWJsZS5zdG9yZSh0dEtleSwgZCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlLCBtb3ZlU2VxdWVuY2UpOw0KICAgIH07DQoNCiAgICBsZXQgYmVzdEV2YWwgPSBtYXhpbWl6aW5nID8gLUluZmluaXR5IDogSW5maW5pdHk7DQogICAgbGV0IGJlc3RNb3ZlID0gbnVsbDsNCiAgICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOw0KICAgIGxldCBsZWdhbE1vdmVzRm91bmQgPSAwOw0KDQogICAgZm9yIChsZXQgbW92ZUluZGV4ID0gMDsgbW92ZUluZGV4IDwgbW92ZXMubGVuZ3RoOyBtb3ZlSW5kZXgrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbbW92ZUluZGV4XTsNCiAgICAgICAgY29uc3QgaXNDYXB0dXJlID0gISFiW21vdmUudG8ucl1bbW92ZS50by5jXTsNCiAgICAgICAgY29uc3QgaXNUVE1vdmUgPSB0dE1vdmUgJiYgaXNTYW1lTW92ZShtb3ZlLCB0dE1vdmUpOw0KICAgICAgICBjb25zdCBpc0tpbGxlciA9DQogICAgICAgICAgICBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNBdERlcHRoWzBdKSB8fA0KICAgICAgICAgICAgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzQXREZXB0aFsxXSk7DQoNCiAgICAgICAgLy8gTE1S77ya6Z2g5ZCO55qE5a6J6Z2Z552A5rOV6ZmN5rexIDHvvIjlrozmlbTor4TkvLDkuIvkv53lrojvvIkNCiAgICAgICAgLy8gbW92ZUluZGV4IOWQq+S8quWQiOazleW6j++8m+mdnuazleedgOi3s+i/h+WQjueVpeWBj+S/neWuiO+8iOWwkemZjea3se+8ie+8jOS4jeW9seWTjeato+ehruaApw0KICAgICAgICBsZXQgcmVkdWN0aW9uID0gMDsNCiAgICAgICAgaWYgKA0KICAgICAgICAgICAgU0VBUkNIX0VOQUJMRV9MTVIgJiYNCiAgICAgICAgICAgIGQgPj0gNCAmJg0KICAgICAgICAgICAgbW92ZUluZGV4ID49IDQgJiYNCiAgICAgICAgICAgICFpbkNoZWNrICYmDQogICAgICAgICAgICAhaXNDYXB0dXJlICYmDQogICAgICAgICAgICAhaXNUVE1vdmUgJiYNCiAgICAgICAgICAgICFpc0tpbGxlcg0KICAgICAgICApIHsNCiAgICAgICAgICAgIHJlZHVjdGlvbiA9IDE7DQogICAgICAgIH0NCg0KICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXTsNCiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8pOw0KICAgICAgICBpZiAoU0VBUkNIX0RFRkVSX0xFR0FMSVRZICYmIGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllckNvbG9yKSkgew0KICAgICAgICAgICAgdW5tYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8sIGNhcHR1cmVkKTsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkKys7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgICAgdmVyaWZ5Qm9hcmRIYXNoKGIsIG5leHRIYXNoKTsNCiAgICAgICAgbGVnYWxNb3Zlc0ZvdW5kKys7DQogICAgICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQrKzsNCg0KICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KDQogICAgICAgIGxldCByZXN1bHQ7DQogICAgICAgIGlmIChyZWR1Y3Rpb24gPiAwKSB7DQogICAgICAgICAgICBjb25zdCByZWR1Y2VkRGVwdGggPSBNYXRoLm1heCgwLCBkIC0gMSAtIHJlZHVjdGlvbik7DQogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgcmVkdWNlZERlcHRoLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIGNvbnN0IG5lZWRSZXNlYXJjaCA9IG1heGltaXppbmcNCiAgICAgICAgICAgICAgICA/IHJlc3VsdC52YWx1ZSA+IGFscGhhDQogICAgICAgICAgICAgICAgOiByZXN1bHQudmFsdWUgPCBiZXRhOw0KICAgICAgICAgICAgaWYgKG5lZWRSZXNlYXJjaCkgew0KICAgICAgICAgICAgICAgIHJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHRydWUsIG5leHRIYXNoDQogICAgICAgICAgICApOw0KICAgICAgICB9DQoNCiAgICAgICAgdW5tYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8sIGNhcHR1cmVkKTsNCg0KICAgICAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOw0KICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgICAgICB9DQogICAgICAgICAgICBhbHBoYSA9IE1hdGgubWF4KGFscGhhLCByZXN1bHQudmFsdWUpOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA8IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOw0KICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgICAgICB9DQogICAgICAgICAgICBiZXRhID0gTWF0aC5taW4oYmV0YSwgcmVzdWx0LnZhbHVlKTsNCiAgICAgICAgfQ0KDQogICAgICAgIGlmIChiZXRhIDw9IGFscGhhKSB7DQogICAgICAgICAgICBpZiAoIXBlcmZTdGF0cy5jdXRvZmZzW2RdKSBwZXJmU3RhdHMuY3V0b2Zmc1tkXSA9IDA7DQogICAgICAgICAgICBwZXJmU3RhdHMuY3V0b2Zmc1tkXSsrOw0KICAgICAgICAgICAgaWYgKCFpc0NhcHR1cmUpIHsNCiAgICAgICAgICAgICAgICBzdG9yZUtpbGxlck1vdmUoZCwgbW92ZSk7DQogICAgICAgICAgICAgICAgYWRkSGlzdG9yeVNjb3JlKG1vdmUsIGQpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDlu7bov5/lkIjms5XmgKfvvJrkvKrlkIjms5XpnZ7nqbrkvYbml6DkuIDlkIjms5Ug4oaSIOWwhuatuy/lm7Dmr5kNCiAgICBpZiAoU0VBUkNIX0RFRkVSX0xFR0FMSVRZICYmIGxlZ2FsTW92ZXNGb3VuZCA9PT0gMCkgew0KICAgICAgICByZXR1cm4gdGVybWluYWxTY29yZShpbkNoZWNrKTsNCiAgICB9DQoNCiAgICBzdG9yZVRUKGJlc3RFdmFsLCBiZXN0TW92ZSwgYmVzdE1vdmVTZXF1ZW5jZSk7DQogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UgfTsNCn07DQoNCi8vIGV4YWN0Um9vdFNjb3JlczogdHJ1ZT1BbmFseXNpcyDlhajmoLnnsr7noa7liIbvvJtmYWxzZT3lr7nlvIjmoIflh4YgUFZT77yIZmFpbC1sb3cg5LiN5Zue5pCc77yJDQpjb25zdCBnZXRCZXN0TW92ZSA9IChib2FyZCwgdHVybiwgZGVwdGggPSA2LCByYW5kb21uZXNzID0gMCwgcGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0ID0gZmFsc2UsIGV4YWN0Um9vdFNjb3JlcyA9IGZhbHNlKSA9PiB7DQogIGNvbnN0IHRpbWVMaW1pdCA9IDUwMDA7DQoNCiAgLy8gRmlyc3QgdHJ5IHRvIGdldCBtb3ZlIGZyb20gb3BlbmluZyBib29rDQogIGNvbnN0IGJvb2tNb3ZlID0gb3BlbmluZ0Jvb2suZ2V0Qm9va01vdmUoYm9hcmQsIHBseSk7DQogIA0KICBpZiAoYm9va01vdmUpIHsNCiAgICAvLyBDaGVjayBpZiBib29rTW92ZSBpcyB2YWxpZCBmb3IgY3VycmVudCBib2FyZA0KICAgIGlmIChib29rTW92ZS5mcm9tICYmIGJvb2tNb3ZlLnRvICYmIA0KICAgICAgICB0eXBlb2YgYm9va01vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICB0eXBlb2YgYm9va01vdmUudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJvb2tNb3ZlLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICANCiAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYm9hcmRbYm9va01vdmUuZnJvbS5yXVtib29rTW92ZS5mcm9tLmNdOw0KICAgICAgDQogICAgICBpZiAobW92aW5nUGllY2UgJiYgbW92aW5nUGllY2UuY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgLy8gVmVyaWZ5IG1vdmUgaXMgdmFsaWQNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCBib29rTW92ZS5mcm9tKTsNCiAgICAgICAgY29uc3QgaXNWYWxpZCA9IHZhbGlkRGVzdGluYXRpb25zLnNvbWUoZGVzdCA9PiBkZXN0LnIgPT09IGJvb2tNb3ZlLnRvLnIgJiYgZGVzdC5jID09PSBib29rTW92ZS50by5jKTsNCiAgICAgICAgDQogICAgICAgIGlmIChpc1ZhbGlkKSB7DQogICAgICAgICAgcmV0dXJuIHsgYmVzdE1vdmU6IGJvb2tNb3ZlLCBzZWNvbmRCZXN0TW92ZTogbnVsbCwgbW92ZVNlcXVlbmNlOiBbXSwgc2Vjb25kTW92ZVNlcXVlbmNlOiBbXSwgYmVzdE1vdmVTY29yZTogMCwgc2Vjb25kQmVzdE1vdmVTY29yZTogMCwgYWxsTW92ZXNXaXRoU2NvcmVzOiBbXSB9Ow0KICAgICAgICB9DQogICAgICB9DQogICAgfQ0KICB9DQoNCiAgLy8g5qC56IqC54K577ya6L+t5Luj5Yqg5rexICsgUFZT77ybVFQva2lsbGVyL2hpc3Rvcnkg6Leo5rex5bqm5L+d55WZ77yI5LuF5byA5bGA5riF56m65LiA5qyh77yJDQogIHJlc2V0UGVyZlN0YXRzKCk7DQogIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7DQogIHRyYW5zcG9zaXRpb25UYWJsZS5yZXNldFN0YXRzKCk7DQogIHRyYW5zcG9zaXRpb25UYWJsZS5jbGVhcigpOw0KICBjbGVhckV2YWxDYWNoZSgpOw0KICBjb25zdCBtYXhEZXB0aCA9IE1hdGgubWF4KDEsIGRlcHRoIHwgMCk7DQogIHJlc2V0U2VhcmNoSGV1cmlzdGljcyhtYXhEZXB0aCk7DQogIHN5bmNHZW5lcmFsUG9zQ2FjaGUoYm9hcmQpOw0KDQogIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKGJvYXJkKTsNCiAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQoNCiAgY29uc3Qgcm9vdEV2YWxSZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGJvYXJkLCBmYWxzZSwgdHVybiwgMCwgdHVybiwgZ2FtZVN0YWdlKTsNCiAgY29uc3Qgcm9vdFBpZWNlc0luZm8gPSByb290RXZhbFJlc3VsdC5waWVjZXNJbmZvOw0KICBjb25zdCByb290Qm9hcmRJbmZvID0gcm9vdEV2YWxSZXN1bHQuYm9hcmRJbmZvOw0KDQogIC8vIOaUtumbhuagueiKgueCuei1sOazle+8iOWPquWBmuS4gOasoe+8ie+8m+acquiiq+WwhuaXtui/h+a7pOmAgeWQgw0KICBsZXQgcm9vdE1vdmVzID0gW107DQogIGNvbnN0IHJvb3RJbkNoZWNrID0gKHR1cm4gPT09ICdyZWQnICYmIHJvb3RCb2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fA0KICAgICAgICAgICAgICAgICAgICAgICh0dXJuID09PSAnYmxhY2snICYmIHJvb3RCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOw0KDQogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHIsIGMgfSk7DQogICAgICAgIHZhbGlkRGVzdGluYXRpb25zLmZvckVhY2godG8gPT4gew0KICAgICAgICAgIGNvbnN0IGlzQWNjZXB0YWJsZSA9IHJvb3RJbkNoZWNrIHx8IGlzUG9zaXRpb25BY2NlcHRhYmxlKGJvYXJkLCB7IHIsIGMgfSwgdG8sIHR1cm4sIHJvb3RCb2FyZEluZm8sIHJvb3RQaWVjZXNJbmZvLCBwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICBpZiAoaXNBY2NlcHRhYmxlKSB7DQogICAgICAgICAgICByb290TW92ZXMucHVzaCh7IGZyb206IHsgciwgYyB9LCB0bywgc2NvcmU6IDAsIG1vdmVTZXF1ZW5jZTogW10gfSk7DQogICAgICAgICAgfQ0KICAgICAgICB9KTsNCiAgICAgIH0NCiAgICB9DQogIH0NCg0KICBpZiAocm9vdE1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgIHJldHVybiB7DQogICAgICBiZXN0TW92ZTogbnVsbCwNCiAgICAgIHNlY29uZEJlc3RNb3ZlOiBudWxsLA0KICAgICAgbW92ZVNlcXVlbmNlOiBbXSwNCiAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogW10sDQogICAgICBiZXN0TW92ZVNjb3JlOiAwLA0KICAgICAgc2Vjb25kQmVzdE1vdmVTY29yZTogMCwNCiAgICAgIGFsbE1vdmVzV2l0aFNjb3JlczogW10NCiAgICB9Ow0KICB9DQoNCiAgY29uc3Qgc29ydFJvb3RNb3Zlc0J5U2NvcmUgPSAobW92ZXMpID0+IHsNCiAgICBtb3Zlcy5zb3J0KChhLCBiKSA9PiB7DQogICAgICBjb25zdCBzY29yZURpZmYgPSBiLnNjb3JlIC0gYS5zY29yZTsNCiAgICAgIGlmIChNYXRoLmFicyhzY29yZURpZmYpIDwgMWUtNikgew0KICAgICAgICBpZiAoYS5zY29yZSA+IDApIHsNCiAgICAgICAgICByZXR1cm4gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYi5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoYS5zY29yZSA8IDApIHsNCiAgICAgICAgICByZXR1cm4gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYS5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gMDsNCiAgICAgIH0NCiAgICAgIHJldHVybiBzY29yZURpZmY7DQogICAgfSk7DQogIH07DQoNCiAgY29uc3QgcHJvbW90ZVJvb3RNb3ZlID0gKG1vdmVzLCBwcmVmZXJyZWQpID0+IHsNCiAgICBpZiAoIXByZWZlcnJlZCkgcmV0dXJuOw0KICAgIGNvbnN0IGlkeCA9IG1vdmVzLmZpbmRJbmRleCgobSkgPT4gaXNTYW1lTW92ZShtLCBwcmVmZXJyZWQpKTsNCiAgICBpZiAoaWR4ID4gMCkgew0KICAgICAgY29uc3QgW2hpdF0gPSBtb3Zlcy5zcGxpY2UoaWR4LCAxKTsNCiAgICAgIG1vdmVzLnVuc2hpZnQoaGl0KTsNCiAgICB9DQogIH07DQoNCiAgY29uc3Qgd29ya0JvYXJkID0gYm9hcmQubWFwKChyb3cpID0+IFsuLi5yb3ddKTsNCiAgY29uc3QgTlVMTF9XSU5ET1dfRVBTID0gMWUtNjsNCiAgY29uc3QgbmV4dFR1cm4gPSB0dXJuID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgLy8g5qC55bGA6Z2i5ZOI5biM5Y+q566X5LiA5qyh77yb5aKe6YeP5qih5byP5pW05qO15pCc57Si5qCR55Sx5q2k5rS+55SfDQogIGNvbnN0IHJvb3RIYXNoID0gem9icmlzdEhhc2hlci5oYXNoKGJvYXJkKTsNCiAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsNCiAgY29uc3Qgcm9vdFRUS2V5ID0gU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QNCiAgICA/IHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChyb290SGFzaCwgdHVybikNCiAgICA6IGAke3Jvb3RIYXNofToke3R1cm59YDsNCg0KICBjb25zb2xlLmxvZygNCiAgICBgU3RhcnRpbmcgaXRlcmF0aXZlIGRlZXBlbmluZyB8IHR1cm46ICR7dHVybn0sIG1heERlcHRoOiAke21heERlcHRofSwgaW5jclpvYnJpc3Q6ICR7U0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1R9LCBsZWFmQXR0YWNrQml0czogJHtTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUU30sIHRpbWVMaW1pdDogJHt0aW1lTGltaXR9bXMsIGVuYWJsZVRpbWVMaW1pdDogJHtlbmFibGVUaW1lTGltaXR9YA0KICApOw0KDQogIGxldCBjb21wbGV0ZWREZXB0aCA9IDA7DQoNCiAgZm9yIChsZXQgY3VycmVudERlcHRoID0gMTsgY3VycmVudERlcHRoIDw9IG1heERlcHRoOyBjdXJyZW50RGVwdGgrKykgew0KICAgIGlmIChlbmFibGVUaW1lTGltaXQgJiYgY29tcGxldGVkRGVwdGggPiAwICYmIERhdGUubm93KCkgLSBzdGFydFRpbWUgPiB0aW1lTGltaXQpIHsNCiAgICAgIGNvbnNvbGUubG9nKGBJRCBzdG9wcGVkIGJlZm9yZSBkZXB0aCAke2N1cnJlbnREZXB0aH0gZHVlIHRvIHRpbWUgbGltaXQgKGxhc3QgY29tcGxldGVkPSR7Y29tcGxldGVkRGVwdGh9KWApOw0KICAgICAgYnJlYWs7DQogICAgfQ0KDQogICAgLy8g5rWF5bGC5pyA5L2z552AICsgVFQg552A5o6S5Yiw5pyA5YmN77yM5L6b5pys5bGCIFBWUyDnrKzkuIDnnYDlhajnqpfkvb/nlKgNCiAgICBjb25zdCB0dEVudHJ5ID0gdHJhbnNwb3NpdGlvblRhYmxlLnJldHJpZXZlKHJvb3RUVEtleSk7DQogICAgY29uc3QgdHRNb3ZlID0gdHRFbnRyeSAmJiB0dEVudHJ5LmJlc3RNb3ZlID8gdHRFbnRyeS5iZXN0TW92ZSA6IG51bGw7DQogICAgY29uc3QgcHJldkJlc3QgPSByb290TW92ZXNbMF07DQogICAgc29ydE1vdmVzKHJvb3RNb3ZlcywgYm9hcmQsIHR1cm4sIHJvb3RQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIHJvb3RCb2FyZEluZm8sIHsNCiAgICAgIHR0TW92ZSwNCiAgICAgIGtpbGxlcnM6IGtpbGxlck1vdmVzW01hdGgubWF4KDAsIGN1cnJlbnREZXB0aCAtIDEpXSB8fCBbbnVsbCwgbnVsbF0NCiAgICB9KTsNCiAgICAvLyDkuIrkuIDlsYLmnIDkvbPnnYDmlL7nrKzkuIDvvIjmnIDlkI4gcHJvbW90Ze+8ie+8jOS/neivgeacrOWxgiBQVlMg6aaW552A5YWo56qX5ZG95Lit54Ot6Lev5b6EDQogICAgcHJvbW90ZVJvb3RNb3ZlKHJvb3RNb3ZlcywgdHRNb3ZlKTsNCiAgICBwcm9tb3RlUm9vdE1vdmUocm9vdE1vdmVzLCBwcmV2QmVzdCk7DQoNCiAgICBjb25zdCB1c2VFeGFjdFJvb3QgPSBleGFjdFJvb3RTY29yZXMgJiYgY3VycmVudERlcHRoID09PSBtYXhEZXB0aDsNCiAgICBsZXQgcm9vdEFscGhhID0gLUluZmluaXR5Ow0KDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCByb290TW92ZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgIGNvbnN0IGl0ZW0gPSByb290TW92ZXNbaV07DQogICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IHdvcmtCb2FyZFtpdGVtLmZyb20ucl1baXRlbS5mcm9tLmNdOw0KICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlTW92ZSh3b3JrQm9hcmQsIGl0ZW0uZnJvbSwgaXRlbS50byk7DQogICAgICBjb25zdCBjaGlsZEhhc2ggPSBjaGlsZEJvYXJkSGFzaChyb290SGFzaCwgaXRlbSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgIHZlcmlmeUJvYXJkSGFzaCh3b3JrQm9hcmQsIGNoaWxkSGFzaCk7DQoNCiAgICAgIGxldCBhbHBoYUJldGFSZXN1bHQ7DQogICAgICBsZXQgc2NvcmVJc0V4YWN0ID0gdHJ1ZTsNCiAgICAgIGlmIChpID09PSAwIHx8IHJvb3RBbHBoYSA9PT0gLUluZmluaXR5KSB7DQogICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsIC1JbmZpbml0eSwgSW5maW5pdHksDQogICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoDQogICAgICAgICk7DQogICAgICB9IGVsc2Ugew0KICAgICAgICBjb25zdCBwcm9iZSA9IGFscGhhQmV0YSgNCiAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsDQogICAgICAgICAgcm9vdEFscGhhLCByb290QWxwaGEgKyBOVUxMX1dJTkRPV19FUFMsDQogICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoDQogICAgICAgICk7DQogICAgICAgIGlmIChwcm9iZS52YWx1ZSA+IHJvb3RBbHBoYSkgew0KICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwgcm9vdEFscGhhLCBJbmZpbml0eSwNCiAgICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICAgICk7DQogICAgICAgIH0gZWxzZSBpZiAodXNlRXhhY3RSb290KSB7DQogICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LA0KICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoDQogICAgICAgICAgKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAvLyBmYWlsLWxvd++8muaOoua1i+WIhuWPquaYr+S4iueVjO+8jOS4jeiDveW9k+eyvuehruWIhuWGmeWFpe+8iOWQpuWImSBJRCDkuIvlsYLmjpLluo/ooqvmsaHmn5PvvIzmmJPlj43lpI3otbDngq7vvIkNCiAgICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBwcm9iZTsNCiAgICAgICAgICBzY29yZUlzRXhhY3QgPSBmYWxzZTsNCiAgICAgICAgfQ0KICAgICAgfQ0KDQogICAgICB1bm1ha2VNb3ZlKHdvcmtCb2FyZCwgaXRlbS5mcm9tLCBpdGVtLnRvLCBjYXB0dXJlZCk7DQoNCiAgICAgIGlmIChzY29yZUlzRXhhY3QpIHsNCiAgICAgICAgaXRlbS5zY29yZSA9IGFscGhhQmV0YVJlc3VsdC52YWx1ZTsNCiAgICAgICAgaXRlbS5tb3ZlU2VxdWVuY2UgPSBbeyBmcm9tOiBpdGVtLmZyb20sIHRvOiBpdGVtLnRvIH0sIC4uLihhbHBoYUJldGFSZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV07DQogICAgICAgIGlmIChpdGVtLnNjb3JlID4gcm9vdEFscGhhKSB7DQogICAgICAgICAgcm9vdEFscGhhID0gaXRlbS5zY29yZTsNCiAgICAgICAgfQ0KICAgICAgfSBlbHNlIGlmIChpdGVtLnNjb3JlID4gcm9vdEFscGhhKSB7DQogICAgICAgIC8vIOS/neeVmeS4iuS4gOWxguWIhuaVsO+8m+iLpeS7jemrmOS6juW9k+WJjSDOse+8iOW8guW4uO+8ie+8jOeVpemZjeS7peWFjeaMpOaOieecn+acgOS8mA0KICAgICAgICBpdGVtLnNjb3JlID0gcm9vdEFscGhhIC0gMWUtMzsNCiAgICAgIH0NCiAgICB9DQoNCiAgICBzb3J0Um9vdE1vdmVzQnlTY29yZShyb290TW92ZXMpOw0KICAgIGNvbXBsZXRlZERlcHRoID0gY3VycmVudERlcHRoOw0KDQogICAgLy8g5oqK5pys5bGC5pyA5L2z552A5YaZ5YWlIFRU77yM5L6b5pu05rex5LiA5bGC5qC55o6S5bqPDQogICAgdHJhbnNwb3NpdGlvblRhYmxlLnN0b3JlKA0KICAgICAgcm9vdFRUS2V5LA0KICAgICAgY3VycmVudERlcHRoLA0KICAgICAgcm9vdE1vdmVzWzBdLnNjb3JlLA0KICAgICAgJ2V4YWN0JywNCiAgICAgIHJvb3RNb3Zlc1swXSwNCiAgICAgIHJvb3RNb3Zlc1swXS5tb3ZlU2VxdWVuY2UgfHwgW10NCiAgICApOw0KDQogICAgY29uc29sZS5sb2coDQogICAgICBgSUQgZGVwdGggJHtjdXJyZW50RGVwdGh9LyR7bWF4RGVwdGh9IGRvbmUgfCBiZXN0PSR7SlNPTi5zdHJpbmdpZnkocm9vdE1vdmVzWzBdLmZyb20pfS0+JHtKU09OLnN0cmluZ2lmeShyb290TW92ZXNbMF0udG8pfSBzY29yZT0ke3Jvb3RNb3Zlc1swXS5zY29yZX0gZWxhcHNlZD0ke0RhdGUubm93KCkgLSBzdGFydFRpbWV9bXNgDQogICAgKTsNCiAgfQ0KDQogIGNvbnN0IGJlc3RNb3ZlID0gcm9vdE1vdmVzWzBdIHx8IG51bGw7DQogIGNvbnN0IHNlY29uZEJlc3RNb3ZlID0gcm9vdE1vdmVzLmxlbmd0aCA+IDEgPyByb290TW92ZXNbMV0gOiBudWxsOw0KICBjb25zdCBiZXN0TW92ZVNlcXVlbmNlID0gYmVzdE1vdmUgPyAoYmVzdE1vdmUubW92ZVNlcXVlbmNlIHx8IFtdKSA6IFtdOw0KICBjb25zdCBzZWNvbmRNb3ZlU2VxdWVuY2UgPSBzZWNvbmRCZXN0TW92ZSA/IChzZWNvbmRCZXN0TW92ZS5tb3ZlU2VxdWVuY2UgfHwgW10pIDogW107DQogIGNvbnN0IGJlc3RNb3ZlU2NvcmUgPSBiZXN0TW92ZSA/IGJlc3RNb3ZlLnNjb3JlIDogMDsNCiAgY29uc3Qgc2Vjb25kQmVzdE1vdmVTY29yZSA9IHNlY29uZEJlc3RNb3ZlID8gc2Vjb25kQmVzdE1vdmUuc2NvcmUgOiAwOw0KDQogIGNvbnN0IGFsbE1vdmVzV2l0aFNjb3JlcyA9IHJvb3RNb3Zlcy5tYXAoKG1vdmVJbmZvKSA9PiAoew0KICAgIG1vdmU6IHsNCiAgICAgIGZyb206IG1vdmVJbmZvLmZyb20sDQogICAgICB0bzogbW92ZUluZm8udG8NCiAgICB9LA0KICAgIHNjb3JlOiBtb3ZlSW5mby5zY29yZSwNCiAgICBtb3ZlU2VxdWVuY2U6IG1vdmVJbmZvLm1vdmVTZXF1ZW5jZSB8fCBbXQ0KICB9KSk7DQoNCiAgcmV0dXJuIHsNCiAgICBiZXN0TW92ZSwNCiAgICBzZWNvbmRCZXN0TW92ZSwNCiAgICBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UsDQogICAgc2Vjb25kTW92ZVNlcXVlbmNlLA0KICAgIGJlc3RNb3ZlU2NvcmUsDQogICAgc2Vjb25kQmVzdE1vdmVTY29yZSwNCiAgICBhbGxNb3Zlc1dpdGhTY29yZXMsDQogICAgY29tcGxldGVkRGVwdGgNCiAgfTsNCn07DQoNCi8vIC0tLSBXT1JLRVIgTElTVEVORVIgKOe7n+S4gOa2iOaBr+WkhOeQhikgLS0tDQo=';
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
                                {(isAnalysisMode || (activeTab === 'game' && analysisMoves.length > 0)) && (
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

