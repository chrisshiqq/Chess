
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovCgovLyDmo4vnm5jluLjph4/lrprkuYkKY29uc3QgUk9XUyA9IDEwOwpjb25zdCBDT0xTID0gOTsKCi8vIOaji+WtkOexu+Wei+WumuS5iQpjb25zdCBQSUVDRV9UWVBFUyA9IHsKICAgIEdFTkVSQUw6ICdnZW5lcmFsJywKICAgIENIQVJJT1Q6ICdjaGFyaW90JywKICAgIENBTk5PTjogJ2Nhbm5vbicsCiAgICBIT1JTRTogJ2hvcnNlJywKICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLAogICAgQURWSVNPUjogJ2Fkdmlzb3InLAogICAgU09MRElFUjogJ3NvbGRpZXInCn07CgovLyDmnZDmlpnlgLzmnYPph43phY3nva4KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gewogICAgZ2VuZXJhbDogMTAwMDAsICAvLyDlsIYv5biFCiAgICBjaGFyaW90OiA5MDAsICAgICAvLyDovaYKICAgIGNhbm5vbjogewogICAgICAgIGVhcmx5OiA0NTAsICAgIC8vIOW8gOWxgOmYtuautQogICAgICAgIG1pZDogNDAwLCAgICAgIC8vIOS4reWxgOmYtuautQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQogICAgfSwgICAgICAgICAgICAgICAgLy8g54KuCiAgICBob3JzZTogewogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQogICAgICAgIG1pZDogNDUwLCAgICAgIC8vIOS4reWxgOmYtuautQogICAgICAgIGxhdGU6IDQ1MCAgICAgIC8vIOaui+WxgOmYtuautQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsCiAgICBlbGVwaGFudDogMjAwLCAgICAvLyDosaEv55u4CiAgICBhZHZpc29yOiAyMDAsICAgICAvLyDlo6sv5LuVCiAgICBzb2xkaWVyOiB7CiAgICAgICAgZWFybHk6IDEwMCwgICAgLy8g5byA5bGA6Zi25q61CiAgICAgICAgbWlkOiAyMDAsICAgICAgLy8g5Lit5bGA6Zi25q61CiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61CiAgICB9ICAgICAgICAgICAgICAgICAgLy8g5YW1L+WNkgp9OwoKLy8g5qOL5a2Q5Lu35YC85p2D6YeN6YWN572uCmxldCBWQUxVRV9XRUlHSFRTID0gewogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQogICAgLy9wb3NpdGlvbjogMC4yLCAgIC8vIOS9jee9ruWAvOadg+mHjQogICAgLy90aHJlYXQ6IDAuMTUsICAgIC8vIOWogeiDgeWAvOadg+mHjQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQogICAgLy9zYWZldHk6IDAuMSwgICAgIC8vIOWuieWFqOWAvOadg+mHjQogICAgLy9tb2JpbGl0eTogMC4wNSAgIC8vIOacuuWKqOWAvOadg+mHjQoKICAgIG1hdGVyaWFsOiAxLCAgICAvLyDmnZDmlpnlgLzmnYPph40KICAgIHBvc2l0aW9uOiAxLCAgICAvLyDkvY3nva7lgLzmnYPph40KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQogICAgdGFjdGljOiAxLCAgICAgIC8vIOaImOacr+WAvOadg+mHjQogICAgc2FmZXR5OiAxLCAgICAgIC8vIOWuieWFqOWAvOadg+mHjQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQp9OwoKLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XCmNvbnN0IEVWQUxVQVRJT05fUEFSQU1FVEVSUyA9IHsKICAgIC8vIOacuuWKqOWAvOWPguaVsAogICAgbW9iaWxpdHk6IHsKICAgICAgICBiYXNlTW92ZVZhbHVlOiAxLCAgICAgIC8vIOWfuuehgOenu+WKqOS7t+WAvAogICAgfSwKICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQogICAgY2hlY2s6IHsKICAgICAgICBib251czogODAKICAgIH0KfTsKCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rgpjb25zdCBQT1NJVElPTl9UQUJMRVMgPSB7CiAgICAvLyDlhbUv5Y2S5L2N572u6KGoICjnuqLmlrnop4bop5IpCiAgICBzb2xkaWVyOiBbCiAgICAgICAgWzAsIDUsIDEwLCAxNSwgMjAsIDE1LCAxMCwgNSwgMF0sCiAgICAgICAgWzUsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCA1XSwKICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sCiAgICAgICAgWzEwLCAxNSwgMjUsIDMwLCAzMCwgMzAsIDI1LCAxNSwgMTBdLAogICAgICAgIFsxMCwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDEwXSwKICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdCiAgICBdLAogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpCiAgICBjaGFyaW90OiBbCiAgICAgICAgWzUsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDEwLCA1XSwKICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLAogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwKICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLAogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwKICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLAogICAgICAgIFsxMCwgMTAsIDUsIDE1LCAwLCAxNSwgNSwgMTAsIDEwXSwKICAgICAgICBbMCwgMTAsIDUsIDUsIDUsIDUsIDEwLCA1LCAwXQogICAgXSwKICAgIC8vIOmprOS9jee9ruihqCAo57qi5pa56KeG6KeSKQogICAgaG9yc2U6IFsKICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwKICAgICAgICBbMCwgNSwgMjUsIDEwLCAxMCwgMTAsIDI1LCA1LCAwXSwKICAgICAgICBbNSwgNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCA1LCA1XSwKICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sCiAgICAgICAgWzAsIDUsIDE1LCAyMCwgMjAsIDIwLCAxNSwgNSwgMF0sCiAgICAgICAgWzAsIDUsIDI1LCAyMCwgMCwgMjAsIDI1LCA1LCAwXSwKICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwKICAgICAgICBbNSwgMCwgNSwgNSwgMCwgNSwgNSwgMCwgNV0sCiAgICAgICAgWzAsIDAsIDAsIDUsIC0yMCwgNSwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdCiAgICBdLAogICAgLy8g54Ku5L2N572u6KGoICjnuqLmlrnop4bop5IpCiAgICBjYW5ub246IFsKICAgICAgICBbMTAsIDIwLCAxNSwgMTAsIDAsIDEwLCAxNSwgMjAsIDEwXSwKICAgICAgICBbMCwgNSwgNSwgMTAsIDEwLCAxMCwgNSwgNSwgMF0sCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLAogICAgICAgIFs1LCA1LCAxNSwgNSwgMjUsIDUsIDE1LCA1LCA1XSwKICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLAogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwKICAgICAgICBbMTAsIDEwLCAxNSwgMjAsIDMwLCAyMCwgMTUsIDEwLCAxMF0sIAogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0KICAgIF0sCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikKICAgIGVsZXBoYW50OiBbCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0KICAgIF0sCiAgICAvLyDlo6vkvY3nva7ooaggKOe6ouaWueinhuinkikKICAgIGFkdmlzb3I6IFsKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAxMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0KICAgIF0KfTsKCi8vIOiOt+WPluaji+WtkOeahOadkOaWmeWAvApjb25zdCBnZXRNYXRlcmlhbFZhbHVlID0gKHBpZWNlLCBnYW1lU3RhZ2UgPSAnbWlkJykgPT4gewogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOwogICAgCiAgICAvLyDpkojlr7nmnInliIbpmLbmrrXmnZDmlpnlgLznmoTlhbXnp43vvIjlhbXjgIHngq7jgIHpqazvvInosIPmlbTmnZDmlpnlgLwKICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7CiAgICAgICAgdmFsdWUgPSB2YWx1ZVtnYW1lU3RhZ2VdIHx8IHZhbHVlLm1pZDsKICAgIH0KICAgIAogICAgcmV0dXJuIHZhbHVlOwp9OwoKLy8g6I635Y+W5qOL5a2Q55qE5L2N572u5YC8CmNvbnN0IGdldFBvc2l0aW9uVmFsdWUgPSAocGllY2UsIHIsIGMpID0+IHsKICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOwogICAgaWYgKCF0YWJsZSkgcmV0dXJuIDA7CiAgICAKICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqAogICAgY29uc3Qgcm93SWR4ID0gcGllY2UuY29sb3IgPT09ICdyZWQnID8gKDktIHIpIDogcjsKICAgIHJldHVybiB0YWJsZVtyb3dJZHhdW2NdIHx8IDA7Cn07CgovLyDmlLvlh7vkvY3lm77vvJo5MCDmoLznlKggM8OXVWludDMy44CC5pCc57Si5Y+25Y+q6ZyA44CM5piv5ZCm5pWM5o6n44CN77yb54K55qOLL1VJIOS7jeeUqOaOp+WItuiAheWIl+ihqOOAggpjb25zdCBBVFRBQ0tfV09SRFMgPSAzOwpjb25zdCBzY3JhdGNoUmVkQXR0YWNrID0gbmV3IFVpbnQzMkFycmF5KEFUVEFDS19XT1JEUyk7CmNvbnN0IHNjcmF0Y2hCbGFja0F0dGFjayA9IG5ldyBVaW50MzJBcnJheShBVFRBQ0tfV09SRFMpOwovLyB0cnVlPeaQnOe0ouWPtueUqOaUu+WHu+S9jeWbvu+8iOm7mOiupO+8ie+8m2ZhbHNlPeWPtuivhOS8sOS7jeW7uiAxMMOXOSDmjqfliLbogIXooajvvIhBL0LvvIkKbGV0IFNFQVJDSF9MRUFGX0FUVEFDS19CSVRTID0gdHJ1ZTsKLy8gdHJ1ZT3lhbPns7vnlKjmoLzkvY0gVWludDMyIOaUuy/lrogv5o6nIG1hc2vvvIjpu5jorqTvvInvvJtmYWxzZT10aHJlYXQvZ3VhcmQg5a+56LGh5YiX6KGo77yIQS9C77yJCmxldCBTRUFSQ0hfUkVMQVRJT05fTUFTS1MgPSB0cnVlOwoKY29uc3QgY2xlYXJBdHRhY2tCaXRzID0gKGJpdHMpID0+IHsKICAgIGJpdHNbMF0gPSAwOwogICAgYml0c1sxXSA9IDA7CiAgICBiaXRzWzJdID0gMDsKfTsKCmNvbnN0IHNldEF0dGFja0JpdCA9IChiaXRzLCBzcSkgPT4gewogICAgYml0c1tzcSA+Pj4gNV0gfD0gKDEgPDwgKHNxICYgMzEpKTsKfTsKCmNvbnN0IGhhc0F0dGFja0JpdCA9IChiaXRzLCBzcSkgPT4gKGJpdHNbc3EgPj4+IDVdICYgKDEgPDwgKHNxICYgMzEpKSkgIT09IDA7Cgpjb25zdCBtYWtlRW1wdHlDb250cm9sbGVyR3JpZCA9ICgpID0+CiAgICBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsKCi8vIOWFs+ezuyBtYXNr77ya5pyA5aSaIDMyIOWtkO+8iOS4reWbveixoeaji+a7oeebmO+8ie+8jGJpdCBpID0gcGllY2VzSW5mb1tpXQpjb25zdCBSRUxfU1FVQVJFUyA9IDkwOwpjb25zdCBzY3JhdGNoQXR0YWNrTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7ICAvLyDmlYzlrZDmiYDlnKjmoLzvvJrosIHlnKjmiZPlroMKY29uc3Qgc2NyYXRjaEd1YXJkTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7ICAgLy8g5Y+L5Yab5omA5Zyo5qC877ya6LCB5Zyo5L+d5a6DCmNvbnN0IHNjcmF0Y2hDb250cm9sTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7IC8vIOepuuaOp+agvO+8muiwgeaOp+WItuWug++8iOWvuem9kOaXpyBib2FyZEluZm/vvIkKCmNvbnN0IGNsZWFyUmVsYXRpb25NYXNrcyA9ICgpID0+IHsKICAgIHNjcmF0Y2hBdHRhY2tNYXNrLmZpbGwoMCk7CiAgICBzY3JhdGNoR3VhcmRNYXNrLmZpbGwoMCk7CiAgICBzY3JhdGNoQ29udHJvbE1hc2suZmlsbCgwKTsKfTsKCmNvbnN0IGxvd2VzdFNldEJpdEluZGV4ID0gKG1hc2spID0+IDMxIC0gTWF0aC5jbHozMihtYXNrICYgLW1hc2spOwoKY29uc3QgZm9yRWFjaFNldEJpdCA9IChtYXNrLCBmbikgPT4gewogICAgbGV0IG0gPSBtYXNrID4+PiAwOwogICAgd2hpbGUgKG0gIT09IDApIHsKICAgICAgICBjb25zdCBiaXQgPSBtICYgLW07CiAgICAgICAgZm4oMzEgLSBNYXRoLmNsejMyKGJpdCkpOwogICAgICAgIG0gXj0gYml0OwogICAgfQp9OwoKLy8g5Li76K+E5Lyw5Ye95pWwIC0g6K+m57uG6K+E5Lyw5qOL55uY5bGA5Yq/77yIVUkgLyDngrnmo4vlhbPns7sgLyDmkJzntKLlj7YgLyDmoLnoioLngrnvvIkKLy8gb3B0aW9ucy5mb3JTZWFyY2hMZWFmOiDku4Xot7Pov4fnu4jlsYAgZ2V0VmFsaWRNb3Zlc++8iOaXoOedgOW3suWcqOeItuiKgueCueWkhOeQhu+8ie+8m+WPr+eUqOaUu+WHu+S9jeWbvuS7o+abv+aOp+WItuiAheihqApjb25zdCBldmFsdWF0ZUJvYXJkID0gKGJvYXJkLCBpc1JlcGxheSA9IGZhbHNlLCBjdXJyZW50UGxheWVyID0gbnVsbCwgZGVwdGggPSAwLCBzZWFyY2hJbml0aWF0b3IgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJywgb3B0aW9ucyA9IG51bGwpID0+IHsKICAgIGNvbnN0IF9fdDAgPSBwZXJmb3JtYW5jZS5ub3coKTsKICAgIC8vIOe7n+iuoQogICAgaWYgKGN1cnJlbnRQbGF5ZXIpIHsKICAgICAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50W2N1cnJlbnRQbGF5ZXJdKys7CiAgICB9CiAgICBjb25zdCBmb3JTZWFyY2hMZWFmID0gISEob3B0aW9ucyAmJiBvcHRpb25zLmZvclNlYXJjaExlYWYpOwoKICAgIGNvbnN0IG91dHB1dFBoYXNlID0gZ2FtZVN0YWdlOwoKICAgIC8vIOmBjeWOhuaji+ebmO+8muWPquaUtumbhuWtkOWKmy9QU1TvvJvnnYDms5Ur5YWz57O757uf5LiA5ZyoIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zIOS4gOasoeWHoOS9leeUn+aIkO+8iOWvuem9kOeCru+8iQogICAgbGV0IHBpZWNlc0luZm8gPSBbXTsKICAgIGxldCByZWRNYXRlcmlhbCA9IDAsIHJlZFBvc2l0aW9uID0gMDsKICAgIGxldCBibGFja01hdGVyaWFsID0gMCwgYmxhY2tQb3NpdGlvbiA9IDA7CiAgICAKICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7CiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsKICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsKICAgICAgICAgICAgaWYgKCFwaWVjZSkgY29udGludWU7CiAgICAgICAgICAgIAogICAgICAgICAgICBjb25zdCBtYXRlcmlhbFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKTsKICAgICAgICAgICAgY29uc3QgcG9zaXRpb25WYWx1ZSA9IGdldFBvc2l0aW9uVmFsdWUocGllY2UsIHIsIGMpOwogICAgICAgICAgICAKICAgICAgICAgICAgaWYgKHBpZWNlLmNvbG9yID09PSAncmVkJykgewogICAgICAgICAgICAgICAgcmVkTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsKICAgICAgICAgICAgICAgIHJlZFBvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICBibGFja01hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7CiAgICAgICAgICAgICAgICBibGFja1Bvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7CiAgICAgICAgICAgICAgICBwaWVjZSwKICAgICAgICAgICAgICAgIHIsCiAgICAgICAgICAgICAgICBjLAogICAgICAgICAgICAgICAgcGllY2VJbmRleDogcGllY2VzSW5mby5sZW5ndGgsCiAgICAgICAgICAgICAgICBtb3ZlczogW10sCiAgICAgICAgICAgICAgICBhbGx5R3VhcmRzOiBbXSwKICAgICAgICAgICAgICAgIG1hdGVyaWFsVmFsdWUsCiAgICAgICAgICAgICAgICBwb3NpdGlvblZhbHVlLAogICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsCiAgICAgICAgICAgICAgICBzYWZldHlWYWx1ZTogMCwKICAgICAgICAgICAgICAgIHRhY3RpY1ZhbHVlOiAwLAogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogMCwKICAgICAgICAgICAgICAgIHRocmVhdDogW10sCiAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnk6IFtdLAogICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLAogICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwKICAgICAgICAgICAgICAgIGNvbnRyb2w6IFtdLAogICAgICAgICAgICAgICAgcHJvdGVjdDogW10KICAgICAgICAgICAgfSk7CiAgICAgICAgfQogICAgfQoKICAgIC8vIOWFs+ezuyBtYXNr77yI4omkMzIg5a2Q77yJ5LyY5YWI77yb5ZCm5YiZ5Zue6YCA5pen5YiX6KGoIC8g5Y+25pS75Ye75L2N5Zu+CiAgICBjb25zdCB1c2VSZWxhdGlvbk1hc2tzID0gU0VBUkNIX1JFTEFUSU9OX01BU0tTICYmIHBpZWNlc0luZm8ubGVuZ3RoIDw9IDMyOwogICAgY29uc3QgdXNlQXR0YWNrQml0cyA9ICF1c2VSZWxhdGlvbk1hc2tzICYmIGZvclNlYXJjaExlYWYgJiYgU0VBUkNIX0xFQUZfQVRUQUNLX0JJVFM7CiAgICBsZXQgYm9hcmRJbmZvOwogICAgaWYgKHVzZVJlbGF0aW9uTWFza3MpIHsKICAgICAgICBjbGVhclJlbGF0aW9uTWFza3MoKTsKICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaFJlZEF0dGFjayk7CiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7CiAgICAgICAgYm9hcmRJbmZvID0gewogICAgICAgICAgICB1c2VSZWxhdGlvbk1hc2tzOiB0cnVlLAogICAgICAgICAgICB1c2VBdHRhY2tCaXRzOiB0cnVlLAogICAgICAgICAgICBhdHRhY2tNYXNrOiBzY3JhdGNoQXR0YWNrTWFzaywKICAgICAgICAgICAgZ3VhcmRNYXNrOiBzY3JhdGNoR3VhcmRNYXNrLAogICAgICAgICAgICBjb250cm9sTWFzazogc2NyYXRjaENvbnRyb2xNYXNrLAogICAgICAgICAgICByZWRBdHRhY2s6IHNjcmF0Y2hSZWRBdHRhY2ssCiAgICAgICAgICAgIGJsYWNrQXR0YWNrOiBzY3JhdGNoQmxhY2tBdHRhY2sKICAgICAgICB9OwogICAgfSBlbHNlIGlmICh1c2VBdHRhY2tCaXRzKSB7CiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOwogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOwogICAgICAgIGJvYXJkSW5mbyA9IHsKICAgICAgICAgICAgdXNlQXR0YWNrQml0czogdHJ1ZSwKICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLAogICAgICAgICAgICBibGFja0F0dGFjazogc2NyYXRjaEJsYWNrQXR0YWNrCiAgICAgICAgfTsKICAgIH0gZWxzZSB7CiAgICAgICAgYm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsKICAgIH0KICAgIGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMoYm9hcmQsIHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGRlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRJbmZvLCBmb3JTZWFyY2hMZWFmKTsKICAgIAogICAgLy8g56ys5LiJ5q2l77ya6K6h566X5oC75YiG77yI5Y+q6K6h566X5Ymp5L2Z5YiG5pWw77yM5Z+656GA5YiG5pWw5bey5Zyo5qOL55uY6YGN5Y6G5pe26K6h566X77yJCiAgICBsZXQgcmVkVGhyZWF0ID0gMCwgcmVkVGFjdGljID0gMCwgcmVkU2FmZXR5ID0gMCwgcmVkTW9iaWxpdHkgPSAwOwogICAgbGV0IGJsYWNrVGhyZWF0ID0gMCwgYmxhY2tUYWN0aWMgPSAwLCBibGFja1NhZmV0eSA9IDAsIGJsYWNrTW9iaWxpdHkgPSAwOwogICAgCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgewogICAgICAgIGNvbnN0IHsgcGllY2UsIHRocmVhdFZhbHVlLCB0YWN0aWNWYWx1ZSwgc2FmZXR5VmFsdWUsIG1vYmlsaXR5VmFsdWUgfSA9IGluZm87CiAgICAgICAgCiAgICAgICAgaWYgKHBpZWNlLmNvbG9yID09PSAncmVkJykgewogICAgICAgICAgICByZWRUaHJlYXQgKz0gdGhyZWF0VmFsdWU7CiAgICAgICAgICAgIHJlZFRhY3RpYyArPSB0YWN0aWNWYWx1ZTsKICAgICAgICAgICAgcmVkU2FmZXR5ICs9IHNhZmV0eVZhbHVlOwogICAgICAgICAgICByZWRNb2JpbGl0eSArPSBtb2JpbGl0eVZhbHVlOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGJsYWNrVGhyZWF0ICs9IHRocmVhdFZhbHVlOwogICAgICAgICAgICBibGFja1RhY3RpYyArPSB0YWN0aWNWYWx1ZTsKICAgICAgICAgICAgYmxhY2tTYWZldHkgKz0gc2FmZXR5VmFsdWU7CiAgICAgICAgICAgIGJsYWNrTW9iaWxpdHkgKz0gbW9iaWxpdHlWYWx1ZTsKICAgICAgICB9CiAgICB9CiAgICAKICAgIC8vIOiuoeeul+WxgOWKv+aAu+WIhgogICAgY29uc3QgcmVkVG90YWwgPSAKICAgICAgICByZWRNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwgKwogICAgICAgIHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArCiAgICAgICAgcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKwogICAgICAgIHJlZFRhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljICsKICAgICAgICByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArCiAgICAgICAgcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5OyAKICAgIAogICAgY29uc3QgYmxhY2tUb3RhbCA9IAogICAgICAgIGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsKICAgICAgICBibGFja1Bvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArCiAgICAgICAgYmxhY2tUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArCiAgICAgICAgYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArCiAgICAgICAgYmxhY2tTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArCiAgICAgICAgYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7CiAgICAKICAgIC8vIOi/lOWbnuivpue7huivhOS8sOe7k+aenAogICAgY29uc3QgX19ldmFsUmVzdWx0ID0gewogICAgICAgIHJlZDogewogICAgICAgICAgICB0b3RhbDogcmVkVG90YWwsCiAgICAgICAgICAgIG1hdGVyaWFsOiByZWRNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsCiAgICAgICAgICAgIHBvc2l0aW9uOiByZWRQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sCiAgICAgICAgICAgIHRocmVhdDogcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQsCiAgICAgICAgICAgIHRhY3RpYzogcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMsCiAgICAgICAgICAgIHNhZmV0eTogcmVkU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHksCiAgICAgICAgICAgIG1vYmlsaXR5OiByZWRNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksCiAgICAgICAgICAgIHBoYXNlOiBvdXRwdXRQaGFzZSwKICAgICAgICAgICAgd2VpZ2h0czogewogICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAuNCwKICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLjIsCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwKICAgICAgICAgICAgICAgIHNhZmV0eTogMC4xLAogICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAuMDUsCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUKICAgICAgICAgICAgfQogICAgICAgIH0sCiAgICAgICAgYmxhY2s6IHsKICAgICAgICAgICAgdG90YWw6IGJsYWNrVG90YWwsCiAgICAgICAgICAgIG1hdGVyaWFsOiBibGFja01hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwKICAgICAgICAgICAgcG9zaXRpb246IGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLAogICAgICAgICAgICB0aHJlYXQ6IGJsYWNrVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQsCiAgICAgICAgICAgIHRhY3RpYzogYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYywKICAgICAgICAgICAgc2FmZXR5OiBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LAogICAgICAgICAgICBtb2JpbGl0eTogYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksCiAgICAgICAgICAgIHBoYXNlOiBvdXRwdXRQaGFzZSwKICAgICAgICAgICAgd2VpZ2h0czogewogICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAuNCwKICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLjIsCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwKICAgICAgICAgICAgICAgIHNhZmV0eTogMC4xLAogICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAuMDUsCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUKICAgICAgICAgICAgfQogICAgICAgIH0sCiAgICAgICAgcGllY2VzSW5mbzogcGllY2VzSW5mbywKICAgICAgICBnYW1lU3RhZ2U6IGdhbWVTdGFnZSwKICAgICAgICBib2FyZEluZm86IGJvYXJkSW5mbwogICAgfTsKICAgIGlmICh0eXBlb2YgcGVyZlN0YXRzICE9PSAndW5kZWZpbmVkJyAmJiBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zICE9IG51bGwpIHsKICAgICAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsKICAgIH0KICAgIHJldHVybiBfX2V2YWxSZXN1bHQ7Cn07CgovLyDlsIYv5biF5L2N572u57yT5a2Y77ya5L6bIHBvc3QtbW92ZSBpc0NoZWNrIC8g6aOe5bCG5b+r6YCf5p+l6K+i77yM55SxIG1ha2UvdW5tYWtlIOe7tOaKpApsZXQgZ2VuZXJhbFBvc0NhY2hlID0geyByZWQ6IG51bGwsIGJsYWNrOiBudWxsIH07CgovLyDlsIbluIXku4XlnKjkuZ3lrqvlhoXvvIzmjInkuZ3lrqvmiavmj4/ljbPlj68KY29uc3QgZmluZEdlbmVyYWxQb3MgPSAoYm9hcmQsIGNvbG9yKSA9PiB7CiAgICBjb25zdCByb3dTdGFydCA9IGNvbG9yID09PSAncmVkJyA/IDAgOiA3OwogICAgY29uc3Qgcm93RW5kID0gY29sb3IgPT09ICdyZWQnID8gMiA6IDk7CiAgICBmb3IgKGxldCByID0gcm93U3RhcnQ7IHIgPD0gcm93RW5kOyByKyspIHsKICAgICAgICBmb3IgKGxldCBjID0gMzsgYyA8PSA1OyBjKyspIHsKICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICBpZiAocCAmJiBwLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBwLmNvbG9yID09PSBjb2xvcikgewogICAgICAgICAgICAgICAgcmV0dXJuIHsgciwgYyB9OwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQogICAgcmV0dXJuIG51bGw7Cn07Cgpjb25zdCBzeW5jR2VuZXJhbFBvc0NhY2hlID0gKGJvYXJkKSA9PiB7CiAgICBnZW5lcmFsUG9zQ2FjaGUucmVkID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsICdyZWQnKTsKICAgIGdlbmVyYWxQb3NDYWNoZS5ibGFjayA9IGZpbmRHZW5lcmFsUG9zKGJvYXJkLCAnYmxhY2snKTsKfTsKCmNvbnN0IGdldEdlbmVyYWxQb3MgPSAoYm9hcmQsIGNvbG9yKSA9PiB7CiAgICBjb25zdCBjYWNoZWQgPSBnZW5lcmFsUG9zQ2FjaGVbY29sb3JdOwogICAgaWYgKGNhY2hlZCkgewogICAgICAgIGNvbnN0IHAgPSBib2FyZFtjYWNoZWQucl0/LltjYWNoZWQuY107CiAgICAgICAgaWYgKHAgJiYgcC50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5jb2xvciA9PT0gY29sb3IpIHsKICAgICAgICAgICAgcmV0dXJuIGNhY2hlZDsKICAgICAgICB9CiAgICB9CiAgICBjb25zdCBwb3MgPSBmaW5kR2VuZXJhbFBvcyhib2FyZCwgY29sb3IpOwogICAgZ2VuZXJhbFBvc0NhY2hlW2NvbG9yXSA9IHBvczsKICAgIHJldHVybiBwb3M7Cn07CgovLyDmkJzntKLnlKjljp/lnLDotbDlrZAgLyDmgaLlpI3vvIjpgb/lhY3mr4/mrKHpgJLlvZIgYm9hcmQubWFw77yJ77yb5ZCM5q2l57u05oqk5bCG5L2N57yT5a2YCmNvbnN0IG1ha2VNb3ZlID0gKGJvYXJkLCBmcm9tLCB0bykgPT4gewogICAgY29uc3QgcGllY2UgPSBib2FyZFtmcm9tLnJdW2Zyb20uY107CiAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW3RvLnJdW3RvLmNdOwogICAgYm9hcmRbdG8ucl1bdG8uY10gPSBwaWVjZTsKICAgIGJvYXJkW2Zyb20ucl1bZnJvbS5jXSA9IG51bGw7CiAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogdG8uciwgYzogdG8uYyB9OwogICAgfQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgewogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSBudWxsOwogICAgfQogICAgcmV0dXJuIGNhcHR1cmVkOwp9OwoKY29uc3QgdW5tYWtlTW92ZSA9IChib2FyZCwgZnJvbSwgdG8sIGNhcHR1cmVkKSA9PiB7CiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOwogICAgYm9hcmRbZnJvbS5yXVtmcm9tLmNdID0gcGllY2U7CiAgICBib2FyZFt0by5yXVt0by5jXSA9IGNhcHR1cmVkOwogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgewogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtwaWVjZS5jb2xvcl0gPSB7IHI6IGZyb20uciwgYzogZnJvbS5jIH07CiAgICB9CiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IHsgcjogdG8uciwgYzogdG8uYyB9OwogICAgfQp9OwoKLy8g6LWw5a2Q5ZCO5piv5ZCm5L2/5bex5pa55bCG5LiN5a6J5YWo77yI6aOe5bCG5oiW6KKr5bCG77yJ44CC6LCD55So5YmN6aG75beyIG1ha2VNb3Zl44CCCmNvbnN0IGxlYXZlc093bktpbmdVbnNhZmUgPSAoYm9hcmQsIGNvbG9yKSA9PiB7CiAgICBwZXJmU3RhdHMubGVnYWxpdHlDaGVja3MrKzsKICAgIHJldHVybiBpc0ZseWluZ0dlbmVyYWwoYm9hcmQpIHx8IGlzQ2hlY2tSYXcoYm9hcmQsIGNvbG9yKTsKfTsKCi8vIOS7juS8quWQiOazleedgOazleS4rei/h+a7pOWHuuS4jemAgeWwhi/kuI3po57lsIbnmoTlkIjms5XnnYDms5XvvIhVSS/moLnoioLngrkv5byA5bGA5bqT5qCh6aqM77yJCi8vIOaQnOe0oueDrei3r+W+hOS9v+eUqOW7tui/n+WQiOazleaAp++8iOivlei1sOaXtuajgOa1i++8ie+8jOmBv+WFjeWvueWJquaeneacquinpuWPiueahOedgOazleWBmuWFqOmHj+i/h+a7pApjb25zdCBmaWx0ZXJMZWdhbE1vdmVzID0gKGJvYXJkLCBmcm9tLCBwaWVjZSwgcHNldWRvTW92ZXMpID0+IHsKICAgIGNvbnN0IHZhbGlkTW92ZXMgPSBbXTsKICAgIGZvciAoY29uc3QgdG8gb2YgcHNldWRvTW92ZXMpIHsKICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VNb3ZlKGJvYXJkLCBmcm9tLCB0byk7CiAgICAgICAgY29uc3QgaWxsZWdhbCA9IGxlYXZlc093bktpbmdVbnNhZmUoYm9hcmQsIHBpZWNlLmNvbG9yKTsKICAgICAgICB1bm1ha2VNb3ZlKGJvYXJkLCBmcm9tLCB0bywgY2FwdHVyZWQpOwogICAgICAgIGlmICghaWxsZWdhbCkgdmFsaWRNb3Zlcy5wdXNoKHRvKTsKICAgIH0KICAgIHJldHVybiB2YWxpZE1vdmVzOwp9OwoKLy8g5pCc57Si55So552A5rOV5YeG5aSH77yI6L276YeP77yJ77ya5LiN5bu65YWz57O75Zu+L+WogeiDgS/mnLrliqjmgKcKLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPXRydWXvvJrlj6rnlJ/miJDkvKrlkIjms5XvvIzlkIjms5XmgKflnKjor5XotbDml7bmo4DmtYsKLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPWZhbHNl77ya6aKE6L+H5ruk5ZCI5rOV552A77yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQovLyDngrnmo4vlhbPns7vku43otbDlrozmlbQgZXZhbHVhdGVCb2FyZO+8jOS4jeWPl+W9seWTjQpjb25zdCBwcmVwYXJlU2VhcmNoSW5mbyA9IChib2FyZCwgY3VycmVudFBsYXllciwgZ2FtZVN0YWdlLCBzZWFyY2hJbml0aWF0b3IgPSBudWxsLCBkZXB0aCA9IDApID0+IHsKICAgIGNvbnN0IF9fdDAgPSBwZXJmb3JtYW5jZS5ub3coKTsKICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50W2N1cnJlbnRQbGF5ZXJdKys7CgogICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2tSYXcoYm9hcmQsIGN1cnJlbnRQbGF5ZXIpOwogICAgY29uc3QgcGllY2VzSW5mbyA9IFtdOwogICAgY29uc3QgbGVnYWxNb3ZlTGlzdCA9IFtdOwogICAgY29uc3QgZGVmZXIgPSBTRUFSQ0hfREVGRVJfTEVHQUxJVFk7CgogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsKICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICBpZiAoIXBpZWNlIHx8IHBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSBjb250aW51ZTsKCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlKTsKICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IG1vdmVzIDogZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlLCBtb3Zlcyk7CiAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7CiAgICAgICAgICAgICAgICBwaWVjZSwKICAgICAgICAgICAgICAgIHIsCiAgICAgICAgICAgICAgICBjLAogICAgICAgICAgICAgICAgbW92ZXMsCiAgICAgICAgICAgICAgICBsZWdhbE1vdmVzOiB1c2VNb3ZlcwogICAgICAgICAgICB9KTsKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB1c2VNb3Zlcy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tpXTsKICAgICAgICAgICAgICAgIGxlZ2FsTW92ZUxpc3QucHVzaCh7IGZyb206IHsgciwgYyB9LCB0bywgc2NvcmU6IDAgfSk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IG1vdmVzLmxlbmd0aDsKICAgICAgICB9CiAgICB9CgogICAgLy8g6L276YePIGJvYXJkSW5mb++8muS7heiiq+Wwhuagh+W/lwogICAgY29uc3QgYm9hcmRJbmZvID0gewogICAgICAgIHJlZElzSW5DaGVjazogY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyBpbkNoZWNrIDogZmFsc2UsCiAgICAgICAgYmxhY2tJc0luQ2hlY2s6IGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgPyBpbkNoZWNrIDogZmFsc2UsCiAgICAgICAgZ2FtZVN0YXRlOiBudWxsCiAgICB9OwoKICAgIGlmIChsZWdhbE1vdmVMaXN0Lmxlbmd0aCA9PT0gMCkgewogICAgICAgIGNvbnN0IG9wcG9uZW50ID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7CiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IGluQ2hlY2sKICAgICAgICAgICAgPyB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfQogICAgICAgICAgICA6IHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9OwogICAgfSBlbHNlIHsKICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdwbGF5aW5nJyB9OwogICAgfQoKICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsKICAgIHJldHVybiB7IHBpZWNlc0luZm8sIGJvYXJkSW5mbywgbGVnYWxNb3ZlTGlzdCwgaW5DaGVjaywgZGVmZXJyZWRMZWdhbGl0eTogZGVmZXIgfTsKfTsKCi8vIOiuoeeul+ihjeeUn+WAvO+8muWogeiDgeWAvOOAgeWuieWFqOWAvOOAgeaImOacr+WAvOOAgeacuuWKqOWAvApjb25zdCBjYWxjdWxhdGVEZXJpdmVkVmFsdWVzID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyID0gbnVsbCwgZGVwdGggPSAwLCBzZWFyY2hJbml0aWF0b3IgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJywgYm9hcmRJbmZvID0gbnVsbCwgZm9yU2VhcmNoTGVhZiA9IGZhbHNlKSA9PiB7CiAgICAvLyDph43nva7miYDmnInooY3nlJ/lgLzvvIzpmaTkuobmnLrliqjlgLzvvIjlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpfvvIkKICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7CiAgICAgICAgaW5mby50aHJlYXRWYWx1ZSA9IDA7CiAgICAgICAgaW5mby5zYWZldHlWYWx1ZSA9IDA7CiAgICAgICAgaW5mby50YWN0aWNWYWx1ZSA9IDA7CiAgICAgICAgLy8g5L+d55WZ5py65Yqo5YC877yM5Zug5Li65bey5Zyo5pS26ZuG5qOL5a2Q5L+h5oGv5pe26K6h566XCiAgICB9CiAgICAKICAgIC8vIDEuIOiuoeeul+aji+WtkOWFs+ezu++8iOWogeiDgeiAheOAgeiiq+WogeiDgeiAheOAgeS/neaKpOiAheOAgeiiq+S/neaKpOiAhe+8iQogICAgaWYgKCFib2FyZEluZm8pIHsKICAgICAgICBib2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsKICAgIH0KICAgIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zKGJvYXJkLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pOwogICAgCiAgICAvLyAyLiDorqHnrpflqIHog4HlgLzvvIjmjInooqvlqIHog4HlrZDogZrlkIjvvIxTRUUg5q+P55uu5qCH5LiA5qyh77yJCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMocGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvKTsKICAgIAogICAgLy8gMy4g6K6h566X5a6J5YWo5YC8CiAgICBjYWxjdWxhdGVTYWZldHlWYWx1ZXMocGllY2VzSW5mbywgYm9hcmRJbmZvLCBib2FyZCk7CiAgICAKICAgIC8vIDQuIOiuoeeul+a4uOaIj+eKtuaAgeW5tuS/neWtmOWIsGJvYXJkSW5mbwogICAgLy8g5pCc57Si5Y+26IqC54K56Lez6L+H77ya5peg552AL+Wwhuatu+W3suWcqOeItuiKgueCueWkhOeQhu+8jOatpOWkhOWPqumcgOmdmeaAgeWIhgogICAgaWYgKGN1cnJlbnRQbGF5ZXIgJiYgIWZvclNlYXJjaExlYWYpIHsKICAgICAgICAvLyDmo4Dmn6XlvZPliY3njqnlrrbmmK/lkKbmnInlkIjms5XotbDms5UKICAgICAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsKICAgICAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgewogICAgICAgICAgICBpZiAoaW5mby5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgewogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5qOL5a2Q55qE5pyJ5pWI6LWw5rOVCiAgICAgICAgICAgICAgICBjb25zdCBtb3ZlcyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIHsgcjogaW5mby5yLCBjOiBpbmZvLmMgfSk7CiAgICAgICAgICAgICAgICBpZiAobW92ZXMubGVuZ3RoID4gMCkgewogICAgICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsKICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICAKICAgICAgICAvLyDliKTmlq3muLjmiI/nirbmgIEKICAgICAgICBsZXQgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdwbGF5aW5nJyB9OwogICAgICAgIGlmICghaGFzTW92ZXMpIHsKICAgICAgICAgICAgLy8g5rKh5pyJ5ZCI5rOV6LWw5rOV77yM5qOA5p+l5piv5ZCm6KKr5bCG5YabCiAgICAgICAgICAgIGNvbnN0IGluQ2hlY2sgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRJc0luQ2hlY2sgOiBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2s7CiAgICAgICAgICAgIGNvbnN0IG9wcG9uZW50ID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7CiAgICAgICAgICAgIAogICAgICAgICAgICBpZiAoaW5DaGVjaykgewogICAgICAgICAgICAgICAgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ3N0YWxlbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICAKICAgICAgICAvLyDkv53lrZjmuLjmiI/nirbmgIHliLBib2FyZEluZm8KICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0gZ2FtZVN0YXRlOwogICAgfQp9OwoKLy8g5qOL5a2Q5Yeg5L2V5pa55ZCR6KGo77yI6aKE6K6h566X6IW/L+ecvOWBj+enu++8jOeDrei3r+W+hOmBv+WFjSBNYXRoLnNpZ24gLyBkci8y77yJCmNvbnN0IE9SVEhfRElSUyA9IFsKICAgIFswLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdCl07CmNvbnN0IERJQUdfRElSUyA9IFsKICAgIFsxLCAxXSwgWzEsIC0xXSwgWy0xLCAxXSwgWy0xLCAtMV0KXTsKY29uc3QgRUxFUEhBTlRfRElSUyA9IFsKICAgIHsgZHI6IDIsIGRjOiAyLCBleWVEcjogMSwgZXllRGM6IDEgfSwKICAgIHsgZHI6IDIsIGRjOiAtMiwgZXllRHI6IDEsIGV5ZURjOiAtMSB9LAogICAgeyBkcjogLTIsIGRjOiAyLCBleWVEcjogLTEsIGV5ZURjOiAxIH0sCiAgICB7IGRyOiAtMiwgZGM6IC0yLCBleWVEcjogLTEsIGV5ZURjOiAtMSB9Cl07CmNvbnN0IEhPUlNFX0RJUlMgPSBbCiAgICB7IGRyOiAyLCBkYzogMSwgbGVnRHI6IDEsIGxlZ0RjOiAwIH0sCiAgICB7IGRyOiAyLCBkYzogLTEsIGxlZ0RyOiAxLCBsZWdEYzogMCB9LAogICAgeyBkcjogLTIsIGRjOiAxLCBsZWdEcjogLTEsIGxlZ0RjOiAwIH0sCiAgICB7IGRyOiAtMiwgZGM6IC0xLCBsZWdEcjogLTEsIGxlZ0RjOiAwIH0sCiAgICB7IGRyOiAxLCBkYzogMiwgbGVnRHI6IDAsIGxlZ0RjOiAxIH0sCiAgICB7IGRyOiAxLCBkYzogLTIsIGxlZ0RyOiAwLCBsZWdEYzogLTEgfSwKICAgIHsgZHI6IC0xLCBkYzogMiwgbGVnRHI6IDAsIGxlZ0RjOiAxIH0sCiAgICB7IGRyOiAtMSwgZGM6IC0yLCBsZWdEcjogMCwgbGVnRGM6IC0xIH0KXTsKCi8vIOmdnueCru+8muS4gOasoeWHoOS9leaJq+aPj++8m3JlbEN0eC51c2VNYXNrcyDml7blhpnmoLzkvY0gbWFza++8jOWQpuWImeWGmSB0aHJlYXQvZ3VhcmQvY29udHJvbCDliJfooagKLy8g6K+t5LmJ5LiOIGdldFBpZWNlTW92ZXMg5LiA6Ie077ybZ2V0UGllY2VNb3ZlcyDku43kvpvnnYDms5XnlJ/miJDkvb/nlKgKY29uc3QgZmlsbE5vbkNhbm5vblJlbGF0aW9ucyA9IChib2FyZCwgaW5mbywgcG9zQnlLZXksIHJlbEN0eCA9IG51bGwpID0+IHsKICAgIGNvbnN0IHBpZWNlID0gaW5mby5waWVjZTsKICAgIGNvbnN0IHsgciwgYyB9ID0gaW5mbzsKICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOwogICAgY29uc3QgeyBiYXNlTW92ZVZhbHVlIH0gPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHk7CiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKHJlbEN0eCAmJiByZWxDdHgudXNlTWFza3MpOwogICAgY29uc3QgYml0ID0gdXNlTWFza3MgPyAoMSA8PCByZWxDdHgucGllY2VJbmRleCkgOiAwOwogICAgaW5mby5tb3ZlcyA9IFtdOwogICAgaW5mby5jb250cm9sID0gW107CiAgICBpbmZvLmFsbHlHdWFyZHMgPSBbXTsKICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsKCiAgICBjb25zdCBsaW5rVGhyZWF0ID0gKHRyLCB0YykgPT4gewogICAgICAgIGlmICh1c2VNYXNrcykgewogICAgICAgICAgICBpZiAocG9zQnlLZXkuaGFzKHRyICogOSArIHRjKSkgewogICAgICAgICAgICAgICAgcmVsQ3R4LmF0dGFja01hc2tbdHIgKiA5ICsgdGNdIHw9IGJpdDsKICAgICAgICAgICAgfQogICAgICAgICAgICByZXR1cm47CiAgICAgICAgfQogICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwb3NCeUtleS5nZXQodHIgKiA5ICsgdGMpOwogICAgICAgIGlmICh0YXJnZXRJbmZvKSB7CiAgICAgICAgICAgIGluZm8udGhyZWF0LnB1c2godGFyZ2V0SW5mbyk7CiAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7CiAgICAgICAgfQogICAgfTsKCiAgICBjb25zdCBsaW5rR3VhcmQgPSAodHIsIHRjKSA9PiB7CiAgICAgICAgaWYgKHVzZU1hc2tzKSB7CiAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwb3NCeUtleS5nZXQodHIgKiA5ICsgdGMpOwogICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7CiAgICAgICAgICAgICAgICByZWxDdHguZ3VhcmRNYXNrW3RyICogOSArIHRjXSB8PSBiaXQ7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgcmV0dXJuOwogICAgICAgIH0KICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcG9zQnlLZXkuZ2V0KHRyICogOSArIHRjKTsKICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7CiAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsKICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsKICAgICAgICAgICAgaW5mby5hbGx5R3VhcmRzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7CiAgICAgICAgfQogICAgfTsKCiAgICBjb25zdCBtYXJrQ29udHJvbCA9ICh0ciwgdGMpID0+IHsKICAgICAgICBpZiAodXNlTWFza3MpIHsKICAgICAgICAgICAgY29uc3Qgc3EgPSB0ciAqIDkgKyB0YzsKICAgICAgICAgICAgcmVsQ3R4LmNvbnRyb2xNYXNrW3NxXSB8PSBiaXQ7CiAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHJlbEN0eC5yZWRBdHRhY2ssIHNxKTsKICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7CiAgICAgICAgICAgIHJldHVybjsKICAgICAgICB9CiAgICAgICAgaW5mby5jb250cm9sLnB1c2goeyByOiB0ciwgYzogdGMgfSk7CiAgICB9OwoKICAgIGNvbnN0IGFkZFNxdWFyZSA9ICh0ciwgdGMpID0+IHsKICAgICAgICBpZiAoIWlzVmFsaWRQb3ModHIsIHRjKSkgcmV0dXJuOwogICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW3RyXVt0Y107CiAgICAgICAgaWYgKCF0YXJnZXQpIHsKICAgICAgICAgICAgaWYgKCF1c2VNYXNrcykgaW5mby5tb3Zlcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOwogICAgICAgICAgICBtYXJrQ29udHJvbCh0ciwgdGMpOwogICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7CiAgICAgICAgfSBlbHNlIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlLmNvbG9yKSB7CiAgICAgICAgICAgIGlmICghdXNlTWFza3MpIGluZm8ubW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsKICAgICAgICAgICAgbGlua1RocmVhdCh0ciwgdGMpOwogICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgewogICAgICAgICAgICBsaW5rR3VhcmQodHIsIHRjKTsKICAgICAgICB9CiAgICB9OwoKICAgIHN3aXRjaCAocGllY2UudHlwZSkgewogICAgICAgIGNhc2UgJ2dlbmVyYWwnOgogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOwogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOwogICAgICAgICAgICAgICAgaWYgKG5jID49IDMgJiYgbmMgPD0gNSkgewogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA+PSAwICYmIG5yIDw9IDIpIGFkZFNxdWFyZShuciwgbmMpOwogICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA3ICYmIG5yIDw9IDkpIGFkZFNxdWFyZShuciwgbmMpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIGNhc2UgJ2Fkdmlzb3InOgogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IERJQUdfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgZHIgPSBESUFHX0RJUlNbaV1bMF0sIGRjID0gRElBR19ESVJTW2ldWzFdOwogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOwogICAgICAgICAgICAgICAgaWYgKG5jID49IDMgJiYgbmMgPD0gNSkgewogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA+PSAwICYmIG5yIDw9IDIpIGFkZFNxdWFyZShuciwgbmMpOwogICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA3ICYmIG5yIDw9IDkpIGFkZFNxdWFyZShuciwgbmMpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIGNhc2UgJ2VsZXBoYW50JzoKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBFTEVQSEFOVF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBkID0gRUxFUEhBTlRfRElSU1tpXTsKICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIGQuZHIsIG5jID0gYyArIGQuZGM7CiAgICAgICAgICAgICAgICBjb25zdCBleWVSID0gciArIGQuZXllRHIsIGV5ZUMgPSBjICsgZC5leWVEYzsKICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYgYm9hcmRbZXllUl1bZXllQ10gPT09IG51bGwpIHsKICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPD0gNCkgYWRkU3F1YXJlKG5yLCBuYyk7CiAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDUpIGFkZFNxdWFyZShuciwgbmMpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIGNhc2UgJ2hvcnNlJzoKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBIT1JTRV9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBkID0gSE9SU0VfRElSU1tpXTsKICAgICAgICAgICAgICAgIGNvbnN0IGxlZ1IgPSByICsgZC5sZWdEciwgbGVnQyA9IGMgKyBkLmxlZ0RjOwogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobGVnUiwgbGVnQykgJiYgYm9hcmRbbGVnUl1bbGVnQ10gPT09IG51bGwpIHsKICAgICAgICAgICAgICAgICAgICBhZGRTcXVhcmUociArIGQuZHIsIGMgKyBkLmRjKTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICBicmVhazsKICAgICAgICBjYXNlICdjaGFyaW90JzoKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsKICAgICAgICAgICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7CiAgICAgICAgICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbbnJdW25jXTsKICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0ID09PSBudWxsKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdXNlTWFza3MpIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgICAgICAgICAgICAgbWFya0NvbnRyb2wobnIsIG5jKTsKICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOwogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlLmNvbG9yKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXVzZU1hc2tzKSBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rVGhyZWF0KG5yLCBuYyk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgbGlua0d1YXJkKG5yLCBuYyk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIG5yICs9IGRyOwogICAgICAgICAgICAgICAgICAgIG5jICs9IGRjOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIGNhc2UgJ3NvbGRpZXInOiB7CiAgICAgICAgICAgIGNvbnN0IGZvcndhcmQgPSBpc1JlZCA/IDEgOiAtMTsKICAgICAgICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gaXNSZWQgPyByID49IDUgOiByIDw9IDQ7CiAgICAgICAgICAgIGFkZFNxdWFyZShyICsgZm9yd2FyZCwgYyk7CiAgICAgICAgICAgIGlmIChjcm9zc2VkUml2ZXIpIHsKICAgICAgICAgICAgICAgIGFkZFNxdWFyZShyLCBjIC0gMSk7CiAgICAgICAgICAgICAgICBhZGRTcXVhcmUociwgYyArIDEpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICBkZWZhdWx0OgogICAgICAgICAgICBicmVhazsKICAgIH0KICAgIGluZm8ubW9iaWxpdHlWYWx1ZSA9IG1vYmlsaXR5VmFsdWU7Cn07CgovLyDngq7vvJrkuIDmrKHlm5vlkJHlsITnur/vvJttYXNrIOaooeW8j+WGmSBhdHRhY2svZ3VhcmQvY29udHJvbO+8jOWIl+ihqOaooeW8j+S/neaMgeaXp+ivreS5iQpjb25zdCBmaWxsQ2Fubm9uUmVsYXRpb25zID0gKGJvYXJkLCBpbmZvLCBwb3NCeUtleSwgcmVsQ3R4ID0gbnVsbCkgPT4gewogICAgY29uc3QgcGllY2UgPSBpbmZvLnBpZWNlOwogICAgY29uc3QgeyByLCBjIH0gPSBpbmZvOwogICAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7CiAgICBjb25zdCB7IGJhc2VNb3ZlVmFsdWUgfSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eTsKICAgIGNvbnN0IHVzZU1hc2tzID0gISEocmVsQ3R4ICYmIHJlbEN0eC51c2VNYXNrcyk7CiAgICBjb25zdCBiaXQgPSB1c2VNYXNrcyA/ICgxIDw8IHJlbEN0eC5waWVjZUluZGV4KSA6IDA7CiAgICBpbmZvLm1vdmVzID0gW107CiAgICBpbmZvLmNvbnRyb2wgPSBbXTsKICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsKCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsKICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOwogICAgICAgIGxldCBzY3JlZW5Gb3VuZENvdW50ID0gMDsKICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpICYmIHNjcmVlbkZvdW5kQ291bnQgPCAyKSB7CiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOwogICAgICAgICAgICBpZiAocCAhPT0gbnVsbCkgewogICAgICAgICAgICAgICAgc2NyZWVuRm91bmRDb3VudCsrOwogICAgICAgICAgICAgICAgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDIpIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcG9zQnlLZXkuZ2V0KG5yICogOSArIG5jKTsKICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yICE9PSBwaWVjZS5jb2xvcikgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsQ3R4LmF0dGFja01hc2tbbnIgKiA5ICsgbmNdIHw9IGJpdDsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLnRocmVhdGVuZWRCeS5wdXNoKGluZm8pOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwLnR5cGUgIT09ICdnZW5lcmFsJykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsQ3R4Lmd1YXJkTWFza1tuciAqIDkgKyBuY10gfD0gYml0OwogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLmd1YXJkLnB1c2godGFyZ2V0SW5mbyk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocC5jb2xvciAhPT0gcGllY2UuY29sb3IpIHsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF1c2VNYXNrcykgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfSBlbHNlIGlmIChzY3JlZW5Gb3VuZENvdW50ID09PSAwKSB7CiAgICAgICAgICAgICAgICBpZiAoIXVzZU1hc2tzKSBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7CiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7CiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMSkgewogICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBuciAqIDkgKyBuYzsKICAgICAgICAgICAgICAgICAgICByZWxDdHguY29udHJvbE1hc2tbc3FdIHw9IGJpdDsKICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChyZWxDdHgucmVkQXR0YWNrLCBzcSk7CiAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7CiAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIG5yICs9IGRyOwogICAgICAgICAgICBuYyArPSBkYzsKICAgICAgICB9CiAgICB9CiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOwp9OwoKLy8g5LuO5qC85L2NIG1hc2sg6L+Y5Y6fIHRocmVhdC9ndWFyZC9jb250cm9sIOWIl+ihqO+8iOeCueajiy9VSe+8iQpjb25zdCBoeWRyYXRlUmVsYXRpb25zRnJvbU1hc2tzID0gKHBpZWNlc0luZm8sIGJvYXJkSW5mbykgPT4gewogICAgY29uc3QgYXR0YWNrTWFzayA9IGJvYXJkSW5mby5hdHRhY2tNYXNrOwogICAgY29uc3QgZ3VhcmRNYXNrID0gYm9hcmRJbmZvLmd1YXJkTWFzazsKICAgIGNvbnN0IGNvbnRyb2xNYXNrID0gYm9hcmRJbmZvLmNvbnRyb2xNYXNrOwogICAgY29uc3QgbiA9IHBpZWNlc0luZm8ubGVuZ3RoOwogICAgY29uc3QgYnlTcSA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7CiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykgewogICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOwogICAgICAgIGluZm8udGhyZWF0ID0gW107CiAgICAgICAgaW5mby50aHJlYXRlbmVkQnkgPSBbXTsKICAgICAgICBpbmZvLmd1YXJkID0gW107CiAgICAgICAgaW5mby5ndWFyZGVkQnkgPSBbXTsKICAgICAgICBpbmZvLmNvbnRyb2wgPSBbXTsKICAgICAgICBieVNxW2luZm8uciAqIDkgKyBpbmZvLmNdID0gaW5mbzsKICAgIH0KCiAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsKICAgICAgICBjb25zdCByID0gKHNxIC8gOSkgfCAwOwogICAgICAgIGNvbnN0IGMgPSBzcSAlIDk7CiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYnlTcVtzcV07CgogICAgICAgIGxldCBjbSA9IGNvbnRyb2xNYXNrW3NxXSA+Pj4gMDsKICAgICAgICB3aGlsZSAoY20gIT09IDApIHsKICAgICAgICAgICAgY29uc3QgYml0ID0gY20gJiAtY207CiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsKICAgICAgICAgICAgcGllY2VzSW5mb1tpXS5jb250cm9sLnB1c2goeyByLCBjIH0pOwogICAgICAgICAgICBjbSBePSBiaXQ7CiAgICAgICAgfQoKICAgICAgICBsZXQgYW0gPSBhdHRhY2tNYXNrW3NxXSA+Pj4gMDsKICAgICAgICB3aGlsZSAoYW0gIT09IDApIHsKICAgICAgICAgICAgY29uc3QgYml0ID0gYW0gJiAtYW07CiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsKICAgICAgICAgICAgY29uc3QgYXR0YWNrZXIgPSBwaWVjZXNJbmZvW2ldOwogICAgICAgICAgICBpZiAodGFyZ2V0ICYmIHRhcmdldCAhPT0gYXR0YWNrZXIgJiYgdGFyZ2V0LnBpZWNlLmNvbG9yICE9PSBhdHRhY2tlci5waWVjZS5jb2xvcikgewogICAgICAgICAgICAgICAgYXR0YWNrZXIudGhyZWF0LnB1c2godGFyZ2V0KTsKICAgICAgICAgICAgICAgIHRhcmdldC50aHJlYXRlbmVkQnkucHVzaChhdHRhY2tlcik7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgYW0gXj0gYml0OwogICAgICAgIH0KCiAgICAgICAgbGV0IGdtID0gZ3VhcmRNYXNrW3NxXSA+Pj4gMDsKICAgICAgICB3aGlsZSAoZ20gIT09IDApIHsKICAgICAgICAgICAgY29uc3QgYml0ID0gZ20gJiAtZ207CiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsKICAgICAgICAgICAgY29uc3QgZ3VhcmRlciA9IHBpZWNlc0luZm9baV07CiAgICAgICAgICAgIGlmICh0YXJnZXQgJiYgdGFyZ2V0ICE9PSBndWFyZGVyICYmIHRhcmdldC5waWVjZS5jb2xvciA9PT0gZ3VhcmRlci5waWVjZS5jb2xvcikgewogICAgICAgICAgICAgICAgZ3VhcmRlci5ndWFyZC5wdXNoKHRhcmdldCk7CiAgICAgICAgICAgICAgICB0YXJnZXQuZ3VhcmRlZEJ5LnB1c2goZ3VhcmRlcik7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgZ20gXj0gYml0OwogICAgICAgIH0KICAgIH0KCiAgICAvLyDkvpsgaXNQb3NpdGlvbkFjY2VwdGFibGUgLyDngrnmo4sgY29udHJvbGxlcnPvvJrkuI7ml6for63kuYnkuIDoh7TvvIzku4XnqbrmjqfmoLwKICAgIGNvbnN0IGdyaWQgPSBtYWtlRW1wdHlDb250cm9sbGVyR3JpZCgpOwogICAgZm9yIChsZXQgc3EgPSAwOyBzcSA8IFJFTF9TUVVBUkVTOyBzcSsrKSB7CiAgICAgICAgbGV0IGNtID0gY29udHJvbE1hc2tbc3FdID4+PiAwOwogICAgICAgIGlmIChjbSA9PT0gMCkgY29udGludWU7CiAgICAgICAgY29uc3QgciA9IChzcSAvIDkpIHwgMDsKICAgICAgICBjb25zdCBjID0gc3EgJSA5OwogICAgICAgIHdoaWxlIChjbSAhPT0gMCkgewogICAgICAgICAgICBjb25zdCBiaXQgPSBjbSAmIC1jbTsKICAgICAgICAgICAgY29uc3QgaSA9IDMxIC0gTWF0aC5jbHozMihiaXQpOwogICAgICAgICAgICBncmlkW3JdW2NdLnB1c2gocGllY2VzSW5mb1tpXSk7CiAgICAgICAgICAgIGNtIF49IGJpdDsKICAgICAgICB9CiAgICB9CiAgICBib2FyZEluZm8uY29udHJvbGxlckdyaWQgPSBncmlkOwp9OwoKLy8g6K6h566X5qOL5a2Q5YWz57O777yabWFzayDot6/lvoTlhpkgVWludDMyIOagvOS9jeihqO+8m+WIl+ihqOi3r+W+hOS/neaMgeaXpyBwdXNoCmNvbnN0IGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pID0+IHsKICAgIGNvbnN0IHVzZU1hc2tzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKTsKICAgIGNvbnN0IHVzZUF0dGFja0JpdHMgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMpICYmICF1c2VNYXNrczsKCiAgICBpZiAoIXVzZU1hc2tzKSB7CiAgICAgICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsKICAgICAgICAgICAgaW5mby50aHJlYXQgPSBbXTsKICAgICAgICAgICAgaW5mby50aHJlYXRlbmVkQnkgPSBbXTsKICAgICAgICAgICAgaW5mby5ndWFyZCA9IFtdOwogICAgICAgICAgICBpbmZvLmd1YXJkZWRCeSA9IFtdOwogICAgICAgICAgICBpbmZvLmNvbnRyb2wgPSBbXTsKICAgICAgICB9CiAgICB9CgogICAgaWYgKCFib2FyZEluZm8pIHsKICAgICAgICBib2FyZEluZm8gPSBtYWtlRW1wdHlDb250cm9sbGVyR3JpZCgpOwogICAgfQoKICAgIGNvbnN0IHBvc0J5S2V5ID0gbmV3IE1hcCgpOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07CiAgICAgICAgaWYgKGluZm8ucGllY2VJbmRleCA9PSBudWxsKSBpbmZvLnBpZWNlSW5kZXggPSBpOwogICAgICAgIHBvc0J5S2V5LnNldChpbmZvLnIgKiA5ICsgaW5mby5jLCBpbmZvKTsKICAgIH0KCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1tpXTsKICAgICAgICBjb25zdCByZWxDdHggPSB1c2VNYXNrcwogICAgICAgICAgICA/IHsKICAgICAgICAgICAgICAgIHVzZU1hc2tzOiB0cnVlLAogICAgICAgICAgICAgICAgcGllY2VJbmRleDogaW5mby5waWVjZUluZGV4LAogICAgICAgICAgICAgICAgYXR0YWNrTWFzazogYm9hcmRJbmZvLmF0dGFja01hc2ssCiAgICAgICAgICAgICAgICBndWFyZE1hc2s6IGJvYXJkSW5mby5ndWFyZE1hc2ssCiAgICAgICAgICAgICAgICBjb250cm9sTWFzazogYm9hcmRJbmZvLmNvbnRyb2xNYXNrLAogICAgICAgICAgICAgICAgcmVkQXR0YWNrOiBib2FyZEluZm8ucmVkQXR0YWNrLAogICAgICAgICAgICAgICAgYmxhY2tBdHRhY2s6IGJvYXJkSW5mby5ibGFja0F0dGFjawogICAgICAgICAgICB9CiAgICAgICAgICAgIDogbnVsbDsKCiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gJ2Nhbm5vbicpIHsKICAgICAgICAgICAgZmlsbENhbm5vblJlbGF0aW9ucyhib2FyZCwgaW5mbywgcG9zQnlLZXksIHJlbEN0eCk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgZmlsbE5vbkNhbm5vblJlbGF0aW9ucyhib2FyZCwgaW5mbywgcG9zQnlLZXksIHJlbEN0eCk7CiAgICAgICAgfQoKICAgICAgICBpZiAoIXVzZU1hc2tzKSB7CiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2wgPSBpbmZvLmNvbnRyb2w7CiAgICAgICAgICAgIGlmICh1c2VBdHRhY2tCaXRzKSB7CiAgICAgICAgICAgICAgICBjb25zdCBiaXRzID0gaW5mby5waWVjZS5jb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkQXR0YWNrIDogYm9hcmRJbmZvLmJsYWNrQXR0YWNrOwogICAgICAgICAgICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBjb250cm9sLmxlbmd0aDsgaysrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zID0gY29udHJvbFtrXTsKICAgICAgICAgICAgICAgICAgICBzZXRBdHRhY2tCaXQoYml0cywgcG9zLnIgKiA5ICsgcG9zLmMpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoYm9hcmRJbmZvWzBdKSkgewogICAgICAgICAgICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBjb250cm9sLmxlbmd0aDsgaysrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zID0gY29udHJvbFtrXTsKICAgICAgICAgICAgICAgICAgICBib2FyZEluZm9bcG9zLnJdW3Bvcy5jXS5wdXNoKGluZm8pOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIGxldCByZWRJc0luQ2hlY2sgPSBmYWxzZTsKICAgIGxldCBibGFja0lzSW5DaGVjayA9IGZhbHNlOwogICAgbGV0IHJlZEdlbmVyYWxJbmZvID0gbnVsbDsKICAgIGxldCBibGFja0dlbmVyYWxJbmZvID0gbnVsbDsKICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7CiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJykgcmVkR2VuZXJhbEluZm8gPSBpbmZvOwogICAgICAgICAgICBlbHNlIGJsYWNrR2VuZXJhbEluZm8gPSBpbmZvOwogICAgICAgIH0KICAgIH0KCiAgICBpZiAodXNlTWFza3MpIHsKICAgICAgICBpZiAocmVkR2VuZXJhbEluZm8gJiYgYm9hcmRJbmZvLmF0dGFja01hc2tbcmVkR2VuZXJhbEluZm8uciAqIDkgKyByZWRHZW5lcmFsSW5mby5jXSAhPT0gMCkgewogICAgICAgICAgICByZWRJc0luQ2hlY2sgPSB0cnVlOwogICAgICAgIH0KICAgICAgICBpZiAoYmxhY2tHZW5lcmFsSW5mbyAmJiBib2FyZEluZm8uYXR0YWNrTWFza1tibGFja0dlbmVyYWxJbmZvLnIgKiA5ICsgYmxhY2tHZW5lcmFsSW5mby5jXSAhPT0gMCkgewogICAgICAgICAgICBibGFja0lzSW5DaGVjayA9IHRydWU7CiAgICAgICAgfQogICAgfSBlbHNlIHsKICAgICAgICBpZiAocmVkR2VuZXJhbEluZm8pIHsKICAgICAgICAgICAgZm9yIChjb25zdCB0aHJlYXRlbmVyIG9mIHJlZEdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgewogICAgICAgICAgICAgICAgaWYgKHRocmVhdGVuZXIucGllY2UuY29sb3IgPT09ICdibGFjaycpIHsKICAgICAgICAgICAgICAgICAgICByZWRJc0luQ2hlY2sgPSB0cnVlOwogICAgICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIGlmIChibGFja0dlbmVyYWxJbmZvKSB7CiAgICAgICAgICAgIGZvciAoY29uc3QgdGhyZWF0ZW5lciBvZiBibGFja0dlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgewogICAgICAgICAgICAgICAgaWYgKHRocmVhdGVuZXIucGllY2UuY29sb3IgPT09ICdyZWQnKSB7CiAgICAgICAgICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOwogICAgICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIGlmIChyZWRHZW5lcmFsSW5mbyAmJiBibGFja0dlbmVyYWxJbmZvICYmIHJlZEdlbmVyYWxJbmZvLmMgPT09IGJsYWNrR2VuZXJhbEluZm8uYykgewogICAgICAgIGxldCBoYXNQaWVjZUJldHdlZW4gPSBmYWxzZTsKICAgICAgICBjb25zdCBzdGFydFIgPSBNYXRoLm1pbihyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpICsgMTsKICAgICAgICBjb25zdCBlbmRSID0gTWF0aC5tYXgocmVkR2VuZXJhbEluZm8uciwgYmxhY2tHZW5lcmFsSW5mby5yKSAtIDE7CiAgICAgICAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsKICAgICAgICAgICAgaWYgKGJvYXJkW3JdW3JlZEdlbmVyYWxJbmZvLmNdKSB7CiAgICAgICAgICAgICAgICBoYXNQaWVjZUJldHdlZW4gPSB0cnVlOwogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgaWYgKCFoYXNQaWVjZUJldHdlZW4pIHsKICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsKICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOwogICAgICAgIH0KICAgIH0KCiAgICBib2FyZEluZm8ucmVkSXNJbkNoZWNrID0gcmVkSXNJbkNoZWNrOwogICAgYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrID0gYmxhY2tJc0luQ2hlY2s7Cn07CgovLyDnnYDms5XmjpLluo/lh73mlbDvvJrmoLnmja7kvJjlhYjnuqfmjpLluo/nnYDms5UKLy8g6KKr5bCG5pe277ya5ZCD5bCG5a2QID4g5Y+N5bCGID4g5YW25a6D5ZCD5a2QID4g6LWw5bCG6YCD6YC4ID4g5Z6r5bCGL+WFtuS9mQovLyDmnKrooqvlsIbml7bvvJoKLy8gMS4g5LyY5YWI5aSE55CG5oiR5pa55peg5L+d5oqk55qE6KKr5Y2V5ZCR5aiB6IOB55qE5qOL5a2Q5omn6KGM6YCD6LeR552A5rOV77yM5aaC5pyJ5aSa5Liq5qOL5a2Q5oyJ5p2Q5paZ5YC85LuO6auY5Yiw5L2O5o6S5bqPCi8vIDIuIOWFtuasoeWkhOeQhuaIkeaWueWNleWQkeWogeiDgeWvueaWueaXoOS/neaKpOaji+WtkOeahOaji+WtkOaJp+ihjOWQg+WtkOedgOazle+8jOWmguacieWkmuS4quaji+WtkOaMieaji+WtkOadkOaWmeWAvOS7jumrmOWIsOS9juaOkuW6jwovLyAzLiDmnIDlkI7lpITnkIbkuI3mtonlj4rlkIPlkozooqvlkIPnmoTnnYDms5XvvIzopoHmsYLpgb/lhY3np7vliqjliLDooqvlkIPnmoTkvY3nva4KY29uc3Qgc29ydE1vdmVzID0gKG1vdmVzLCBib2FyZCwgY3VycmVudFBsYXllciwgcGllY2VzSW5mbywgZ2FtZVN0YWdlID0gJ21pZCcsIGJvYXJkSW5mbyA9IG51bGwsIHNlYXJjaEhldXJpc3RpY3MgPSBudWxsKSA9PiB7CiAgICAvLyDkvb/nlKjkvKDlhaXnmoRnYW1lU3RhZ2Xlj4LmlbDvvIzpgb/lhY3ph43lpI3osIPnlKhnZXRHYW1lUGhhc2UKICAgIAogICAgLy8g55So6aKE6K6h566X55qE6KKr5bCG54q25oCB77yI5LiN6IO955SoIGJvYXJkSW5mby5jaGVja3PvvJrpgqPmmK/igJzosIHlnKjlsIblhpvigJ3vvIzkuI3mmK/igJzosIHooqvlsIbigJ3vvIkKICAgIGNvbnN0IGN1cnJlbnRJc0luQ2hlY2sgPSBib2FyZEluZm8KICAgICAgICA/ICgoY3VycmVudFBsYXllciA9PT0gJ3JlZCcgJiYgYm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwKICAgICAgICAgICAoY3VycmVudFBsYXllciA9PT0gJ2JsYWNrJyAmJiBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2spKQogICAgICAgIDogaXNDaGVjayhib2FyZCwgY3VycmVudFBsYXllcik7CgogICAgLy8g6KKr5bCG5pe25pS26ZuG5q2j5Zyo5bCG5Yab55qE5pWM5pa55qOL5a2Q5L2N572u77yM55So5LqO5LyY5YWI5ZCD5bCG5a2QCiAgICBsZXQgY2hlY2tlcktleXMgPSBudWxsOwogICAgaWYgKGN1cnJlbnRJc0luQ2hlY2sgJiYgcGllY2VzSW5mbyAmJiBwaWVjZXNJbmZvLmxlbmd0aCA+IDApIHsKICAgICAgICBjb25zdCBnZW5lcmFsSW5mbyA9IHBpZWNlc0luZm8uZmluZCgKICAgICAgICAgICAgcCA9PiBwLnBpZWNlICYmIHAucGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnICYmIHAucGllY2UuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXIKICAgICAgICApOwogICAgICAgIGlmIChnZW5lcmFsSW5mbykgewogICAgICAgICAgICBpZiAoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKSB7CiAgICAgICAgICAgICAgICBjaGVja2VyS2V5cyA9IG5ldyBTZXQoKTsKICAgICAgICAgICAgICAgIGZvckVhY2hTZXRCaXQoYm9hcmRJbmZvLmF0dGFja01hc2tbZ2VuZXJhbEluZm8uciAqIDkgKyBnZW5lcmFsSW5mby5jXSwgKGkpID0+IHsKICAgICAgICAgICAgICAgICAgICBjb25zdCB0ID0gcGllY2VzSW5mb1tpXTsKICAgICAgICAgICAgICAgICAgICBpZiAodCAmJiB0LnBpZWNlICYmIHQucGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIHsKICAgICAgICAgICAgICAgICAgICAgICAgY2hlY2tlcktleXMuYWRkKGAke3Qucn0sJHt0LmN9YCk7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIH0gZWxzZSBpZiAoZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7CiAgICAgICAgICAgICAgICBjaGVja2VyS2V5cyA9IG5ldyBTZXQoCiAgICAgICAgICAgICAgICAgICAgZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5CiAgICAgICAgICAgICAgICAgICAgICAgIC5maWx0ZXIodCA9PiB0LnBpZWNlICYmIHQucGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpCiAgICAgICAgICAgICAgICAgICAgICAgIC5tYXAodCA9PiBgJHt0LnJ9LCR7dC5jfWApCiAgICAgICAgICAgICAgICApOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIGNvbnN0IHR0TW92ZSA9IHNlYXJjaEhldXJpc3RpY3M/LnR0TW92ZSB8fCBudWxsOwogICAgY29uc3Qga2lsbGVycyA9IHNlYXJjaEhldXJpc3RpY3M/LmtpbGxlcnMgfHwgbnVsbDsKICAgIAogICAgLy8g5Li65q+P5Liq552A5rOV6K6h566X5LyY5YWI57qn5YiG5pWw5bm25L+d5a2Y5Y6f5aeL57Si5byVCiAgICAvLyDmjpLluo/lsYLnuqfvvJpUVC1tb3ZlID4g5bqU5bCGL+WQg+WtkOetiemdmeaAgeS8mOWFiOe6pyA+IGtpbGxlciA+IGhpc3RvcnkKICAgIG1vdmVzLmZvckVhY2goKG1vdmUsIGluZGV4KSA9PiB7CiAgICAgICAgY29uc3QgeyBmcm9tLCB0byB9ID0gbW92ZTsKICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsKICAgICAgICBjb25zdCBwaWVjZVZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKTsKCiAgICAgICAgY29uc3QgdGFyZ2V0UGllY2UgPSBib2FyZFt0by5yXVt0by5jXTsKICAgICAgICBjb25zdCB0YXJnZXRQaWVjZVZhbHVlID0gdGFyZ2V0UGllY2UgPyBnZXRNYXRlcmlhbFZhbHVlKHRhcmdldFBpZWNlLCBnYW1lU3RhZ2UpIDogMDsKICAgICAgICAKICAgICAgICBsZXQgcHJpb3JpdHkgPSA0OwogICAgICAgIGxldCBzY29yZSA9IDA7CgogICAgICAgIGlmICh0dE1vdmUgJiYgaXNTYW1lTW92ZShtb3ZlLCB0dE1vdmUpKSB7CiAgICAgICAgICAgIHByaW9yaXR5ID0gLTE7CiAgICAgICAgICAgIHNjb3JlID0gMTAwMDAwMDsKICAgICAgICB9IGVsc2UgaWYgKGN1cnJlbnRJc0luQ2hlY2spIHsKICAgICAgICAgICAgLy8g6KKr5bCG77ya5ZCI5rOV552A5rOV5Z2H5bey6Kej6Zmk5bCG5Yab77yb5LyY5YWI5ZCD5bCG5a2Q77yM5YW25qyh5ZCD5a2QL+WKqOWwhu+8iOS4jeaOoua1i+WPjeWwhu+8iQogICAgICAgICAgICBjb25zdCBjYXB0dXJlc0NoZWNrZXIgPSB0YXJnZXRQaWVjZSAmJiBjaGVja2VyS2V5cyAmJiBjaGVja2VyS2V5cy5oYXMoYCR7dG8ucn0sJHt0by5jfWApOwogICAgICAgICAgICBpZiAoY2FwdHVyZXNDaGVja2VyKSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDA7CiAgICAgICAgICAgICAgICBzY29yZSA9IDEwMDAwICsgdGFyZ2V0UGllY2VWYWx1ZTsKICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgewogICAgICAgICAgICAgICAgLy8gTVZWLUxWQe+8mui0teWtkOS8mOWFiOWQg+OAgeS+v+WunOWtkOS8mOWFiOWOu+WQgwogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOwogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlICogMTYgLSBwaWVjZVZhbHVlOwogICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgewogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOwogICAgICAgICAgICAgICAgc2NvcmUgPSBwaWVjZVZhbHVlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSA0OwogICAgICAgICAgICAgICAgc2NvcmUgPSAwOwogICAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMgJiYgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMubGVuZ3RoID4gMCkgewogICAgICAgICAgICBjb25zdCBpc1RocmVhdGVuZWRQaWVjZSA9IGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLnNvbWUocCA9PiBwLnIgPT09IGZyb20uciAmJiBwLmMgPT09IGZyb20uYyk7CiAgICAgICAgICAgIGlmIChpc1RocmVhdGVuZWRQaWVjZSkgewogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAxOwogICAgICAgICAgICAgICAgc2NvcmUgPSBwaWVjZVZhbHVlOwogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7CiAgICAgICAgICAgICAgICBjb25zdCBpc0NhbkNhcHR1cmUgPSBib2FyZEluZm8uY2FuQ2FwdHVyZSAmJiBib2FyZEluZm8uY2FuQ2FwdHVyZS5zb21lKHAgPT4gcC5yID09PSB0by5yICYmIHAuYyA9PT0gdG8uYyk7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IGlzQ2FuQ2FwdHVyZSA/IDIgOiAzOwogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSA0OwogICAgICAgICAgICAgICAgc2NvcmUgPSAwOwogICAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUgJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUubGVuZ3RoID4gMCkgewogICAgICAgICAgICBjb25zdCBpc0NhbkNhcHR1cmUgPSBib2FyZEluZm8uY2FuQ2FwdHVyZS5zb21lKHAgPT4gcC5yID09PSB0by5yICYmIHAuYyA9PT0gdG8uYyk7CiAgICAgICAgICAgIGlmIChpc0NhbkNhcHR1cmUpIHsKICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMjsKICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsKICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgewogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOwogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSA0OwogICAgICAgICAgICAgICAgc2NvcmUgPSAwOwogICAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgewogICAgICAgICAgICAvLyDml6DlqIHog4Hooajml7bvvIjmkJzntKLovbvph4/ot6/lvoTvvInvvJpNVlYtTFZBIOWQg+WtkOaOkuW6jwogICAgICAgICAgICBwcmlvcml0eSA9IDM7CiAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZSAqIDE2IC0gcGllY2VWYWx1ZTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgICBwcmlvcml0eSA9IDQ7CiAgICAgICAgICAgIHNjb3JlID0gMDsKICAgICAgICB9CgogICAgICAgIC8vIGtpbGxlciAvIGhpc3RvcnnvvJrkuI3opobnm5YgVFQg5LiO6auY5LyY5YWI57qn5ZCD5a2QL+W6lOWwhgogICAgICAgIGlmIChwcmlvcml0eSA+PSAwKSB7CiAgICAgICAgICAgIGlmICghdGFyZ2V0UGllY2UgJiYga2lsbGVycyAmJiBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNbMF0pKSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IE1hdGgubWluKHByaW9yaXR5LCAyKTsKICAgICAgICAgICAgICAgIHNjb3JlICs9IDgwMDA7CiAgICAgICAgICAgIH0gZWxzZSBpZiAoIXRhcmdldFBpZWNlICYmIGtpbGxlcnMgJiYgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzWzFdKSkgewogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7CiAgICAgICAgICAgICAgICBzY29yZSArPSA3MDAwOwogICAgICAgICAgICB9CiAgICAgICAgICAgIHNjb3JlICs9IGdldEhpc3RvcnlTY29yZShtb3ZlKTsKICAgICAgICB9CiAgICAgICAgCiAgICAgICAgbW92ZS5wcmlvcml0eSA9IHByaW9yaXR5OwogICAgICAgIG1vdmUuc29ydFNjb3JlID0gc2NvcmU7CiAgICAgICAgbW92ZS5vcmlnaW5hbEluZGV4ID0gaW5kZXg7CiAgICB9KTsKICAgIAogICAgLy8g5qC55o2u5LyY5YWI57qn44CB5YiG5pWw5ZKM5Y6f5aeL57Si5byV5o6S5bqP552A5rOVCiAgICBtb3Zlcy5zb3J0KChhLCBiKSA9PiB7CiAgICAgICAgLy8g6aaW5YWI5oyJ5LyY5YWI57qn5o6S5bqP77yM5LyY5YWI57qnMCA+IDEgPiAyID4gMyA+IDQKICAgICAgICBpZiAoYS5wcmlvcml0eSAhPT0gYi5wcmlvcml0eSkgewogICAgICAgICAgICByZXR1cm4gYS5wcmlvcml0eSAtIGIucHJpb3JpdHk7CiAgICAgICAgfQogICAgICAgIC8vIOS8mOWFiOe6p+ebuOWQjOaXtu+8jOaMieWIhuaVsOS7jumrmOWIsOS9juaOkuW6jwogICAgICAgIGlmIChhLnNvcnRTY29yZSAhPT0gYi5zb3J0U2NvcmUpIHsKICAgICAgICAgICAgcmV0dXJuIGIuc29ydFNjb3JlIC0gYS5zb3J0U2NvcmU7CiAgICAgICAgfQogICAgICAgIC8vIOS8mOWFiOe6p+WSjOWIhuaVsOmDveebuOWQjOaXtu+8jOaMieWOn+Wni+e0ouW8leaOkuW6j++8jOS/neaMgeeos+WumgogICAgICAgIHJldHVybiBhLm9yaWdpbmFsSW5kZXggLSBiLm9yaWdpbmFsSW5kZXg7CiAgICB9KTsKICAgIAogICAgcmV0dXJuIG1vdmVzOwp9OwoKLy8g5qOA5p+l55uu5qCH5L2N572u5piv5ZCm5Y+v5o6l5Y+X77yI6YG/5YWN5piO5pi+6YCB5ZCDL+S6j+aNou+8iQovLyDkvJjljJbniYjvvJrmjqXlj5fpooTorqHnrpfnmoRib2FyZEluZm/lkoxwaWVjZXNJbmZv77yM6YG/5YWN6YeN5aSN6K6h566XCmNvbnN0IGlzUG9zaXRpb25BY2NlcHRhYmxlID0gKGJvYXJkLCBmcm9tLCB0bywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvID0gbnVsbCwgcGllY2VzSW5mbyA9IG51bGwsIHRyeU1vdmVQaWVjZSA9IG51bGwsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7CiAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IHRyeU1vdmVQaWVjZSB8fCBib2FyZFtmcm9tLnJdW2Zyb20uY107CiAgICBjb25zdCB0YXJnZXRQaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOwogICAgY29uc3QgaXNDYXB0dXJlID0gdGFyZ2V0UGllY2UgJiYgdGFyZ2V0UGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXI7CgogICAgLy8g5pS26ZuG5omA5pyJ5qOL5a2Q5L+h5oGv77yM5Y+q5Zyo5rKh5pyJ5o+Q5L6b5pe26K6h566XCiAgICBsZXQgbG9jYWxQaWVjZXNJbmZvID0gcGllY2VzSW5mbzsKICAgIGlmICghbG9jYWxQaWVjZXNJbmZvKSB7CiAgICAgICAgbG9jYWxQaWVjZXNJbmZvID0gW107CiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsKICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBhbGx5R3VhcmRzID0gW107CiAgICAgICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCB7IHIsIGMgfSwgcGllY2UsIGFsbHlHdWFyZHMpOwogICAgICAgICAgICAgICAgICAgIGxvY2FsUGllY2VzSW5mby5wdXNoKHsKICAgICAgICAgICAgICAgICAgICAgICAgcGllY2UsCiAgICAgICAgICAgICAgICAgICAgICAgIHIsIGMsIG1vdmVzLCBhbGx5R3VhcmRzLAogICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlOiBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpLAogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLAogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnk6IFtdLAogICAgICAgICAgICAgICAgICAgICAgICBndWFyZDogW10sCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkZWRCeTogW10sCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWU6IDAsCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdFZhbHVlOiAwLAogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHlWYWx1ZTogMCwKICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDAKICAgICAgICAgICAgICAgICAgICB9KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KCiAgICAvLyDorqHnrpfmo4vlrZDlhbPns7vlkozmjqfliLbkv6Hmga/vvIzlj6rlnKjmsqHmnInmj5Dkvpvml7borqHnrpcKICAgIGxldCBsb2NhbEJvYXJkSW5mbyA9IGJvYXJkSW5mbzsKICAgIGlmICghbG9jYWxCb2FyZEluZm8pIHsKICAgICAgICBpZiAoU0VBUkNIX1JFTEFUSU9OX01BU0tTICYmIGxvY2FsUGllY2VzSW5mby5sZW5ndGggPD0gMzIpIHsKICAgICAgICAgICAgY2xlYXJSZWxhdGlvbk1hc2tzKCk7CiAgICAgICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsKICAgICAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7CiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbG9jYWxQaWVjZXNJbmZvLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBsb2NhbFBpZWNlc0luZm9baV0ucGllY2VJbmRleCA9IGk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgbG9jYWxCb2FyZEluZm8gPSB7CiAgICAgICAgICAgICAgICB1c2VSZWxhdGlvbk1hc2tzOiB0cnVlLAogICAgICAgICAgICAgICAgdXNlQXR0YWNrQml0czogdHJ1ZSwKICAgICAgICAgICAgICAgIGF0dGFja01hc2s6IHNjcmF0Y2hBdHRhY2tNYXNrLAogICAgICAgICAgICAgICAgZ3VhcmRNYXNrOiBzY3JhdGNoR3VhcmRNYXNrLAogICAgICAgICAgICAgICAgY29udHJvbE1hc2s6IHNjcmF0Y2hDb250cm9sTWFzaywKICAgICAgICAgICAgICAgIHJlZEF0dGFjazogc2NyYXRjaFJlZEF0dGFjaywKICAgICAgICAgICAgICAgIGJsYWNrQXR0YWNrOiBzY3JhdGNoQmxhY2tBdHRhY2sKICAgICAgICAgICAgfTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgICBsb2NhbEJvYXJkSW5mbyA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7CiAgICAgICAgfQogICAgICAgIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zKGJvYXJkLCBsb2NhbFBpZWNlc0luZm8sIGxvY2FsQm9hcmRJbmZvKTsKICAgIH0KCiAgICAvLyDmjqfliLbogIXvvJptYXNrIOeUqCBjb250cm9sTWFza++8m+aXp+i3r+W+hOeUqCBib2FyZEluZm9bcl1bY13vvJtoeWRyYXRlIOWQjuWPr+eUqCBjb250cm9sbGVyR3JpZAogICAgbGV0IGNvbnRyb2xsZXJzOwogICAgaWYgKGxvY2FsQm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpIHsKICAgICAgICBjb250cm9sbGVycyA9IFtdOwogICAgICAgIGZvckVhY2hTZXRCaXQobG9jYWxCb2FyZEluZm8uY29udHJvbE1hc2tbdG8uciAqIDkgKyB0by5jXSwgKGkpID0+IHsKICAgICAgICAgICAgY29udHJvbGxlcnMucHVzaChsb2NhbFBpZWNlc0luZm9baV0pOwogICAgICAgIH0pOwogICAgfSBlbHNlIGlmIChsb2NhbEJvYXJkSW5mby5jb250cm9sbGVyR3JpZCkgewogICAgICAgIGNvbnRyb2xsZXJzID0gbG9jYWxCb2FyZEluZm8uY29udHJvbGxlckdyaWRbdG8ucl1bdG8uY10gfHwgW107CiAgICB9IGVsc2UgewogICAgICAgIGNvbnRyb2xsZXJzID0gbG9jYWxCb2FyZEluZm9bdG8ucl1bdG8uY10gfHwgW107CiAgICB9CiAgICBsZXQgaGFzQWxseUNvbnRyb2xsZXIgPSBmYWxzZTsKICAgIGxldCBoYXNFbmVteUNvbnRyb2xsZXIgPSBmYWxzZTsKCiAgICAvLyDmjqfliLbogIXlj6/og73mmK8gcGllY2VzSW5mbyDlvJXnlKgge3BpZWNlLHIsY30g5oiW5pen57uT5p6EIHtjb2xvcix0eXBlLHIsY30KICAgIGNvbnN0IGNvbnRyb2xsZXJDb2xvciA9IChjb250cm9sbGVyKSA9PgogICAgICAgIGNvbnRyb2xsZXIucGllY2UgPyBjb250cm9sbGVyLnBpZWNlLmNvbG9yIDogY29udHJvbGxlci5jb2xvcjsKCiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgY29udHJvbGxlcnMpIHsKICAgICAgICAvLyDmjpLpmaTmraPlnKjnp7vliqjnmoTmo4vlrZDmnKzouqvvvIjotbDlkI7lroPkuI3lho3ku47ljp/kvY3mjqfliLbnm67moIfvvIkKICAgICAgICBpZiAobW92aW5nUGllY2UgJiYgY29udHJvbGxlci5yID09PSBmcm9tLnIgJiYgY29udHJvbGxlci5jID09PSBmcm9tLmMpIHsKICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgfQogICAgICAgIGlmIChjb250cm9sbGVyQ29sb3IoY29udHJvbGxlcikgPT09IGN1cnJlbnRQbGF5ZXIpIHsKICAgICAgICAgICAgaGFzQWxseUNvbnRyb2xsZXIgPSB0cnVlOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbGxlciA9IHRydWU7CiAgICAgICAgfQogICAgfQoKICAgIGlmIChpc0NhcHR1cmUpIHsKICAgICAgICAvLyDnmb3lkIPvvJrnm67moIfmnKrooqvmlYzmlrnkv53miqQKICAgICAgICBpZiAoIWhhc0VuZW15Q29udHJvbGxlcikgewogICAgICAgICAgICByZXR1cm4gdHJ1ZTsKICAgICAgICB9CiAgICAgICAgLy8g566A5Y2VIFNFRe+8muWFiOW+l+ebruagh+WIhu+8jOiLpeS8muiiq+WPjeWQg+WImeWGjeWkseW3seaWueaji+WtkAogICAgICAgIGNvbnN0IHRhcmdldFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZSh0YXJnZXRQaWVjZSwgZ2FtZVN0YWdlKTsKICAgICAgICBjb25zdCBvdXJWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUobW92aW5nUGllY2UsIGdhbWVTdGFnZSk7CiAgICAgICAgbGV0IHNlZSA9IHRhcmdldFZhbHVlIC0gb3VyVmFsdWU7CiAgICAgICAgLy8g6Iul5pyJ5bex5pa557un57ut5L+d5oqk77yM57KX55Wl6K6k5Li65Y+v6IO95YaN5ZCD5Zue5pyA5L2O5Lu35YC855qE5pWM5pa55L+d5oqk6ICFCiAgICAgICAgaWYgKGhhc0FsbHlDb250cm9sbGVyKSB7CiAgICAgICAgICAgIGNvbnN0IGVuZW15R3VhcmRWYWx1ZXMgPSBjb250cm9sbGVycwogICAgICAgICAgICAgICAgLmZpbHRlcihjID0+IGNvbnRyb2xsZXJDb2xvcihjKSAhPT0gY3VycmVudFBsYXllciAmJiAhKGMuciA9PT0gZnJvbS5yICYmIGMuYyA9PT0gZnJvbS5jKSkKICAgICAgICAgICAgICAgIC5tYXAoYyA9PiB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW2Mucl1bYy5jXTsKICAgICAgICAgICAgICAgICAgICByZXR1cm4gcCA/IGdldE1hdGVyaWFsVmFsdWUocCwgZ2FtZVN0YWdlKSA6IDA7CiAgICAgICAgICAgICAgICB9KQogICAgICAgICAgICAgICAgLmZpbHRlcih2ID0+IHYgPiAwKQogICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IGEgLSBiKTsKICAgICAgICAgICAgaWYgKGVuZW15R3VhcmRWYWx1ZXMubGVuZ3RoID4gMCkgewogICAgICAgICAgICAgICAgc2VlICs9IGVuZW15R3VhcmRWYWx1ZXNbMF07CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgLy8g5piO5pi+5LqP5o2i77yI5aaC6L2m5o2i5peg5qC55YW15LiU5Lya6KKr5Y+N5ZCD77yJ5YiZ6L+H5ruk77yb5bmz5o2iL+i1muaNoueVmee7meaQnOe0ogogICAgICAgIHJldHVybiBzZWUgPj0gMDsKICAgIH0KCiAgICAvLyDpnZ7lkIPlrZDvvJrnm67moIfku4XooqvmlYzmlrnmjqfliLbliJnop4bkuLrpgIHlkIMKICAgIGlmIChjb250cm9sbGVycy5sZW5ndGggPT09IDApIHsKICAgICAgICByZXR1cm4gdHJ1ZTsKICAgIH0KICAgIHJldHVybiAhaGFzRW5lbXlDb250cm9sbGVyIHx8IGhhc0FsbHlDb250cm9sbGVyOwp9OwoKLy8gU0VFIOaOkuW6j+WkjeeUqOe8k+WGsu+8jOmZjeS9juWPtuivhOS8sCBHQwpjb25zdCBzZWVBdHRhY2tlclNjcmF0Y2ggPSBbXTsKY29uc3Qgc2VlR3VhcmRTY3JhdGNoID0gW107CmNvbnN0IHNlZUF0dGFja2VyTWF0U2NyYXRjaCA9IFtdOwpjb25zdCBzZWVHdWFyZE1hdFNjcmF0Y2ggPSBbXTsKCi8vIOacieagueWtkOeugOWMliBTRUXvvIjkuI7ml6flrp7njrDpgJDooYznrYnku7fvvInvvJvmr4/kuKrnm67moIflj6rlupTosIPnlKjkuIDmrKEKY29uc3QgY2FsY3VsYXRlU3RhdGljRXhjaGFuZ2VTY29yZSA9ICh0aHJlYXRlbmVkUGllY2UpID0+IHsKICAgIGNvbnN0IGF0dGFja2VycyA9IHNlZUF0dGFja2VyU2NyYXRjaDsKICAgIGNvbnN0IGd1YXJkcyA9IHNlZUd1YXJkU2NyYXRjaDsKICAgIGF0dGFja2Vycy5sZW5ndGggPSAwOwogICAgZ3VhcmRzLmxlbmd0aCA9IDA7CiAgICBjb25zdCByYXdBdHRhY2tlcnMgPSB0aHJlYXRlbmVkUGllY2UudGhyZWF0ZW5lZEJ5OwogICAgY29uc3QgcmF3R3VhcmRzID0gdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeTsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF3QXR0YWNrZXJzLmxlbmd0aDsgaSsrKSBhdHRhY2tlcnMucHVzaChyYXdBdHRhY2tlcnNbaV0pOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCByYXdHdWFyZHMubGVuZ3RoOyBpKyspIGd1YXJkcy5wdXNoKHJhd0d1YXJkc1tpXSk7CiAgICBhdHRhY2tlcnMuc29ydCgoYSwgYikgPT4gYS5tYXRlcmlhbFZhbHVlIC0gYi5tYXRlcmlhbFZhbHVlKTsKICAgIGd1YXJkcy5zb3J0KChhLCBiKSA9PiBhLm1hdGVyaWFsVmFsdWUgLSBiLm1hdGVyaWFsVmFsdWUpOwoKICAgIGxldCBleGNoYW5nZVNjb3JlID0gMDsKICAgIGxldCBhdHRhY2tlckluZGV4ID0gMDsKICAgIGxldCBndWFyZEluZGV4ID0gMDsKICAgIGNvbnN0IHRhcmdldFZhbHVlID0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7CgogICAgd2hpbGUgKGF0dGFja2VySW5kZXggPCBhdHRhY2tlcnMubGVuZ3RoICYmIGd1YXJkSW5kZXggPCBndWFyZHMubGVuZ3RoKSB7CiAgICAgICAgaWYgKGd1YXJkSW5kZXggPT09IDApIHsKICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSB0YXJnZXRWYWx1ZTsKICAgICAgICB9CiAgICAgICAgZXhjaGFuZ2VTY29yZSAtPSBhdHRhY2tlcnNbYXR0YWNrZXJJbmRleF0ubWF0ZXJpYWxWYWx1ZTsKICAgICAgICBpZiAoYXR0YWNrZXJJbmRleCArIDEgPCBhdHRhY2tlcnMubGVuZ3RoKSB7CiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gZ3VhcmRzW2d1YXJkSW5kZXhdLm1hdGVyaWFsVmFsdWU7CiAgICAgICAgfQogICAgICAgIGF0dGFja2VySW5kZXgrKzsKICAgICAgICBndWFyZEluZGV4Kys7CiAgICB9CiAgICByZXR1cm4gZXhjaGFuZ2VTY29yZTsKfTsKCi8vIG1hc2sg6Lev5b6EIFNFRe+8muadkOaWmeaVsOe7hOaOkuW6j++8jOivreS5ieS4juS4iuW8j+S4gOiHtApjb25zdCBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlRnJvbU1hc2tzID0gKHRocmVhdGVuZWRQaWVjZSwgcGllY2VzSW5mbywgYXR0YWNrTWFzaywgZ3VhcmRNYXNrKSA9PiB7CiAgICBjb25zdCBhdGtNYXRzID0gc2VlQXR0YWNrZXJNYXRTY3JhdGNoOwogICAgY29uc3QgZ3JkTWF0cyA9IHNlZUd1YXJkTWF0U2NyYXRjaDsKICAgIGF0a01hdHMubGVuZ3RoID0gMDsKICAgIGdyZE1hdHMubGVuZ3RoID0gMDsKICAgIGNvbnN0IHNxID0gdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmM7CiAgICBmb3JFYWNoU2V0Qml0KGF0dGFja01hc2tbc3FdLCAoaSkgPT4gewogICAgICAgIGF0a01hdHMucHVzaChwaWVjZXNJbmZvW2ldLm1hdGVyaWFsVmFsdWUpOwogICAgfSk7CiAgICBmb3JFYWNoU2V0Qml0KGd1YXJkTWFza1tzcV0sIChpKSA9PiB7CiAgICAgICAgZ3JkTWF0cy5wdXNoKHBpZWNlc0luZm9baV0ubWF0ZXJpYWxWYWx1ZSk7CiAgICB9KTsKICAgIGF0a01hdHMuc29ydCgoYSwgYikgPT4gYSAtIGIpOwogICAgZ3JkTWF0cy5zb3J0KChhLCBiKSA9PiBhIC0gYik7CgogICAgbGV0IGV4Y2hhbmdlU2NvcmUgPSAwOwogICAgbGV0IGF0dGFja2VySW5kZXggPSAwOwogICAgbGV0IGd1YXJkSW5kZXggPSAwOwogICAgY29uc3QgdGFyZ2V0VmFsdWUgPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsKCiAgICB3aGlsZSAoYXR0YWNrZXJJbmRleCA8IGF0a01hdHMubGVuZ3RoICYmIGd1YXJkSW5kZXggPCBncmRNYXRzLmxlbmd0aCkgewogICAgICAgIGlmIChndWFyZEluZGV4ID09PSAwKSB7CiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gdGFyZ2V0VmFsdWU7CiAgICAgICAgfQogICAgICAgIGV4Y2hhbmdlU2NvcmUgLT0gYXRrTWF0c1thdHRhY2tlckluZGV4XTsKICAgICAgICBpZiAoYXR0YWNrZXJJbmRleCArIDEgPCBhdGtNYXRzLmxlbmd0aCkgewogICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IGdyZE1hdHNbZ3VhcmRJbmRleF07CiAgICAgICAgfQogICAgICAgIGF0dGFja2VySW5kZXgrKzsKICAgICAgICBndWFyZEluZGV4Kys7CiAgICB9CiAgICByZXR1cm4gZXhjaGFuZ2VTY29yZTsKfTsKCi8vIOiuoeeul+WogeiDgeWAvO+8iOWfuuS6juWujOaVtOeahOWogeiDgeWFs+ezu++8iQovLyDmjInooqvlqIHog4HlrZDogZrlkIjvvJrmr4/kuKrnm67moIfmnIDlpJrkuIDmrKEgU0VF77yb5YiG5YC85Yqg57uZIHRocmVhdGVuZWRCeVswXQovLyDvvIjlhbPns7vmnoTlu7rmjIkgcGllY2VzSW5mbyDpobrluo8gcHVzaO+8jOaVheS4juaXp+KAnOaUu+WHu+aWueWkluWxgumBjeWOhummluasoeiuoeWIhuKAneW9kuWxnuS4gOiHtO+8iQpjb25zdCBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMgPSAocGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvID0gbnVsbCkgPT4gewogICAgLy8g57uf6K6hCiAgICBpZiAoY3VycmVudFBsYXllcikgewogICAgICAgIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudFtjdXJyZW50UGxheWVyXSsrOwogICAgfQoKICAgIC8vIOWIneWni+WMluWogeiDgeexu+Wei+e7n+iuoeS/oeaBrwogICAgaWYgKGJvYXJkSW5mbykgewogICAgICAgIGJvYXJkSW5mby5jaGVja3MgPSBbXTsgICAgICAvLyDlsIblhpvkv6Hmga8KICAgICAgICBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyA9IFtdOyAgLy8g6KKr5o2J55qE5qOL5a2QCiAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUgPSBbXTsgIC8vIOWPr+WQg+eahOaji+WtkAogICAgfQoKICAgIGNvbnN0IGNoZWNrQm9udXMgPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuY2hlY2suYm9udXM7CiAgICBjb25zdCBjYW5DYXB0dXJlU2VlbiA9IG5ldyBTZXQoKTsKICAgIGNvbnN0IHVzZU1hc2tzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKTsKICAgIGNvbnN0IGF0dGFja01hc2sgPSB1c2VNYXNrcyA/IGJvYXJkSW5mby5hdHRhY2tNYXNrIDogbnVsbDsKICAgIGNvbnN0IGd1YXJkTWFzayA9IHVzZU1hc2tzID8gYm9hcmRJbmZvLmd1YXJkTWFzayA6IG51bGw7CgogICAgZm9yIChsZXQgdGkgPSAwOyB0aSA8IHBpZWNlc0luZm8ubGVuZ3RoOyB0aSsrKSB7CiAgICAgICAgY29uc3QgdGhyZWF0ZW5lZFBpZWNlID0gcGllY2VzSW5mb1t0aV07CiAgICAgICAgbGV0IGZpcnN0QXR0YWNrZXI7CiAgICAgICAgbGV0IGhhc0d1YXJkOwogICAgICAgIGxldCBhdHRhY2tlckxpc3QgPSBudWxsOwoKICAgICAgICBpZiAodXNlTWFza3MpIHsKICAgICAgICAgICAgY29uc3Qgc3EgPSB0aHJlYXRlbmVkUGllY2UuciAqIDkgKyB0aHJlYXRlbmVkUGllY2UuYzsKICAgICAgICAgICAgY29uc3QgYW0gPSBhdHRhY2tNYXNrW3NxXTsKICAgICAgICAgICAgaWYgKGFtID09PSAwKSBjb250aW51ZTsKICAgICAgICAgICAgLy8g5pyA5L2OIGJpdCA9IHBpZWNlc0luZm8g6aG65bqP5LiL5pyA5YWI5oyC5LiK55qE5pS75Ye75pa577yI5LiO5penIHRocmVhdGVuZWRCeVswXSDkuIDoh7TvvIkKICAgICAgICAgICAgZmlyc3RBdHRhY2tlciA9IHBpZWNlc0luZm9bbG93ZXN0U2V0Qml0SW5kZXgoYW0pXTsKICAgICAgICAgICAgaGFzR3VhcmQgPSBndWFyZE1hc2tbc3FdICE9PSAwOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGNvbnN0IGF0dGFja2VycyA9IHRocmVhdGVuZWRQaWVjZS50aHJlYXRlbmVkQnk7CiAgICAgICAgICAgIGlmICghYXR0YWNrZXJzIHx8IGF0dGFja2Vycy5sZW5ndGggPT09IDApIGNvbnRpbnVlOwogICAgICAgICAgICBmaXJzdEF0dGFja2VyID0gYXR0YWNrZXJzWzBdOwogICAgICAgICAgICBoYXNHdWFyZCA9IHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnkgJiYgdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeS5sZW5ndGggPiAwOwogICAgICAgICAgICBhdHRhY2tlckxpc3QgPSBhdHRhY2tlcnM7CiAgICAgICAgfQoKICAgICAgICAvLyDlsIblhpvvvJrlj6rnu5nlsI/pop3lhYjmiYvliIbvvIznu53kuI3mjInlsIYv5biF5p2Q5paZ5YC85YGaIFNFRQogICAgICAgIGlmICh0aHJlYXRlbmVkUGllY2UucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgewogICAgICAgICAgICBpZiAoYm9hcmRJbmZvKSB7CiAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsKICAgICAgICAgICAgICAgICAgICBmb3JFYWNoU2V0Qml0KGF0dGFja01hc2tbdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmNdLCAoYWkpID0+IHsKICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNoZWNrcy5wdXNoKHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja2VyOiBwaWVjZXNJbmZvW2FpXSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldDogdGhyZWF0ZW5lZFBpZWNlLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNDaGVjazogdHJ1ZQogICAgICAgICAgICAgICAgICAgICAgICB9KTsKICAgICAgICAgICAgICAgICAgICB9KTsKICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgYWkgPSAwOyBhaSA8IGF0dGFja2VyTGlzdC5sZW5ndGg7IGFpKyspIHsKICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNoZWNrcy5wdXNoKHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja2VyOiBhdHRhY2tlckxpc3RbYWldLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiB0aHJlYXRlbmVkUGllY2UsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0NoZWNrOiB0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IGNoZWNrQm9udXM7CiAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH0KCiAgICAgICAgLy8g5Y+q5oqK5a+55pS75Ye75pa55pyJ5Yip55qE5aiB6IOB6K6h5YWlIHRocmVhdFZhbHVl77yI5Y2V5ZCR6K6h5YWl77yM5LiN5YGaIHNhZmV0eSDlr7nnp7DmiaPliIbvvIkKICAgICAgICBpZiAoIWhhc0d1YXJkKSB7CiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7CiAgICAgICAgICAgIGlmIChib2FyZEluZm8pIHsKICAgICAgICAgICAgICAgIGlmIChmaXJzdEF0dGFja2VyLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7CiAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGZvckVhY2hTZXRCaXQoYXR0YWNrTWFza1t0aHJlYXRlbmVkUGllY2UuciAqIDkgKyB0aHJlYXRlbmVkUGllY2UuY10sIChhaSkgPT4gewogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9bYWldOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5DYXB0dXJlU2Vlbi5oYXMoaW5mbykpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYW5DYXB0dXJlU2Vlbi5hZGQoaW5mbyk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUucHVzaChpbmZvKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgYWkgPSAwOyBhaSA8IGF0dGFja2VyTGlzdC5sZW5ndGg7IGFpKyspIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBhdHRhY2tlckxpc3RbYWldOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5DYXB0dXJlU2Vlbi5oYXMoaW5mbykpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYW5DYXB0dXJlU2Vlbi5hZGQoaW5mbyk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUucHVzaChpbmZvKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMucHVzaCh0aHJlYXRlbmVkUGllY2UpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgY29uc3Qgc3NlU2NvcmUgPSB1c2VNYXNrcwogICAgICAgICAgICAgICAgPyBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlRnJvbU1hc2tzKHRocmVhdGVuZWRQaWVjZSwgcGllY2VzSW5mbywgYXR0YWNrTWFzaywgZ3VhcmRNYXNrKQogICAgICAgICAgICAgICAgOiBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlKHRocmVhdGVuZWRQaWVjZSk7CiAgICAgICAgICAgIGlmIChzc2VTY29yZSA+IDApIHsKICAgICAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gc3NlU2NvcmUgKiAwLjU7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9Cn07CgovLyDlsIbnmoTnqbrmjqfpgrvmoLzvvIjkuI4gZmlsbCDkuK0gZ2VuZXJhbCDnqbrnnYAgY29udHJvbCDkuIDoh7TvvIkKY29uc3QgZm9yRWFjaEdlbmVyYWxFbXB0eUNvbnRyb2wgPSAoYm9hcmQsIGdlbmVyYWwsIGZuKSA9PiB7CiAgICBjb25zdCB7IHIsIGMgfSA9IGdlbmVyYWw7CiAgICBjb25zdCBpc1JlZCA9IGdlbmVyYWwucGllY2UuY29sb3IgPT09ICdyZWQnOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBuciA9IHIgKyBPUlRIX0RJUlNbaV1bMF07CiAgICAgICAgY29uc3QgbmMgPSBjICsgT1JUSF9ESVJTW2ldWzFdOwogICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsKICAgICAgICBpZiAoaXNSZWQpIHsKICAgICAgICAgICAgaWYgKG5yIDwgMCB8fCBuciA+IDIpIGNvbnRpbnVlOwogICAgICAgIH0gZWxzZSBpZiAobnIgPCA3IHx8IG5yID4gOSkgewogICAgICAgICAgICBjb250aW51ZTsKICAgICAgICB9CiAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIGZuKG5yLCBuYyk7CiAgICB9Cn07CgovLyDorqHnrpflronlhajlgLzvvJrlsIbnqbrmjqfpgrvmoLzmmK/lkKbooqvmlYzmjqcKY29uc3QgY2FsY3VsYXRlU2FmZXR5VmFsdWVzID0gKHBpZWNlc0luZm8sIGJvYXJkSW5mbywgYm9hcmQgPSBudWxsKSA9PiB7CiAgICBjb25zdCBnZW5lcmFsSW5mbyA9IFtdOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgaWYgKHBpZWNlc0luZm9baV0ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgewogICAgICAgICAgICBnZW5lcmFsSW5mby5wdXNoKHBpZWNlc0luZm9baV0pOwogICAgICAgIH0KICAgIH0KCiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VBdHRhY2tCaXRzKTsKICAgIGNvbnN0IHVzZU1hc2tzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKTsKCiAgICBmb3IgKGNvbnN0IGdlbmVyYWwgb2YgZ2VuZXJhbEluZm8pIHsKICAgICAgICBjb25zdCBnZW5lcmFsQ29sb3IgPSBnZW5lcmFsLnBpZWNlLmNvbG9yOwogICAgICAgIGNvbnN0IGVuZW15Q29sb3IgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgIGNvbnN0IGVuZW15Qml0cyA9IHVzZUF0dGFja0JpdHMKICAgICAgICAgICAgPyAoZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkQXR0YWNrIDogYm9hcmRJbmZvLmJsYWNrQXR0YWNrKQogICAgICAgICAgICA6IG51bGw7CgogICAgICAgIGNvbnN0IHZpc2l0ID0gKHIsIGMpID0+IHsKICAgICAgICAgICAgbGV0IGhhc0VuZW15Q29udHJvbDsKICAgICAgICAgICAgaWYgKHVzZUF0dGFja0JpdHMpIHsKICAgICAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbCA9IGhhc0F0dGFja0JpdChlbmVteUJpdHMsIHIgKiA5ICsgYyk7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICBjb25zdCBwb3NpdGlvbkNvbnRyb2xsZXJzID0gYm9hcmRJbmZvW3JdW2NdOwogICAgICAgICAgICAgICAgaGFzRW5lbXlDb250cm9sID0gcG9zaXRpb25Db250cm9sbGVycy5zb21lKGNvbnRyb2xsZXIgPT4gewogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gY29udHJvbGxlci5waWVjZSA/IGNvbnRyb2xsZXIucGllY2UuY29sb3IgOiBjb250cm9sbGVyLmNvbG9yOwogICAgICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gZW5lbXlDb2xvcjsKICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmIChoYXNFbmVteUNvbnRyb2wpIHsKICAgICAgICAgICAgICAgIGdlbmVyYWwuc2FmZXR5VmFsdWUgLT0gNTA7CiAgICAgICAgICAgIH0KICAgICAgICB9OwoKICAgICAgICBpZiAodXNlTWFza3MgJiYgYm9hcmQpIHsKICAgICAgICAgICAgZm9yRWFjaEdlbmVyYWxFbXB0eUNvbnRyb2woYm9hcmQsIGdlbmVyYWwsIHZpc2l0KTsKICAgICAgICB9IGVsc2UgaWYgKGdlbmVyYWwuY29udHJvbCAmJiBnZW5lcmFsLmNvbnRyb2wubGVuZ3RoKSB7CiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ2VuZXJhbC5jb250cm9sLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICB2aXNpdChnZW5lcmFsLmNvbnRyb2xbaV0uciwgZ2VuZXJhbC5jb250cm9sW2ldLmMpOwogICAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIGlmIChib2FyZCkgewogICAgICAgICAgICBmb3JFYWNoR2VuZXJhbEVtcHR5Q29udHJvbChib2FyZCwgZ2VuZXJhbCwgdmlzaXQpOwogICAgICAgIH0KICAgIH0KfTsKCi8vIC0tLSBUeXBlcyAoSW5saW5lZCB0byBhdm9pZCBpbXBvcnQgaXNzdWVzIGluIFdvcmtlcikgLS0tCi8vIC8vIHR5cGUgQ29sb3IgLSBUeXBlU2NyaXB0IHR5cGUgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5ICdyZWQnIHwgJ2JsYWNrJzsKLy8gLy8gdHlwZSBQaWVjZVR5cGUgLSBUeXBlU2NyaXB0IHR5cGUgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5ICdnZW5lcmFsJyB8ICdhZHZpc29yJyB8ICdlbGVwaGFudCcgfCAnaG9yc2UnIHwgJ2NoYXJpb3QnIHwgJ2Nhbm5vbicgfCAnc29sZGllcic7Ci8vIC8vIGludGVyZmFjZSBQaWVjZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQovLyAvLyBpbnRlcmZhY2UgUG9zaXRpb24gLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkKLy8gLy8gaW50ZXJmYWNlIE1vdmUgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkKLy8gLy8gdHlwZSBCb2FyZCAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgKFBpZWNlIHwgbnVsbClbXVtdOwoKLy8gLS0tIE9wZW5pbmcgQm9vayBUeXBlcyAtLS0KLy8gT3BlbmluZyBCb29rIEVudHJ5IC0gcmVwcmVzZW50cyBwb3NzaWJsZSBtb3ZlcyBmb3IgYSBwb3NpdGlvbgovLyBpbnRlcmZhY2UgQm9va0VudHJ5IC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5CgovLyBJbmRpdmlkdWFsIG1vdmUgaW4gb3BlbmluZyBib29rIHdpdGggbWV0YWRhdGEKLy8gaW50ZXJmYWNlIEJvb2tNb3ZlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5CgovLyAtLS0gWm9icmlzdCBIYXNoaW5nIGZvciBPcGVuaW5nIEJvb2sgLS0tCi8vIEVhY2ggcGllY2UgdHlwZS9jb2xvci9wb3NpdGlvbiBnZXRzIGEgdW5pcXVlIHJhbmRvbSA1My1iaXQgaW50ZWdlcgovLyBVc2VzIHNlZWRlZCBSTkcgZm9yIGRldGVybWluaXN0aWMgaGFzaGluZwpjbGFzcyBab2JyaXN0SGFzaGVyIHsKICAgIGhhc2hUYWJsZTsgIC8vIFtyb3ddW2NvbF1bcGllY2VJbmRleF0KICAgIHBpZWNlVG9JbmRleDsKCiAgICBjb25zdHJ1Y3RvcigpIHsKICAgICAgICB0aGlzLnBpZWNlVG9JbmRleCA9IG5ldyBNYXAoWwogICAgICAgICAgICBbJ3JlZC1nZW5lcmFsJywgMF0sCiAgICAgICAgICAgIFsncmVkLWFkdmlzb3InLCAxXSwKICAgICAgICAgICAgWydyZWQtZWxlcGhhbnQnLCAyXSwKICAgICAgICAgICAgWydyZWQtaG9yc2UnLCAzXSwKICAgICAgICAgICAgWydyZWQtY2hhcmlvdCcsIDRdLAogICAgICAgICAgICBbJ3JlZC1jYW5ub24nLCA1XSwKICAgICAgICAgICAgWydyZWQtc29sZGllcicsIDZdLAogICAgICAgICAgICBbJ2JsYWNrLWdlbmVyYWwnLCA3XSwKICAgICAgICAgICAgWydibGFjay1hZHZpc29yJywgOF0sCiAgICAgICAgICAgIFsnYmxhY2stZWxlcGhhbnQnLCA5XSwKICAgICAgICAgICAgWydibGFjay1ob3JzZScsIDEwXSwKICAgICAgICAgICAgWydibGFjay1jaGFyaW90JywgMTFdLAogICAgICAgICAgICBbJ2JsYWNrLWNhbm5vbicsIDEyXSwKICAgICAgICAgICAgWydibGFjay1zb2xkaWVyJywgMTNdLAogICAgICAgIF0pOwoKICAgICAgICAvLyBJbml0aWFsaXplIHJhbmRvbSBoYXNoIHZhbHVlcyB1c2luZyBzZWVkZWQgUk5HICg1My1iaXQgaW50ZWdlcnMgdG8gYXZvaWQgcHJlY2lzaW9uIGlzc3VlcykKICAgICAgICB0aGlzLmhhc2hUYWJsZSA9IFtdOwogICAgICAgIGNvbnN0IE1BWF9TQUZFID0gMHgxRkZGRkZGRkZGRkZGRjsgLy8gMl41MyAtIDEKICAgICAgICAKICAgICAgICAvLyBTaW1wbGUgc2VlZGVkIFJORyAoTENHIC0gTGluZWFyIENvbmdydWVudGlhbCBHZW5lcmF0b3IpCiAgICAgICAgbGV0IHNlZWQgPSAxMjM0NTY3ODk7IC8vIEZpeGVkIHNlZWQgZm9yIGRldGVybWluaXN0aWMgaGFzaGluZwogICAgICAgIGNvbnN0IHNlZWRlZFJhbmRvbSA9ICgpID0+IHsKICAgICAgICAgICAgc2VlZCA9IChzZWVkICogMTEwMzUxNTI0NSArIDEyMzQ1KSAmIDB4N2ZmZmZmZmY7CiAgICAgICAgICAgIHJldHVybiBzZWVkIC8gMHg3ZmZmZmZmZjsKICAgICAgICB9OwoKICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsKICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl0gPSBbXTsKICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsKICAgICAgICAgICAgICAgIHRoaXMuaGFzaFRhYmxlW3JdW2NdID0gW107CiAgICAgICAgICAgICAgICBmb3IgKGxldCBwID0gMDsgcCA8IDE0OyBwKyspIHsKICAgICAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBkZXRlcm1pbmlzdGljIDUzLWJpdCBpbnRlZ2VyCiAgICAgICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY11bcF0gPSBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQoKICAgICAgICAvLyDlj7bor4TkvLDnvJPlrZjplK7vvJpib2FyZEhhc2ggXiBpbml0aWF0b3JLZXkgXiBzdGFnZUtleQogICAgICAgIHRoaXMuZXZhbEluaXRpYXRvcktleXMgPSB7CiAgICAgICAgICAgIHJlZDogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwKICAgICAgICAgICAgYmxhY2s6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSkKICAgICAgICB9OwogICAgICAgIHRoaXMuZXZhbFN0YWdlS2V5cyA9IHsKICAgICAgICAgICAgZWFybHk6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSksCiAgICAgICAgICAgIG1pZDogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwKICAgICAgICAgICAgbGF0ZTogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKQogICAgICAgIH07CiAgICB9CgogICAgcGllY2VJbmRleChwaWVjZU9yS2V5KSB7CiAgICAgICAgaWYgKHBpZWNlT3JLZXkgPT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDsKICAgICAgICBpZiAodHlwZW9mIHBpZWNlT3JLZXkgPT09ICdzdHJpbmcnKSByZXR1cm4gdGhpcy5waWVjZVRvSW5kZXguZ2V0KHBpZWNlT3JLZXkpOwogICAgICAgIHJldHVybiB0aGlzLnBpZWNlVG9JbmRleC5nZXQoYCR7cGllY2VPcktleS5jb2xvcn0tJHtwaWVjZU9yS2V5LnR5cGV9YCk7CiAgICB9CgogICAgZXZhbENhY2hlS2V5KGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSkgewogICAgICAgIGNvbnN0IHN0YWdlS2V5ID0gdGhpcy5ldmFsU3RhZ2VLZXlzW2dhbWVTdGFnZV0gfHwgdGhpcy5ldmFsU3RhZ2VLZXlzLm1pZDsKICAgICAgICByZXR1cm4gdGhpcy5oYXNoKGJvYXJkKSBeIHRoaXMuZXZhbEluaXRpYXRvcktleXNbc2VhcmNoSW5pdGlhdG9yXSBeIHN0YWdlS2V5OwogICAgfQoKICAgIGV2YWxDYWNoZUtleUZyb21IYXNoKGJvYXJkSGFzaCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpIHsKICAgICAgICBjb25zdCBzdGFnZUtleSA9IHRoaXMuZXZhbFN0YWdlS2V5c1tnYW1lU3RhZ2VdIHx8IHRoaXMuZXZhbFN0YWdlS2V5cy5taWQ7CiAgICAgICAgcmV0dXJuIGJvYXJkSGFzaCBeIHRoaXMuZXZhbEluaXRpYXRvcktleXNbc2VhcmNoSW5pdGlhdG9yXSBeIHN0YWdlS2V5OwogICAgfQoKICAgIC8qKgogICAgICog5pWw5YC8IFRUIGtlee+8muaKiuihjOaji+aWuee8lueggei/m+acgOS9juS9je+8jOmBv+WFjSBgaGFzaCBeIHNpZGVLZXlgIOWcqCBKUyBUb0ludDMyCiAgICAgKiDkuIvkuqfnlJ/ot6jnuqLpu5HnorDmkp7vvIjpgqPkvJrkvb8gVFQg6K+v5ZG95Lit5bm25pS55Y+Y5pCc57Si5qCRL+aji+WKm++8ieOAggogICAgICog562J5Lu35LqO5pen5a2X56ym5LiyIGtleSBgJHtoYXNofToke3NpZGV9YCDnmoTljLrliIbog73lipvjgIIKICAgICAqLwogICAgdHRLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNpZGUpIHsKICAgICAgICBjb25zdCBoID0gYm9hcmRIYXNoIHwgMDsgLy8gXj0g6ZO+57uT5p6c5bey5pivIEludDMyCiAgICAgICAgcmV0dXJuIGggKiAyICsgKHNpZGUgPT09ICdyZWQnID8gMCA6IDEpOwogICAgfQoKICAgIC8qKgogICAgICogQ29tcHV0ZSBoYXNoIGZvciBhIGJvYXJkIHBvc2l0aW9uCiAgICAgKi8KICAgIGhhc2goYm9hcmQpIHsKICAgICAgICBsZXQgaCA9IDA7CiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7CiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGllY2VJZHggPSB0aGlzLnBpZWNlSW5kZXgocGllY2UpOwogICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZUlkeCAhPT0gdW5kZWZpbmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGggXj0gdGhpcy5oYXNoVGFibGVbcl1bY11bcGllY2VJZHhdOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICByZXR1cm4gaDsKICAgIH0KCiAgICAvKioKICAgICAqIE1pcnJvciBhIGJvYXJkIGhvcml6b250YWxseSAoZm9yIHN5bW1ldHJ5IGRldGVjdGlvbikKICAgICAqLwogICAgbWlycm9yQm9hcmQoYm9hcmQpIHsKICAgICAgICBjb25zdCBtaXJyb3JlZCA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpKTsKICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsKICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsKICAgICAgICAgICAgICAgIG1pcnJvcmVkW3JdWzggLSBjXSA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybiBtaXJyb3JlZDsKICAgIH0KCiAgICAvKioKICAgICAqIE1pcnJvciBhIG1vdmUgaG9yaXpvbnRhbGx5CiAgICAgKi8KICAgIG1pcnJvck1vdmUobW92ZSkgewogICAgICAgIHJldHVybiB7CiAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IDggLSBtb3ZlLmZyb20uYyB9LAogICAgICAgICAgICB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IDggLSBtb3ZlLnRvLmMgfQogICAgICAgIH07CiAgICB9CgogICAgLyoqCiAgICAgKiBJbmNyZW1lbnRhbGx5IHVwZGF0ZSBoYXNoIGFmdGVyIGEgbW92ZSAoWE9SIOiHqumAhu+8muWGjeiwg+eUqOS4gOasoeWPr+i/mOWOnykuCiAgICAgKiBtb3ZpbmdQaWVjZSAvIGNhcHR1cmVkUGllY2Ug5Y+v5Li65qOL5a2Q5a+56LGh5oiWICdjb2xvci10eXBlJyDlrZfnrKbkuLLjgIIKICAgICAqIOmhu+WcqCBtYWtlTW92ZSDkuYvliY3lj5blvpcgbW92aW5nUGllY2XvvIxjYXB0dXJlZCDnlKggbWFrZU1vdmUg6L+U5Zue5YC844CCCiAgICAgKi8KICAgIHVwZGF0ZUhhc2goY3VycmVudEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZFBpZWNlKSB7CiAgICAgICAgbGV0IG5ld0hhc2ggPSBjdXJyZW50SGFzaDsKICAgICAgICBjb25zdCBtb3ZpbmdJZHggPSB0aGlzLnBpZWNlSW5kZXgobW92aW5nUGllY2UpOwogICAgICAgIGlmIChtb3ZpbmdJZHggIT09IHVuZGVmaW5lZCkgewogICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY11bbW92aW5nSWR4XTsKICAgICAgICAgICAgbmV3SGFzaCBePSB0aGlzLmhhc2hUYWJsZVttb3ZlLnRvLnJdW21vdmUudG8uY11bbW92aW5nSWR4XTsKICAgICAgICB9CiAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsKICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRJZHggPSB0aGlzLnBpZWNlSW5kZXgoY2FwdHVyZWRQaWVjZSk7CiAgICAgICAgICAgIGlmIChjYXB0dXJlZElkeCAhPT0gdW5kZWZpbmVkKSB7CiAgICAgICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUudG8ucl1bbW92ZS50by5jXVtjYXB0dXJlZElkeF07CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgcmV0dXJuIG5ld0hhc2g7CiAgICB9Cn0KCi8qKgogKiBPcGVuaW5nIEJvb2sgTWFuYWdlcgogKi8KY2xhc3MgT3BlbmluZ0Jvb2sgewogICAgYm9vazsgIC8vIFpvYnJpc3QgaGFzaCAtPiBtb3ZlcwogICAgaGFzaGVyOwogICAgZW5hYmxlZDsKICAgIG1heFBseTsgIC8vIE1heGltdW0gcGx5IHRvIHVzZSBvcGVuaW5nIGJvb2sgKGUuZy4sIDIwKQoKICAgIGNvbnN0cnVjdG9yKG1heFBseSA9IDEyKSB7CiAgICAgICAgdGhpcy5ib29rID0gbmV3IE1hcCgpOwogICAgICAgIHRoaXMuaGFzaGVyID0gbmV3IFpvYnJpc3RIYXNoZXIoKTsKICAgICAgICB0aGlzLmVuYWJsZWQgPSB0cnVlOwogICAgICAgIHRoaXMubWF4UGx5ID0gbWF4UGx5OwogICAgICAgIHRoaXMuaW5pdGlhbGl6ZUJvb2soKTsKICAgIH0KCiAgICAvKioKICAgICAqIEluaXRpYWxpemUgd2l0aCBjb21tb24gQ2hpbmVzZSBDaGVzcyBvcGVuaW5ncwogICAgICovCiAgICBpbml0aWFsaXplQm9vaygpIHsKICAgICAgICAvLyBBZGQgY2xhc3NpYyBDaGluZXNlIENoZXNzIG9wZW5pbmdzIG1hbnVhbGx5CiAgICAgICAgCiAgICAgICAgLyoKICAgICAgICAvLyAxLiDkuK3ngq7ov4fmsrPovablr7nlsY/po47pqazlubPngq7lr7novaYgKENlbnRyYWwgQ2Fubm9uIHZzIFNjcmVlbiBIb3JzZXMpCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZShbCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA3LCBjOiA3IH0sIHRvOiB7IHI6IDcsIGM6IDQgfSB9LCAgLy8gMS4g54Ku5LqM5bmz5LqUCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiA3IH0sIHRvOiB7IHI6IDIsIGM6IDYgfSB9LCAgLy8gMS4uLiDpqaw46L+bNwogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogNyB9LCB0bzogeyByOiA3LCBjOiA2IH0gfSwgIC8vIDIuIOmprOS6jOi/m+S4iQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogOCB9LCB0bzogeyByOiAwLCBjOiA3IH0gfSwgIC8vIDIuLi4g6L2mOeW5szggICAgICAgICAgIAogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogOCB9LCB0bzogeyByOiA5LCBjOiA3IH0gfSwgIC8vIDMuIOi9puS4gOW5s+S6jAogICAgICAgICAgICB7IGZyb206IHsgcjogMywgYzogNiB9LCB0bzogeyByOiA0LCBjOiA2IH0gfSwgIC8vIDMuLi4g5Y2SN+i/mzEKICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDcgfSwgdG86IHsgcjogMywgYzogNyB9IH0sICAvLyA0LiDovabkuozov5vlha0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDEgfSwgdG86IHsgcjogMiwgYzogMiB9IH0sICAvLyA0Li4uIOmprDLov5szCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA2LCBjOiAyIH0sIHRvOiB7IHI6IDUsIGM6IDIgfSB9LCAgLy8gNS4g5YW15LiD6L+b5LiACiAgICAgICAgICAgIHsgZnJvbTogeyByOiAyLCBjOiA3IH0sIHRvOiB7IHI6IDIsIGM6IDggfSB9LCAgLy8gNS4uLiDngq445bmzOQogICAgICAgICAgICB7IGZyb206IHsgcjogMywgYzogNyB9LCB0bzogeyByOiAzLCBjOiA2IH0gfSwgIC8vIDYuIOi9puS6jOW5s+S4iQogICAgICAgICAgICB7IGZyb206IHsgcjogMiwgYzogOCB9LCB0bzogeyByOiAxLCBjOiA4IH0gfSwgIC8vIDYuLi4g54KuOemAgDEgICAgICAgICAgCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsKCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihbCiAgICAgICAgICAgICfngq7kuozlubPkupQnLCAn6amsOOi/mzcnLCAn6ams5LqM6L+b5LiJJywgJ+i9pjnlubM4JywgJ+i9puS4gOW5s+S6jCcsICfljZI36L+bMScsCiAgICAgICAgICAgICfovabkuozov5vlha0nLCAn6amsMui/mzMnLCAn5YW15LiD6L+b5LiAJywgJ+eCrjjlubM5JywgJ+i9puS6jOW5s+S4iScsICfngq456YCAMScsCiAgICAgICAgICAgIF0sIFs4NSwgODUsIDk1LCA5MCwgOTAsIDg1LCA4NSwgODAsIDg1LCA4NSwgODUsIDg1XSk7CgogICAgICAgICAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21TdHJpbmcoWwogICAgICAgICAgICAn54Ku5LqM5bmz5LqUIOmprDjov5s3IOmprOS6jOi/m+S4iSDovaY55bmzOCDovabkuIDlubPkuowg5Y2SN+i/mzEg6L2m5LqM6L+b5YWtIOmprDLov5szIOWFteS4g+i/m+S4gCDngq445bmzOSDovabkuozlubPkuIkg54KuOemAgDEnCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsKICAgICAgICAqLwogICAgfQoKICAgIC8qKgogICAgICogQWRkIGFuIG9wZW5pbmcgbGluZSB0byB0aGUgYm9vawogICAgICogQHBhcmFtIG1vdmVzIEFycmF5IG9mIG1vdmVzIHJlcHJlc2VudGluZyBhbiBvcGVuaW5nIGxpbmUKICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIHdlaWdodHMgZm9yIGVhY2ggbW92ZSAoZGVmYXVsdCAxMDAgZm9yIGFsbCkKICAgICAqLwogICAgYWRkT3BlbmluZ0xpbmUobW92ZXMsIHdlaWdodHMpIHsKICAgICAgICAvLyBTdGFydCB3aXRoIGluaXRpYWwgYm9hcmQgcG9zaXRpb24KICAgICAgICBjb25zdCBib2FyZCA9IHRoaXMuY3JlYXRlSW5pdGlhbEJvYXJkKCk7CiAgICAgICAgbGV0IGN1cnJlbnRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChib2FyZCk7CgogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW92ZXMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2ldOwogICAgICAgICAgICBjb25zdCB3ZWlnaHQgPSB3ZWlnaHRzPy5baV0gPz8gMTAwOwoKICAgICAgICAgICAgLy8gR2V0IG9yIGNyZWF0ZSBib29rIGVudHJ5IGZvciB0aGlzIHBvc2l0aW9uCiAgICAgICAgICAgIGxldCBlbnRyeSA9IHRoaXMuYm9vay5nZXQoY3VycmVudEhhc2gpOwogICAgICAgICAgICBpZiAoIWVudHJ5KSB7CiAgICAgICAgICAgICAgICBlbnRyeSA9IHsgbW92ZXM6IFtdIH07CiAgICAgICAgICAgICAgICB0aGlzLmJvb2suc2V0KGN1cnJlbnRIYXNoLCBlbnRyeSk7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIC8vIEFkZCBtb3ZlIGlmIG5vdCBhbHJlYWR5IHByZXNlbnQKICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdNb3ZlID0gZW50cnkubW92ZXMuZmluZCgKICAgICAgICAgICAgICAgIG0gPT4gbS5mcm9tLnIgPT09IG1vdmUuZnJvbS5yICYmIG0uZnJvbS5jID09PSBtb3ZlLmZyb20uYyAmJgogICAgICAgICAgICAgICAgICAgICBtLnRvLnIgPT09IG1vdmUudG8uciAmJiBtLnRvLmMgPT09IG1vdmUudG8uYwogICAgICAgICAgICApOwoKICAgICAgICAgICAgaWYgKCFleGlzdGluZ01vdmUpIHsKICAgICAgICAgICAgICAgIGVudHJ5Lm1vdmVzLnB1c2goewogICAgICAgICAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sCiAgICAgICAgICAgICAgICAgICAgdG86IHsgcjogbW92ZS50by5yLCBjOiBtb3ZlLnRvLmMgfSwKICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHdlaWdodAogICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgd2VpZ2h0IGlmIG1vdmUgYWxyZWFkeSBleGlzdHMgKHRha2UgbWF4aW11bSkKICAgICAgICAgICAgICAgIGV4aXN0aW5nTW92ZS53ZWlnaHQgPSBNYXRoLm1heChleGlzdGluZ01vdmUud2VpZ2h0LCB3ZWlnaHQpOwogICAgICAgICAgICB9CgogICAgICAgICAgICAvLyBNYWtlIHRoZSBtb3ZlIG9uIHRoZSBib2FyZAogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107CiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkID0gYm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdOwogICAgICAgICAgICAKICAgICAgICAgICAgaWYgKCFwaWVjZSkgYnJlYWs7IC8vIEludmFsaWQgbGluZQoKICAgICAgICAgICAgY29uc3QgcGllY2VLZXkgPSBgJHtwaWVjZS5jb2xvcn0tJHtwaWVjZS50eXBlfWA7CiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkS2V5ID0gY2FwdHVyZWQgPyBgJHtjYXB0dXJlZC5jb2xvcn0tJHtjYXB0dXJlZC50eXBlfWAgOiB1bmRlZmluZWQ7CgogICAgICAgICAgICAvLyBVcGRhdGUgaGFzaCBpbmNyZW1lbnRhbGx5CiAgICAgICAgICAgIGN1cnJlbnRIYXNoID0gdGhpcy5oYXNoZXIudXBkYXRlSGFzaChjdXJyZW50SGFzaCwgbW92ZSwgcGllY2VLZXksIGNhcHR1cmVkS2V5KTsKCiAgICAgICAgICAgIC8vIEFwcGx5IG1vdmUKICAgICAgICAgICAgYm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdID0gcGllY2U7CiAgICAgICAgICAgIGJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY10gPSBudWxsOwogICAgICAgIH0KICAgIH0KCiAgICAvKioKICAgICAqIEdldCBiZXN0IG1vdmUgZnJvbSBvcGVuaW5nIGJvb2sgZm9yIGN1cnJlbnQgcG9zaXRpb24KICAgICAqIEBwYXJhbSBib2FyZCBDdXJyZW50IGJvYXJkIHN0YXRlCiAgICAgKiBAcGFyYW0gcGx5IEN1cnJlbnQgcGx5IG51bWJlciAoMCA9IHN0YXJ0IG9mIGdhbWUpCiAgICAgKiBAcmV0dXJucyBNb3ZlIGZyb20gYm9vaywgb3IgbnVsbCBpZiBwb3NpdGlvbiBub3QgaW4gYm9vawogICAgICovCiAgICBnZXRCb29rTW92ZShib2FyZCwgcGx5KXsKICAgICAgICAvLyBEb24ndCB1c2UgYm9vayBpZiBkaXNhYmxlZCBvciBwYXN0IG1heCBwbHkKICAgICAgICBpZiAoIXRoaXMuZW5hYmxlZCB8fCBwbHkgPj0gdGhpcy5tYXhQbHkpIHsKICAgICAgICAgICAgY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBkaXNhYmxlZCBvciBwYXN0IG1heCBwbHknLCB7IGVuYWJsZWQ6IHRoaXMuZW5hYmxlZCwgbWF4UGx5OiB0aGlzLm1heFBseSwgcGx5OiBwbHkgfSk7CiAgICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgIH0KICAgICAgICAKICAgICAgICAvL2NvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgZ2V0Qm9va01vdmUgY2FsbGVkJywgeyBwbHkgfSk7CiAgICAgICAgCiAgICAgICAgLy8gVHJ5IHRvIGZpbmQgbW92ZSBmb3IgY3VycmVudCBwb3NpdGlvbgogICAgICAgIGNvbnN0IGhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKGJvYXJkKTsKICAgICAgICAvL2NvbnNvbGUubG9nKCdDdXJyZW50IHBvc2l0aW9uIGhhc2g6JywgaGFzaCk7CiAgICAgICAgCiAgICAgICAgbGV0IGVudHJ5ID0gdGhpcy5ib29rLmdldChoYXNoKTsKICAgICAgICAvL2NvbnNvbGUubG9nKCdFbnRyeSBmb3VuZCBmb3IgY3VycmVudCBoYXNoOicsIGVudHJ5ID8gZW50cnkubW92ZXMubGVuZ3RoICsgJyBtb3ZlcycgOiAnbnVsbCcpOwogICAgICAgIGlmIChlbnRyeSAmJiBlbnRyeS5tb3Zlcy5sZW5ndGggPiAwKSB7CiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdBbGwgcG9zc2libGUgYm9vayBtb3ZlcyB3aXRoIHdlaWdodHM6JywgSlNPTi5zdHJpbmdpZnkoZW50cnkubW92ZXMpKTsKICAgICAgICAgICAgLy8gQ2FsY3VsYXRlIHRvdGFsIHdlaWdodAogICAgICAgICAgICBjb25zdCB0b3RhbFdlaWdodCA9IGVudHJ5Lm1vdmVzLnJlZHVjZSgoc3VtLCBtb3ZlKSA9PiBzdW0gKyBtb3ZlLndlaWdodCwgMCk7CiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdUb3RhbCB3ZWlnaHQ6JywgdG90YWxXZWlnaHQpOwogICAgICAgIH0KICAgICAgICAKICAgICAgICBsZXQgbWlycm9yZWRNb3ZlID0gZmFsc2U7CgogICAgICAgIC8vIElmIG5vdCBmb3VuZCwgdHJ5IG1pcnJvcmVkIHBvc2l0aW9uCiAgICAgICAgaWYgKCFlbnRyeSB8fCBlbnRyeS5tb3Zlcy5sZW5ndGggPT09IDApIHsKICAgICAgICAgICAgY29uc3QgbWlycm9yZWRCb2FyZCA9IHRoaXMuaGFzaGVyLm1pcnJvckJvYXJkKGJvYXJkKTsKICAgICAgICAgICAgY29uc3QgbWlycm9yZWRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChtaXJyb3JlZEJvYXJkKTsKICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIGVudHJ5IGZvdW5kLCB0cnlpbmcgbWlycm9yZWQgcG9zaXRpb246JywgbWlycm9yZWRIYXNoKTsKICAgICAgICAgICAgCiAgICAgICAgICAgIGVudHJ5ID0gdGhpcy5ib29rLmdldChtaXJyb3JlZEhhc2gpOwogICAgICAgICAgICBpZiAoZW50cnkgJiYgZW50cnkubW92ZXMubGVuZ3RoID4gMCkgewogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnRW50cnkgZm91bmQgZm9yIG1pcnJvcmVkIGhhc2g6JywgZW50cnkubW92ZXMubGVuZ3RoICsgJyBtb3ZlcycpOwogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnT3JpZ2luYWwgbWlycm9yIG1vdmVzOicsIEpTT04uc3RyaW5naWZ5KGVudHJ5Lm1vdmVzKSk7CiAgICAgICAgICAgICAgICBtaXJyb3JlZE1vdmUgPSB0cnVlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnTm8gZW50cnkgZm91bmQgZm9yIG1pcnJvcmVkIGhhc2gnKTsKICAgICAgICAgICAgfQogICAgICAgIH0KCiAgICAgICAgaWYgKCFlbnRyeSB8fCBlbnRyeS5tb3Zlcy5sZW5ndGggPT09IDApIHsKICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnT3BlbmluZyBib29rIG1vdmUgbm90IGZvdW5kIGZvciBjdXJyZW50IHBvc2l0aW9uJyk7CiAgICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgIH0KCiAgICAgICAgLy8gU2VsZWN0IG1vdmUgYmFzZWQgb24gd2VpZ2h0cwogICAgICAgIGNvbnN0IHNlbGVjdGVkTW92ZSA9IHRoaXMuc2VsZWN0V2VpZ2h0ZWRNb3ZlKGVudHJ5Lm1vdmVzKTsKICAgICAgICBjb25zb2xlLmxvZygnT3BlbmluZyBib29rIG1vdmUgc2VsZWN0ZWQ6Jywgc2VsZWN0ZWRNb3ZlKTsKICAgICAgICAKICAgICAgICAvLyBJZiB3ZSB1c2VkIG1pcnJvcmVkIHBvc2l0aW9uLCBtaXJyb3IgdGhlIG1vdmUgYmFjawogICAgICAgIGlmIChzZWxlY3RlZE1vdmUgJiYgbWlycm9yZWRNb3ZlKSB7CiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdTZWxlY3RlZCBtaXJyb3IgbW92ZSBiZWZvcmUgY29udmVyc2lvbjonLCBKU09OLnN0cmluZ2lmeShzZWxlY3RlZE1vdmUpKTsKICAgICAgICAgICAgY29uc3QgbWlycm9yZWRNb3ZlQ29udmVydGVkID0gdGhpcy5oYXNoZXIubWlycm9yTW92ZShzZWxlY3RlZE1vdmUpOwogICAgICAgICAgICAvLyBjb25zb2xlLmxvZygnQ29udmVydGVkIG1pcnJvciBtb3ZlOicsIEpTT04uc3RyaW5naWZ5KG1pcnJvcmVkTW92ZUNvbnZlcnRlZCkpOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIG1pcnJvcmVkIG1vdmUgaGFzIHZhbGlkIHN0cnVjdHVyZQogICAgICAgICAgICBpZiAobWlycm9yZWRNb3ZlQ29udmVydGVkICYmIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tICYmIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50byAmJgogICAgICAgICAgICAgICAgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbS5jID09PSAnbnVtYmVyJyAmJgogICAgICAgICAgICAgICAgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvLmMgPT09ICdudW1iZXInKSB7CiAgICAgICAgICAgICAgICByZXR1cm4gbWlycm9yZWRNb3ZlQ29udmVydGVkOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ01pcnJvcmVkIG1vdmUgaGFzIGludmFsaWQgc3RydWN0dXJlLCByZXR1cm5pbmcgbnVsbCcpOwogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7CiAgICAgICAgICAgIH0KICAgICAgICB9IGVsc2UgaWYgKHNlbGVjdGVkTW92ZSkgewogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgc2VsZWN0ZWQgbW92ZSBoYXMgdmFsaWQgc3RydWN0dXJlCiAgICAgICAgICAgIGlmIChzZWxlY3RlZE1vdmUuZnJvbSAmJiBzZWxlY3RlZE1vdmUudG8gJiYKICAgICAgICAgICAgICAgIHR5cGVvZiBzZWxlY3RlZE1vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLmZyb20uYyA9PT0gJ251bWJlcicgJiYKICAgICAgICAgICAgICAgIHR5cGVvZiBzZWxlY3RlZE1vdmUudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIHNlbGVjdGVkTW92ZS50by5jID09PSAnbnVtYmVyJykgewogICAgICAgICAgICAgICAgcmV0dXJuIHNlbGVjdGVkTW92ZTsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZWxlY3RlZCBtb3ZlIGhhcyBpbnZhbGlkIHN0cnVjdHVyZSwgcmV0dXJuaW5nIG51bGwnKTsKICAgICAgICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIAogICAgICAgIHJldHVybiBudWxsOwogICAgfQoKICAgIC8qKgogICAgICogU2VsZWN0IGEgbW92ZSByYW5kb21seSBiYXNlZCBvbiB3ZWlnaHRzCiAgICAgKiBIaWdoZXIgd2VpZ2h0ID0gbW9yZSBsaWtlbHkgdG8gYmUgc2VsZWN0ZWQKICAgICAqLwogICAgc2VsZWN0V2VpZ2h0ZWRNb3ZlKG1vdmVzKSB7CiAgICAgICAgLy8gQ2FsY3VsYXRlIHRvdGFsIHdlaWdodAogICAgICAgIGNvbnN0IHRvdGFsV2VpZ2h0ID0gbW92ZXMucmVkdWNlKChzdW0sIG1vdmUpID0+IHN1bSArIG1vdmUud2VpZ2h0LCAwKTsKCiAgICAgICAgLy8gR2VuZXJhdGUgcmFuZG9tIG51bWJlcgogICAgICAgIGxldCByYW5kb20gPSBNYXRoLnJhbmRvbSgpICogdG90YWxXZWlnaHQ7CgogICAgICAgIC8vIFNlbGVjdCBtb3ZlCiAgICAgICAgZm9yIChjb25zdCBtb3ZlIG9mIG1vdmVzKSB7CiAgICAgICAgICAgIHJhbmRvbSAtPSBtb3ZlLndlaWdodDsKICAgICAgICAgICAgaWYgKHJhbmRvbSA8PSAwKSB7CiAgICAgICAgICAgICAgICByZXR1cm4gewogICAgICAgICAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmUudG8uciwgYzogbW92ZS50by5jIH0KICAgICAgICAgICAgICAgIH07CiAgICAgICAgICAgIH0KICAgICAgICB9CgogICAgICAgIC8vIEZhbGxiYWNrIChzaG91bGQgbmV2ZXIgcmVhY2ggaGVyZSkKICAgICAgICByZXR1cm4gewogICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmVzWzBdLmZyb20uciwgYzogbW92ZXNbMF0uZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmVzWzBdLnRvLnIsIGM6IG1vdmVzWzBdLnRvLmMgfQogICAgICAgIH07CiAgICB9CgogICAgLyoqCiAgICAgKiBIZWxwZXIgdG8gY3JlYXRlIGluaXRpYWwgYm9hcmQgKG5lZWRlZCBmb3IgYm9vayBpbml0aWFsaXphdGlvbikKICAgICAqLwogICAgY3JlYXRlSW5pdGlhbEJvYXJkKCkgewogICAgICAgIGNvbnN0IGJvYXJkID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkpOwogICAgICAgIAogICAgICAgIC8vIFJlZCBwaWVjZXMgKGJvdHRvbSAtIHI9MC0yKQogICAgICAgIGJvYXJkWzBdWzBdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAncmVkJyB9OwogICAgICAgIGJvYXJkWzBdWzFdID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFswXVsyXSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbMF1bM10gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbMF1bNF0gPSB7IHR5cGU6ICdnZW5lcmFsJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbMF1bNV0gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbMF1bNl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAncmVkJyB9OwogICAgICAgIGJvYXJkWzBdWzddID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFswXVs4XSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFsyXVsxXSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAncmVkJyB9OwogICAgICAgIGJvYXJkWzJdWzddID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbM11bMF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbM11bMl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbM11bNF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbM11bNl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbM11bOF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07CgogICAgICAgIC8vIEJsYWNrIHBpZWNlcyAodG9wIC0gcj03LTkpCiAgICAgICAgYm9hcmRbOV1bMF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVsxXSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVsyXSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVszXSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzldWzRdID0geyB0eXBlOiAnZ2VuZXJhbCcsIGNvbG9yOiAnYmxhY2snIH07CiAgICAgICAgYm9hcmRbOV1bNV0gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVs2XSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVs3XSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVs4XSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzddWzFdID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs3XVs3XSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAnYmxhY2snIH07CiAgICAgICAgYm9hcmRbNl1bMF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs2XVsyXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzZdWzRdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07CiAgICAgICAgYm9hcmRbNl1bNl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs2XVs4XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9OwoKICAgICAgICByZXR1cm4gYm9hcmQ7CiAgICB9CgogICAgLyoqCiAgICAgKiBFbmFibGUgb3IgZGlzYWJsZSBvcGVuaW5nIGJvb2sKICAgICAqLwogICAgc2V0RW5hYmxlZChlbmFibGVkKSB7CiAgICAgICAgdGhpcy5lbmFibGVkID0gZW5hYmxlZDsKICAgIH0KCiAgICAvKioKICAgICAqIENoZWNrIGlmIG9wZW5pbmcgYm9vayBpcyBlbmFibGVkCiAgICAgKi8KICAgIGlzRW5hYmxlZCgpIHsKICAgICAgICByZXR1cm4gdGhpcy5lbmFibGVkOwogICAgfQoKICAgIC8qKgogICAgICogR2V0IHN0YXRpc3RpY3MgYWJvdXQgdGhlIG9wZW5pbmcgYm9vawogICAgICovCiAgICBnZXRTdGF0cygpIHsKICAgICAgICBsZXQgdG90YWxNb3ZlcyA9IDA7CiAgICAgICAgdGhpcy5ib29rLmZvckVhY2goZW50cnkgPT4gewogICAgICAgICAgICB0b3RhbE1vdmVzICs9IGVudHJ5Lm1vdmVzLmxlbmd0aDsKICAgICAgICB9KTsKCiAgICAgICAgcmV0dXJuIHsKICAgICAgICAgICAgcG9zaXRpb25zOiB0aGlzLmJvb2suc2l6ZSwKICAgICAgICAgICAgdG90YWxNb3ZlcwogICAgICAgIH07CiAgICB9CgogICAgLyoqCiAgICAgKiBBZGQgb3BlbmluZyBsaW5lIGZyb20gdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbgogICAgICogQHBhcmFtIG5vdGF0aW9uIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbiAoZS5nLiwgWyfngq7kuozlubPkupQnLCAn6amsOOi/mzcnXSkKICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIGFycmF5IG9mIHdlaWdodHMgZm9yIGVhY2ggbW92ZQogICAgICovCiAgICBhZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihub3RhdGlvbiwgd2VpZ2h0cykgewogICAgICAgIC8vIENvbnZlcnQgdHJhZGl0aW9uYWwgbm90YXRpb24gdG8gY29vcmRpbmF0ZSBmb3JtYXQKICAgICAgICBjb25zdCBtb3ZlcyA9IHRoaXMubm90YXRpb25Ub01vdmVzKG5vdGF0aW9uKTsKICAgICAgICAvLyBBZGQgdGhlIG1vdmVzIHRvIHRoZSBvcGVuaW5nIGJvb2sKICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lKG1vdmVzLCB3ZWlnaHRzKTsKICAgIH0KCiAgICAvKioKICAgICAqIEFkZCBvcGVuaW5nIGxpbmUgZnJvbSBzdHJpbmcgd2l0aCBzcGFjZS1zZXBhcmF0ZWQgdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbgogICAgICogQHBhcmFtIG5vdGF0aW9uQXJyYXkgQXJyYXkgb2Ygc3RyaW5ncywgZWFjaCBjb250YWluaW5nIHNwYWNlLXNlcGFyYXRlZCBtb3ZlcyAoZS5nLiwgWyfngq7kuozlubPkupQg6amsOOi/mzcg6L2m5LiA5bmz5LqMJ10pCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCBhcnJheSBvZiB3ZWlnaHRzIGZvciBlYWNoIG1vdmUKICAgICAqLwogICAgYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKG5vdGF0aW9uQXJyYXksIHdlaWdodHMpIHsKICAgICAgICAvLyBQcm9jZXNzIGVhY2ggc3RyaW5nIGluIHRoZSBhcnJheQogICAgICAgIGlmICghbm90YXRpb25BcnJheSB8fCAhQXJyYXkuaXNBcnJheShub3RhdGlvbkFycmF5KSB8fCBub3RhdGlvbkFycmF5Lmxlbmd0aCA9PT0gMCkgewogICAgICAgICAgICByZXR1cm47CiAgICAgICAgfQogICAgICAgIG5vdGF0aW9uQXJyYXkuZm9yRWFjaChub3RhdGlvblN0cmluZyA9PiB7CiAgICAgICAgICAgIC8vIFNwbGl0IHRoZSBzdHJpbmcgYnkgc3BhY2VzIHRvIGdldCBpbmRpdmlkdWFsIG1vdmVzCiAgICAgICAgICAgIGNvbnN0IG5vdGF0aW9uID0gbm90YXRpb25TdHJpbmcuc3BsaXQoJyAnKS5maWx0ZXIobW92ZSA9PiBtb3ZlLnRyaW0oKSAhPT0gJycpOwogICAgICAgICAgICAvLyBDYWxsIGV4aXN0aW5nIGZ1bmN0aW9uIHRvIGFkZCB0aGUgbGluZQogICAgICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKG5vdGF0aW9uLCB3ZWlnaHRzKTsKICAgICAgICB9KTsKICAgIH0KCiAgICAvKioKICAgICAqIENvbnZlcnQgY29vcmRpbmF0ZS1iYXNlZCBtb3ZlcyB0byB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uCiAgICAgKiBAcGFyYW0gYm9hcmRIaXN0b3J5IEFycmF5IG9mIGJvYXJkIHN0YXRlcyByZXByZXNlbnRpbmcgdGhlIGdhbWUgaGlzdG9yeQogICAgICogQHBhcmFtIG1vdmVIaXN0b3J5IEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0CiAgICAgKiBAcmV0dXJucyBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24KICAgICAqLwogICAgbW92ZXNUb05vdGF0aW9uKGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkpIHsKICAgICAgICBjb25zdCBub3RhdGlvbiA9IFtdOwogICAgICAgIGxldCBjdXJyZW50Q29sb3IgPSAncmVkJzsgLy8gUmVkIG1vdmVzIGZpcnN0CgogICAgICAgIC8vIFR5cGUgdG8gcGllY2UgY2hhcmFjdGVyIG1hcHBpbmcKICAgICAgICBjb25zdCB0eXBlVG9QaWVjZSA9IHsKICAgICAgICAgICAgJ2dlbmVyYWwnOiB7ICdyZWQnOiAn5biFJywgJ2JsYWNrJzogJ+WwhicgfSwKICAgICAgICAgICAgJ2Fkdmlzb3InOiB7ICdyZWQnOiAn5LuVJywgJ2JsYWNrJzogJ+WjqycgfSwKICAgICAgICAgICAgJ2VsZXBoYW50JzogeyAncmVkJzogJ+ebuCcsICdibGFjayc6ICfosaEnIH0sCiAgICAgICAgICAgICdob3JzZSc6IHsgJ3JlZCc6ICfpqawnLCAnYmxhY2snOiAn6amsJyB9LAogICAgICAgICAgICAnY2hhcmlvdCc6IHsgJ3JlZCc6ICfovaYnLCAnYmxhY2snOiAn6L2mJyB9LAogICAgICAgICAgICAnY2Fubm9uJzogeyAncmVkJzogJ+eCricsICdibGFjayc6ICfngq4nIH0sCiAgICAgICAgICAgICdzb2xkaWVyJzogeyAncmVkJzogJ+WFtScsICdibGFjayc6ICfljZInIH0KICAgICAgICB9OwoKICAgICAgICAvLyBDb2x1bW4gbWFwcGluZyAoY29vcmRpbmF0ZSAwLTggdG8gdHJhZGl0aW9uYWwg5LmdLeS4gCBmb3IgcmVkLCA5LTEgZm9yIGJsYWNrKQogICAgICAgIGNvbnN0IGNvbFRvQ2hpbmVzZSA9IFsn5LmdJywgJ+WFqycsICfkuIMnLCAn5YWtJywgJ+S6lCcsICflm5snLCAn5LiJJywgJ+S6jCcsICfkuIAnXTsKICAgICAgICBjb25zdCBjb2xUb0FyYWJpYyA9IFsnOScsICc4JywgJzcnLCAnNicsICc1JywgJzQnLCAnMycsICcyJywgJzEnXTsKCiAgICAgICAgLy8gRGlnaXQgdG8gQ2hpbmVzZSBudW1iZXIgbWFwcGluZyBmb3Igc3RlcHMKICAgICAgICBjb25zdCBkaWdpdFRvQ2hpbmVzZSA9IFsnJywgJ+S4gCcsICfkuownLCAn5LiJJywgJ+WbmycsICfkupQnLCAn5YWtJywgJ+S4gycsICflhasnLCAn5LmdJ107CgogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiB0aGVyZSBhcmUgbXVsdGlwbGUgc2FtZS10eXBlIHBpZWNlcyBpbiB0aGUgc2FtZSBjb2x1bW4KICAgICAgICBjb25zdCBoYXNTYW1lVHlwZUluQ29sdW1uID0gKGJvYXJkLCBwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGV4Y2x1ZGVSb3cpID0+IHsKICAgICAgICAgICAgbGV0IGNvdW50ID0gMDsKICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NvbF07CiAgICAgICAgICAgICAgICBpZiAociA9PT0gZXhjbHVkZVJvdykgY29udGludWU7CiAgICAgICAgICAgICAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gcGllY2VUeXBlICYmIHBpZWNlLmNvbG9yID09PSBjb2xvcikgewogICAgICAgICAgICAgICAgICAgIGNvdW50Kys7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgcmV0dXJuIGNvdW50ID4gMDsKICAgICAgICB9OwoKICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZGV0ZXJtaW5lIGZyb250L2JhY2sgbWFya2VyCiAgICAgICAgY29uc3QgZ2V0RnJvbnRCYWNrTWFya2VyID0gKGJvYXJkLCBwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGN1cnJlbnRSb3cpID0+IHsKICAgICAgICAgICAgY29uc3Qgc2FtZVR5cGVQaWVjZXMgPSBbXTsKICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NvbF07CiAgICAgICAgICAgICAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gcGllY2VUeXBlICYmIHBpZWNlLmNvbG9yID09PSBjb2xvcikgewogICAgICAgICAgICAgICAgICAgIHNhbWVUeXBlUGllY2VzLnB1c2gocik7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgaWYgKHNhbWVUeXBlUGllY2VzLmxlbmd0aCA8PSAxKSByZXR1cm4gJyc7CiAgICAgICAgICAgIGlmIChjb2xvciA9PT0gJ3JlZCcpIHsKICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8iHI9Ny0577yJ77yMcuWAvOi2iuWkp+i2iumdoOi/keaVjOaWue+8jOaYryLliY0iCiAgICAgICAgICAgICAgICBjb25zdCBzb3J0ZWRSb3dzID0gWy4uLnNhbWVUeXBlUGllY2VzXS5zb3J0KChhLCBiKSA9PiBiIC0gYSk7IC8vIEhpZ2hlciByb3dzIGZpcnN0ID0gY2xvc2VyIHRvIG9wcG9uZW50CiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkUm93c1swXSA9PT0gY3VycmVudFJvdyA/ICfliY0nIDogJ+WQjic7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIhyPTAtMu+8ie+8jHLlgLzotorlsI/otorpnaDov5HmlYzmlrnvvIzmmK8i5YmNIgogICAgICAgICAgICAgICAgY29uc3Qgc29ydGVkUm93cyA9IFsuLi5zYW1lVHlwZVBpZWNlc10uc29ydCgoYSwgYikgPT4gYSAtIGIpOyAvLyBMb3dlciByb3dzIGZpcnN0ID0gY2xvc2VyIHRvIG9wcG9uZW50CiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkUm93c1swXSA9PT0gY3VycmVudFJvdyA/ICfliY0nIDogJ+WQjic7CiAgICAgICAgICAgIH0KICAgICAgICB9OwoKICAgICAgICAvLyBQcm9jZXNzIGVhY2ggbW92ZQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW92ZUhpc3RvcnkubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVIaXN0b3J5W2ldOwogICAgICAgICAgICBjb25zdCBib2FyZEJlZm9yZSA9IGJvYXJkSGlzdG9yeVtpXTsKICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZEJlZm9yZVttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOwogICAgICAgICAgICAKICAgICAgICAgICAgaWYgKCFwaWVjZSkgewogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gcGllY2UgZm91bmQgYXQgZnJvbSBwb3NpdGlvbjonLCBtb3ZlLmZyb20pOwogICAgICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlLnR5cGU7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlQ2hhciA9IHR5cGVUb1BpZWNlW3BpZWNlVHlwZV1bcGllY2UuY29sb3JdOwogICAgICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlIGFyZSBtdWx0aXBsZSBzYW1lLXR5cGUgcGllY2VzIGluIHRoZSBzYW1lIGNvbHVtbgogICAgICAgICAgICBjb25zdCBoYXNEdXBsaWNhdGUgPSBoYXNTYW1lVHlwZUluQ29sdW1uKGJvYXJkQmVmb3JlLCBwaWVjZVR5cGUsIHBpZWNlLmNvbG9yLCBtb3ZlLmZyb20uYywgbW92ZS5mcm9tLnIpOwogICAgICAgICAgICAvLyBHZXQgZnJvbnQvYmFjayBtYXJrZXIgaWYgbmVlZGVkCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uTWFya2VyID0gaGFzRHVwbGljYXRlID8gZ2V0RnJvbnRCYWNrTWFya2VyKGJvYXJkQmVmb3JlLCBwaWVjZVR5cGUsIHBpZWNlLmNvbG9yLCBtb3ZlLmZyb20uYywgbW92ZS5mcm9tLnIpIDogJyc7CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBEZXRlcm1pbmUgbm90YXRpb24gYmFzZWQgb24gcGllY2UgdHlwZSBhbmQgbW92ZSBkaXJlY3Rpb24KICAgICAgICAgICAgbGV0IG5vdGF0aW9uU3RyOwogICAgICAgICAgICAKICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2hvcnNlJyB8fCBwaWVjZVR5cGUgPT09ICdhZHZpc29yJyB8fCBwaWVjZVR5cGUgPT09ICdlbGVwaGFudCcpIHsKICAgICAgICAgICAgICAgIC8vIERpYWdvbmFsIG1vdmluZyBwaWVjZXMgLSBvbmx5IHVzZSDov5sv6YCALCByZWNvcmQgdGFyZ2V0IGNvbHVtbgogICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY10gfHwgJyc7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS50by5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6L+b77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+mAgAogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IG1vdmUudG8uciA+IG1vdmUuZnJvbS5yID8gJ+i/mycgOiAn6YCAJzsKICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3RvQ29sfWA7CiAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhAogICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdIHx8ICcnOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUudG8uY10gfHwgJyc7CiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yIcj0w77yJ77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+i/m++8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/pgIAKICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSBtb3ZlLnRvLnIgPCBtb3ZlLmZyb20uciA/ICfov5snIDogJ+mAgCc7CiAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt0b0NvbH1gOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnIHx8IHBpZWNlVHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHBpZWNlVHlwZSA9PT0gJ2Nhbm5vbicgfHwgcGllY2VUeXBlID09PSAnc29sZGllcicpIHsKICAgICAgICAgICAgICAgIC8vIFN0cmFpZ2h0IG1vdmluZyBwaWVjZXMgLSDov5sv6YCAL+W5swogICAgICAgICAgICAgICAgaWYgKG1vdmUuZnJvbS5jID09PSBtb3ZlLnRvLmMpIHsKICAgICAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBtb3ZlIC0g6L+bL+mAgAogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXBzID0gTWF0aC5hYnMobW92ZS50by5yIC0gbW92ZS5mcm9tLnIpOwogICAgICAgICAgICAgICAgICAgIC8vIOi/m+aYr+mdoOi/keaVjOaWueeahOaWueWQke+8jOmAgOaYr+i/nOemu+aVjOaWueeahOaWueWQkQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/ov5vvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6YCACiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+i/m++8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/pgIAKICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSAoaXNSZWQgPyBtb3ZlLnRvLnIgPiBtb3ZlLmZyb20uciA6IG1vdmUudG8uciA8IG1vdmUuZnJvbS5yKSA/ICfov5snIDogJ+mAgCc7CiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdOwogICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgc3RlcHMgaXMgYSB2YWxpZCBudW1iZXIgYmV0d2VlbiAxLTkKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsaWRTdGVwcyA9IE1hdGgubWF4KDEsIE1hdGgubWluKDksIE1hdGgucm91bmQoc3RlcHMgfHwgMSkpKTsKICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHtkaWdpdFRvQ2hpbmVzZVt2YWxpZFN0ZXBzXSB8fCAnJ31gOwogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhAogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXTsKICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHN0ZXBzIGlzIGEgdmFsaWQgbnVtYmVyCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkU3RlcHMgPSBNYXRoLnJvdW5kKHN0ZXBzIHx8IDEpOwogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3ZhbGlkU3RlcHN9YDsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgbW92ZSAtIOW5swogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS50by5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x95bmzJHt0b0NvbH1gOwogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhAogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS50by5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x95bmzJHt0b0NvbH1gOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1Vua25vd24gcGllY2UgdHlwZTonLCBwaWVjZVR5cGUpOwogICAgICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgICAgIG5vdGF0aW9uLnB1c2gobm90YXRpb25TdHIpOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8gU3dpdGNoIGNvbG9yIGZvciBuZXh0IG1vdmUKICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgICAgICB9CiAgICAgICAgCiAgICAgICAgcmV0dXJuIG5vdGF0aW9uOwogICAgfQoKICAgIC8qKgogICAgICogQ29udmVydCB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uIHRvIGNvb3JkaW5hdGUgbW92ZXMKICAgICAqIEBwYXJhbSBub3RhdGlvbiBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24KICAgICAqIEByZXR1cm5zIEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0CiAgICAgKi8KICAgIG5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvbiwgaW5pdGlhbEJvYXJkID0gbnVsbCkgewogICAgICAgIC8vIOehruS/nW5vdGF0aW9u5piv5pWw57uE5LiU5LiN5Li656m6CiAgICAgICAgaWYgKCFub3RhdGlvbiB8fCAhQXJyYXkuaXNBcnJheShub3RhdGlvbikgfHwgbm90YXRpb24ubGVuZ3RoID09PSAwKSB7CiAgICAgICAgICAgIHJldHVybiBbXTsKICAgICAgICB9CiAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsKICAgICAgICBsZXQgY3VycmVudENvbG9yID0gJ3JlZCc7IC8vIFJlZCBtb3ZlcyBmaXJzdAoKICAgICAgICAvLyBQaWVjZSBjaGFyYWN0ZXIgdG8gdHlwZSBtYXBwaW5nCiAgICAgICAgY29uc3QgcGllY2VNYXAgPSB7CiAgICAgICAgICAgICflsIYnOiAnZ2VuZXJhbCcsICfluIUnOiAnZ2VuZXJhbCcsCiAgICAgICAgICAgICflo6snOiAnYWR2aXNvcicsICfku5UnOiAnYWR2aXNvcicsCiAgICAgICAgICAgICfosaEnOiAnZWxlcGhhbnQnLCAn55u4JzogJ2VsZXBoYW50JywKICAgICAgICAgICAgJ+mprCc6ICdob3JzZScsCiAgICAgICAgICAgICfovaYnOiAnY2hhcmlvdCcsCiAgICAgICAgICAgICfngq4nOiAnY2Fubm9uJywKICAgICAgICAgICAgJ+WNkic6ICdzb2xkaWVyJywgJ+WFtSc6ICdzb2xkaWVyJwogICAgICAgIH07CgogICAgICAgIC8vIENvbHVtbiBtYXBwaW5nICh0cmFkaXRpb25hbCBub3RhdGlvbiB1c2VzIDEtOSBmcm9tIHJpZ2h0IHRvIGxlZnQpCiAgICAgICAgY29uc3QgY29sTWFwID0gewogICAgICAgICAgICAn5LiAJzogOCwgJzEnOiA4LAogICAgICAgICAgICAn5LqMJzogNywgJzInOiA3LAogICAgICAgICAgICAn5LiJJzogNiwgJzMnOiA2LAogICAgICAgICAgICAn5ZubJzogNSwgJzQnOiA1LAogICAgICAgICAgICAn5LqUJzogNCwgJzUnOiA0LAogICAgICAgICAgICAn5YWtJzogMywgJzYnOiAzLAogICAgICAgICAgICAn5LiDJzogMiwgJzcnOiAyLAogICAgICAgICAgICAn5YWrJzogMSwgJzgnOiAxLAogICAgICAgICAgICAn5LmdJzogMCwgJzknOiAwCiAgICAgICAgfTsKCiAgICAgICAgLy8gQ2hpbmVzZSBudW1iZXIgdG8gZGlnaXQgbWFwcGluZwogICAgICAgIGNvbnN0IGNoaW5lc2VOdW1iZXJNYXAgPSB7CiAgICAgICAgICAgICfkuIAnOiAxLCAnMSc6IDEsCiAgICAgICAgICAgICfkuownOiAyLCAnMic6IDIsCiAgICAgICAgICAgICfkuIknOiAzLCAnMyc6IDMsCiAgICAgICAgICAgICflm5snOiA0LCAnNCc6IDQsCiAgICAgICAgICAgICfkupQnOiA1LCAnNSc6IDUsCiAgICAgICAgICAgICflha0nOiA2LCAnNic6IDYsCiAgICAgICAgICAgICfkuIMnOiA3LCAnNyc6IDcsCiAgICAgICAgICAgICflhasnOiA4LCAnOCc6IDgsCiAgICAgICAgICAgICfkuZ0nOiA5LCAnOSc6IDkKICAgICAgICB9OwoKICAgICAgICAvLyBJbml0aWFsIHBvc2l0aW9ucyBvZiBwaWVjZXMgKHJlZCBhbmQgYmxhY2spCiAgICAgICAgLy8g5L+u5aSN77ya5LiO5paw5Z2Q5qCH57O757uf5L+d5oyB5LiA6Ie077yM57qi5pa55Zyo5bqV6YOo77yIcj0wLTLvvInvvIzpu5HmlrnlnKjpobbpg6jvvIhyPTctOe+8iQogICAgICAgIGNvbnN0IGRlZmF1bHRJbml0aWFsUG9zaXRpb25zID0gewogICAgICAgICAgICAncmVkLWdlbmVyYWwnOiB7IHI6IDAsIGM6IDQgfSwKICAgICAgICAgICAgJ3JlZC1hZHZpc29yJzogW3sgcjogMCwgYzogMyB9LCB7IHI6IDAsIGM6IDUgfV0sCiAgICAgICAgICAgICdyZWQtZWxlcGhhbnQnOiBbeyByOiAwLCBjOiAyIH0sIHsgcjogMCwgYzogNiB9XSwKICAgICAgICAgICAgJ3JlZC1ob3JzZSc6IFt7IHI6IDAsIGM6IDEgfSwgeyByOiAwLCBjOiA3IH1dLAogICAgICAgICAgICAncmVkLWNoYXJpb3QnOiBbeyByOiAwLCBjOiAwIH0sIHsgcjogMCwgYzogOCB9XSwKICAgICAgICAgICAgJ3JlZC1jYW5ub24nOiBbeyByOiAyLCBjOiAxIH0sIHsgcjogMiwgYzogNyB9XSwKICAgICAgICAgICAgJ3JlZC1zb2xkaWVyJzogW3sgcjogMywgYzogMCB9LCB7IHI6IDMsIGM6IDIgfSwgeyByOiAzLCBjOiA0IH0sIHsgcjogMywgYzogNiB9LCB7IHI6IDMsIGM6IDggfV0sCiAgICAgICAgICAgICdibGFjay1nZW5lcmFsJzogeyByOiA5LCBjOiA0IH0sCiAgICAgICAgICAgICdibGFjay1hZHZpc29yJzogW3sgcjogOSwgYzogMyB9LCB7IHI6IDksIGM6IDUgfV0sCiAgICAgICAgICAgICdibGFjay1lbGVwaGFudCc6IFt7IHI6IDksIGM6IDIgfSwgeyByOiA5LCBjOiA2IH1dLAogICAgICAgICAgICAnYmxhY2staG9yc2UnOiBbeyByOiA5LCBjOiAxIH0sIHsgcjogOSwgYzogNyB9XSwKICAgICAgICAgICAgJ2JsYWNrLWNoYXJpb3QnOiBbeyByOiA5LCBjOiAwIH0sIHsgcjogOSwgYzogOCB9XSwKICAgICAgICAgICAgJ2JsYWNrLWNhbm5vbic6IFt7IHI6IDcsIGM6IDEgfSwgeyByOiA3LCBjOiA3IH1dLAogICAgICAgICAgICAnYmxhY2stc29sZGllcic6IFt7IHI6IDYsIGM6IDAgfSwgeyByOiA2LCBjOiAyIH0sIHsgcjogNiwgYzogNCB9LCB7IHI6IDYsIGM6IDYgfSwgeyByOiA2LCBjOiA4IH1dCiAgICAgICAgfTsKCiAgICAgICAgLy8gVHJhY2sgcGllY2UgcG9zaXRpb25zIGFzIG1vdmVzIGFyZSBtYWRlCiAgICAgICAgbGV0IHBpZWNlUG9zaXRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShkZWZhdWx0SW5pdGlhbFBvc2l0aW9ucykpOwogICAgICAgIAogICAgICAgIC8vIElmIGluaXRpYWwgYm9hcmQgaXMgcHJvdmlkZWQsIGluaXRpYWxpemUgcGllY2UgcG9zaXRpb25zIGZyb20gaXQKICAgICAgICBpZiAoaW5pdGlhbEJvYXJkKSB7CiAgICAgICAgICAgIC8vIFJlc2V0IHBpZWNlIHBvc2l0aW9ucyBiYXNlZCBvbiBpbml0aWFsIGJvYXJkCiAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zID0gewogICAgICAgICAgICAgICAgJ3JlZC1nZW5lcmFsJzogeyByOiAtMSwgYzogLTEgfSwKICAgICAgICAgICAgICAgICdyZWQtYWR2aXNvcic6IFtdLAogICAgICAgICAgICAgICAgJ3JlZC1lbGVwaGFudCc6IFtdLAogICAgICAgICAgICAgICAgJ3JlZC1ob3JzZSc6IFtdLAogICAgICAgICAgICAgICAgJ3JlZC1jaGFyaW90JzogW10sCiAgICAgICAgICAgICAgICAncmVkLWNhbm5vbic6IFtdLAogICAgICAgICAgICAgICAgJ3JlZC1zb2xkaWVyJzogW10sCiAgICAgICAgICAgICAgICAnYmxhY2stZ2VuZXJhbCc6IHsgcjogLTEsIGM6IC0xIH0sCiAgICAgICAgICAgICAgICAnYmxhY2stYWR2aXNvcic6IFtdLAogICAgICAgICAgICAgICAgJ2JsYWNrLWVsZXBoYW50JzogW10sCiAgICAgICAgICAgICAgICAnYmxhY2staG9yc2UnOiBbXSwKICAgICAgICAgICAgICAgICdibGFjay1jaGFyaW90JzogW10sCiAgICAgICAgICAgICAgICAnYmxhY2stY2Fubm9uJzogW10sCiAgICAgICAgICAgICAgICAnYmxhY2stc29sZGllcic6IFtdCiAgICAgICAgICAgIH07CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBQb3B1bGF0ZSBwaWVjZSBwb3NpdGlvbnMgZnJvbSBpbml0aWFsIGJvYXJkCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgewogICAgICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGluaXRpYWxCb2FyZFtyXVtjXTsKICAgICAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7cGllY2UuY29sb3J9LSR7cGllY2UudHlwZX1gOwogICAgICAgICAgICAgICAgICAgICAgICBpZiAocGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1trZXldID0geyByLCBjIH07CiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1trZXldLnB1c2goeyByLCBjIH0pOwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQoKICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZmluZCBwaWVjZSBwb3NpdGlvbgogICAgICAgIGNvbnN0IGZpbmRQaWVjZVBvc2l0aW9uID0gKHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgZGlyZWN0aW9uLCBib2FyZCwgZnJvbnRCYWNrTWFya2VyID0gbnVsbCkgPT4gewogICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtjb2xvcn0tJHtwaWVjZVR5cGV9YDsKICAgICAgICAgICAgY29uc3QgcG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNba2V5XTsKCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHBvc2l0aW9ucyBleGlzdCBhbmQgYXJlIHZhbGlkCiAgICAgICAgICAgIGlmICghcG9zaXRpb25zKSB7CiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBwb3NpdGlvbnMgZm91bmQgZm9yIHBpZWNlOicsIGtleSk7CiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgICAgICAgICByZXR1cm4gcG9zaXRpb25zOwogICAgICAgICAgICB9CgogICAgICAgICAgICAvLyBGaW5kIHBpZWNlcyBvbiB0aGUgc3BlY2lmaWVkIGNvbHVtbgogICAgICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gcG9zaXRpb25zLmZpbHRlcihwb3MgPT4gcG9zLmMgPT09IGNvbCk7CgogICAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIGNhbmRpZGF0ZXMgZm91bmQgZm9yIHBpZWNlOicsIGtleSwgJ29uIGNvbHVtbjonLCBjb2wpOwogICAgICAgICAgICAgICAgLy8gQWRkaXRpb25hbCBkZWJ1ZyBpbmZvIGZvciBjYW5ub24KICAgICAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdjYW5ub24nICYmIGNvbG9yID09PSAnYmxhY2snKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0RFQlVHOiBDYW5kaWRhdGVzIGFmdGVyIGZpbHRlcjonLCBjYW5kaWRhdGVzKTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgICAgICB9CgogICAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDEpIHsKICAgICAgICAgICAgICAgIHJldHVybiBjYW5kaWRhdGVzWzBdOwogICAgICAgICAgICB9CgogICAgICAgICAgICAvLyBJZiBmcm9udC9iYWNrIG1hcmtlciBpcyBwcm92aWRlZCwgdXNlIGl0IHRvIGRldGVybWluZSB0aGUgcGllY2UKICAgICAgICAgICAgaWYgKGZyb250QmFja01hcmtlciA9PT0gJ+WJjScpIHsKICAgICAgICAgICAgICAgIC8vIOWJjeeCru+8mumdoOi/keaVjOaWueeahOaji+WtkAogICAgICAgICAgICAgICAgLy8g57qi5pa577yacuWAvOi+g+Wkp+eahOabtOmdoOi/keaVjOaWue+8iOWJje+8iQogICAgICAgICAgICAgICAgLy8g6buR5pa577yacuWAvOi+g+Wwj+eahOabtOmdoOi/keaVjOaWue+8iOWJje+8iQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IAogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOgogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7CiAgICAgICAgICAgIH0gZWxzZSBpZiAoZnJvbnRCYWNrTWFya2VyID09PSAn5ZCOJykgewogICAgICAgICAgICAgICAgLy8g5ZCO54Ku77ya6Z2g6L+R5bex5pa555qE5qOL5a2QCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJpy5YC86L6D5bCP55qE5pu06Z2g6L+R5bex5pa577yI5ZCO77yJCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJpy5YC86L6D5aSn55qE5pu06Z2g6L+R5bex5pa577yI5ZCO77yJCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6CiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgLy8gSWYgbXVsdGlwbGUgcGllY2VzIG9uIHRoZSBzYW1lIGNvbHVtbiBhbmQgbm8gbWFya2VyLCBkZXRlcm1pbmUgYmFzZWQgb24gZGlyZWN0aW9uCiAgICAgICAgICAgIC8vIOWvueS6juWQjOS4gOWIl+eahOaji+WtkO+8jOmAmui/h+avlOi+g3LlgLzmnaXljLrliIYKICAgICAgICAgICAgaWYgKGRpcmVjdGlvbiA9PT0gJ+i/mycpIHsKICAgICAgICAgICAgICAgIC8vIOi/m+aYr+WQkeaVjOaWueaWueWQkeenu+WKqO+8jOaJgOS7pemAieaLqeabtOmdoOi/keW3seaWueeahOaji+WtkO+8iOWQju+8iQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IAogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOgogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7CiAgICAgICAgICAgIH0gZWxzZSBpZiAoZGlyZWN0aW9uID09PSAn6YCAJykgewogICAgICAgICAgICAgICAgLy8g6YCA5piv5ZCR5bex5pa55pa55ZCR56e75Yqo77yM5omA5Lul6YCJ5oup5pu06Z2g6L+R5pWM5pa555qE5qOL5a2Q77yI5YmN77yJCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6CiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZXNbMF07IC8vIERlZmF1bHQgdG8gZmlyc3QgaWYgZGlyZWN0aW9uIGlzICflubMnIGFuZCBubyBtYXJrZXIKICAgICAgICB9OwoKICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gdXBkYXRlIHBpZWNlIHBvc2l0aW9uCiAgICAgICAgY29uc3QgdXBkYXRlUGllY2VQb3NpdGlvbiA9IChwaWVjZVR5cGUsIGNvbG9yLCBvbGRQb3MsIG5ld1BvcykgPT4gewogICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtjb2xvcn0tJHtwaWVjZVR5cGV9YDsKICAgICAgICAgICAgY29uc3QgcG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNba2V5XTsKCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHBvc2l0aW9ucyBleGlzdCBhbmQgYXJlIHZhbGlkCiAgICAgICAgICAgIGlmICghcG9zaXRpb25zKSB7CiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IE5vIHBvc2l0aW9ucyBmb3VuZCBmb3IgcGllY2U6Jywga2V5KTsKICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgICAgICAgICBwb3NpdGlvbnMuciA9IG5ld1Bvcy5yOwogICAgICAgICAgICAgICAgcG9zaXRpb25zLmMgPSBuZXdQb3MuYzsKICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgY29uc3QgaW5kZXggPSBwb3NpdGlvbnMuZmluZEluZGV4KHBvcyA9PiBwb3MuciA9PT0gb2xkUG9zLnIgJiYgcG9zLmMgPT09IG9sZFBvcy5jKTsKICAgICAgICAgICAgaWYgKGluZGV4ICE9PSAtMSkgewogICAgICAgICAgICAgICAgcG9zaXRpb25zW2luZGV4XS5yID0gbmV3UG9zLnI7CiAgICAgICAgICAgICAgICBwb3NpdGlvbnNbaW5kZXhdLmMgPSBuZXdQb3MuYzsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogQ291bGQgbm90IGZpbmQgcGllY2UgcG9zaXRpb24gdG8gdXBkYXRlOicsIG9sZFBvcywgJ2luJywgcG9zaXRpb25zKTsKICAgICAgICAgICAgfQogICAgICAgIH07CgogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiBwb3NpdGlvbiBpcyB2YWxpZAogICAgICAgIGNvbnN0IGlzVmFsaWRQb3MgPSAociwgYykgPT4gciA+PSAwICYmIHIgPCAxMCAmJiBjID49IDAgJiYgYyA8IDk7CgogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgaG9yc2UgbW92ZXMKICAgICAgICBjb25zdCBnZXRIb3JzZU1vdmVzID0gKHBvcywgY29sb3IpID0+IHsKICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsKICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsKICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7CiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbCiAgICAgICAgICAgICAgICB7IGRyOiAtMiwgZGM6IC0xIH0sIHsgZHI6IC0yLCBkYzogMSB9LAogICAgICAgICAgICAgICAgeyBkcjogLTEsIGRjOiAtMiB9LCB7IGRyOiAtMSwgZGM6IDIgfSwKICAgICAgICAgICAgICAgIHsgZHI6IDEsIGRjOiAtMiB9LCB7IGRyOiAxLCBkYzogMiB9LAogICAgICAgICAgICAgICAgeyBkcjogMiwgZGM6IC0xIH0sIHsgZHI6IDIsIGRjOiAxIH0KICAgICAgICAgICAgXTsKCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBob3JzZSBjYW4gbW92ZSBpbiB0aGUgZGlyZWN0aW9uCiAgICAgICAgICAgIGNvbnN0IGNhbk1vdmUgPSAoZHIsIGRjLCBibG9ja2VkUiwgYmxvY2tlZEMpID0+IHsKICAgICAgICAgICAgICAgIGlmICghaXNWYWxpZFBvcyhyICsgYmxvY2tlZFIsIGMgKyBibG9ja2VkQykpIHJldHVybiBmYWxzZTsKICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgICB9OwoKICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9LCBpbmRleCkgPT4gewogICAgICAgICAgICAgICAgY29uc3QgYmxvY2tlZFIgPSBkciA+IDAgPyAxIDogZHIgPCAwID8gLTEgOiAwOwogICAgICAgICAgICAgICAgY29uc3QgYmxvY2tlZEMgPSBkYyA+IDAgPyAxIDogZGMgPCAwID8gLTEgOiAwOwogICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgcGF0aCBpcyBibG9ja2VkCiAgICAgICAgICAgICAgICBpZiAoKGluZGV4IDwgMiB8fCBpbmRleCA+PSA2KSAmJiBibG9ja2VkUiAhPT0gMCkgewogICAgICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIGJsb2NrZWQKICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbk1vdmUoZHIsIGRjLCBibG9ja2VkUiwgMCkpIHJldHVybjsKICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoYmxvY2tlZEMgIT09IDApIHsKICAgICAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIGJsb2NrZWQKICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbk1vdmUoZHIsIGRjLCAwLCBibG9ja2VkQykpIHJldHVybjsKICAgICAgICAgICAgICAgIH0KCiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOwogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsKICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpKSB7CiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0pOwoKICAgICAgICAgICAgcmV0dXJuIG1vdmVzOwogICAgICAgIH07CgogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgZWxlcGhhbnQgbW92ZXMKICAgICAgICBjb25zdCBnZXRFbGVwaGFudE1vdmVzID0gKHBvcywgY29sb3IpID0+IHsKICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsKICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsKICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7CiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbCiAgICAgICAgICAgICAgICB7IGRyOiAtMiwgZGM6IC0yIH0sIHsgZHI6IC0yLCBkYzogMiB9LAogICAgICAgICAgICAgICAgeyBkcjogMiwgZGM6IC0yIH0sIHsgZHI6IDIsIGRjOiAyIH0KICAgICAgICAgICAgXTsKCiAgICAgICAgICAgIC8vIEVsZXBoYW50J3MgdGVycml0b3J5IC0gcmVkIGVsZXBoYW50cyBjYW4gb25seSBiZSBpbiByPD00LCBibGFjayBlbGVwaGFudHMgaW4gcj49NQogICAgICAgICAgICBjb25zdCBpc0luVGVycml0b3J5ID0gKHIpID0+IHsKICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyByIDw9IDQgOiByID49IDU7CiAgICAgICAgICAgIH07CgogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0pID0+IHsKICAgICAgICAgICAgICAgIGNvbnN0IG1pZFIgPSByICsgZHIgLyAyOwogICAgICAgICAgICAgICAgY29uc3QgbWlkQyA9IGMgKyBkYyAvIDI7CiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOwogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsKCiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBtaWQgcG9zaXRpb24gaXMgZW1wdHkgYW5kIG5ldyBwb3NpdGlvbiBpcyB2YWxpZAogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobWlkUiwgbWlkQykgJiYgaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSAmJiBpc0luVGVycml0b3J5KG5ld1IpKSB7CiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0pOwoKICAgICAgICAgICAgcmV0dXJuIG1vdmVzOwogICAgICAgIH07CgogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgYWR2aXNvciBtb3ZlcwogICAgICAgIGNvbnN0IGdldEFkdmlzb3JNb3ZlcyA9IChwb3MsIGNvbG9yKSA9PiB7CiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107CiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107CiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOwogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWwogICAgICAgICAgICAgICAgeyBkcjogLTEsIGRjOiAtMSB9LCB7IGRyOiAtMSwgZGM6IDEgfSwKICAgICAgICAgICAgICAgIHsgZHI6IDEsIGRjOiAtMSB9LCB7IGRyOiAxLCBkYzogMSB9CiAgICAgICAgICAgIF07CgogICAgICAgICAgICAvLyBBZHZpc29yJ3MgdGVycml0b3J5IChwYWxhY2UpIC0gcmVkIGFkdmlzb3JzIGluIHI9MC0yLGM9My01LCBibGFjayBhZHZpc29ycyBpbiByPTctOSxjPTMtNQogICAgICAgICAgICBjb25zdCBpc0luUGFsYWNlID0gKHIsIGMpID0+IHsKICAgICAgICAgICAgICAgIGNvbnN0IHJSYW5nZSA9IGNvbG9yID09PSAncmVkJyA/IFswLCAyXSA6IFs3LCA5XTsKICAgICAgICAgICAgICAgIHJldHVybiByID49IHJSYW5nZVswXSAmJiByIDw9IHJSYW5nZVsxXSAmJiBjID49IDMgJiYgYyA8PSA1OwogICAgICAgICAgICB9OwoKICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9KSA9PiB7CiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOwogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsKICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpICYmIGlzSW5QYWxhY2UobmV3UiwgbmV3QykpIHsKICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfSk7CgogICAgICAgICAgICByZXR1cm4gbW92ZXM7CiAgICAgICAgfTsKCiAgICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGJvYXJkIHRvIHRyYWNrIG1vdmVzCiAgICAgICAgbGV0IHRlbXBCb2FyZCA9IHRoaXMuY3JlYXRlSW5pdGlhbEJvYXJkKCk7CiAgICAgICAgCiAgICAgICAgLy8gRW5zdXJlIHRlbXBCb2FyZCBpcyBwcm9wZXJseSBpbml0aWFsaXplZAogICAgICAgIGlmICghdGVtcEJvYXJkIHx8IHRlbXBCb2FyZC5sZW5ndGggIT09IDEwKSB7CiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgYm9hcmQgaW5pdGlhbGl6YXRpb24nKTsKICAgICAgICAgICAgcmV0dXJuIFtdOwogICAgICAgIH0KICAgICAgICAKICAgICAgICAvLyBWZXJpZnkgYWxsIHJvd3MgaGF2ZSA5IGNvbHVtbnMKICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwOyBpKyspIHsKICAgICAgICAgICAgaWYgKCF0ZW1wQm9hcmRbaV0gfHwgdGVtcEJvYXJkW2ldLmxlbmd0aCAhPT0gOSkgewogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2ldID0gQXJyYXkoOSkuZmlsbChudWxsKTsKICAgICAgICAgICAgfQogICAgICAgIH0KCiAgICAgICAgY29uc29sZS5sb2coJ1RvdGFsIG1vdmVzOicsIG5vdGF0aW9uLmxlbmd0aCk7CiAgICAgICAgbm90YXRpb24uZm9yRWFjaChtb3ZlTm90YXRpb24gPT4gewoKCiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBQYXJzZSB0aGUgbW92ZSBub3RhdGlvbiAtIGtlZXAgbGFzdCBncm91cCBvcHRpb25hbAogICAgICAgICAgICBjb25zdCByZWdleCA9IC8oW+WJjeWQjl0pPyhb5bCG5biF5aOr5LuV6LGh55u46ams6L2m54Ku5YW15Y2SXSkoW+S4gOS6jOS4ieWbm+S6lOWFreS4g+WFq+S5nTEyMzQ1Njc4OV0pKFvov5vpgIDlubNdKShb5LiA5LqM5LiJ5Zub5LqU5YWt5LiD5YWr5LmdMTIzNDU2Nzg5XSk/LzsKICAgICAgICAgICAgY29uc3QgbWF0Y2ggPSBtb3ZlTm90YXRpb24ubWF0Y2gocmVnZXgpOwoKICAgICAgICAgICAgaWYgKCFtYXRjaCkgewogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBtb3ZlIG5vdGF0aW9uOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIGNvbnN0IFssIGZyb250QmFja01hcmtlciwgcGllY2VDaGFyLCBmcm9tQ29sTm90YXRpb24sIGRpcmVjdGlvbiwgdG9Db2xPclN0ZXBOb3RhdGlvbl0gPSBtYXRjaDsKICAgICAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2VNYXBbcGllY2VDaGFyXTsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIEdldCBjb2x1bW4gbWFwcGluZyBiYXNlZCBvbiBjdXJyZW50IGNvbG9yIChibGFjayBzZWVzIGNvbHVtbnMgbWlycm9yZWQpCiAgICAgICAgICAgIGxldCBmcm9tQ29sID0gY29sTWFwW2Zyb21Db2xOb3RhdGlvbl07CiAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsKICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjayAoZnJvbSBibGFjaydzIHBlcnNwZWN0aXZlKQogICAgICAgICAgICAgICAgZnJvbUNvbCA9IDggLSBmcm9tQ29sOwogICAgICAgICAgICB9CgogICAgICAgICAgICAvLyBGaW5kIHRoZSBjdXJyZW50IHBvc2l0aW9uIG9mIHRoZSBwaWVjZQogICAgICAgICAgICBjb25zdCBmcm9tUG9zID0gZmluZFBpZWNlUG9zaXRpb24ocGllY2VUeXBlLCBjdXJyZW50Q29sb3IsIGZyb21Db2wsIGRpcmVjdGlvbiwgdGVtcEJvYXJkLCBmcm9udEJhY2tNYXJrZXIpOwoKICAgICAgICAgICAgaWYgKCFmcm9tUG9zKSB7CiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZmluZCBwaWVjZSBwb3NpdGlvbiBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOwogICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICB9CgogICAgICAgICAgICBsZXQgdG9Qb3M7CgogICAgICAgICAgICBpZiAoZGlyZWN0aW9uID09PSAn5bmzJykgewogICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBtb3ZlbWVudAogICAgICAgICAgICAgICAgbGV0IHRvQ29sID0gY29sTWFwW3RvQ29sT3JTdGVwTm90YXRpb25dOwogICAgICAgICAgICAgICAgaWYgKHRvQ29sID09PSB1bmRlZmluZWQpIHsKICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb246JywgdG9Db2xPclN0ZXBOb3RhdGlvbiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sgd2hlbiBtb3ZpbmcgaG9yaXpvbnRhbGx5CiAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7CiAgICAgICAgICAgICAgICAgICAgdG9Db2wgPSA4IC0gdG9Db2w7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgIHRvUG9zID0geyByOiBmcm9tUG9zLnIsIGM6IHRvQ29sIH07CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBvciBkaWFnb25hbCBtb3ZlbWVudAogICAgICAgICAgICAgICAgY29uc3Qgc3RlcHMgPSBjaGluZXNlTnVtYmVyTWFwW3RvQ29sT3JTdGVwTm90YXRpb25dOwogICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgIGlmIChzdGVwcyA9PT0gdW5kZWZpbmVkKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBzdGVwIGNvdW50OicsIHRvQ29sT3JTdGVwTm90YXRpb24sICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOwogICAgICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgICAgIH0KCiAgICAgICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnaG9yc2UnKSB7CiAgICAgICAgICAgICAgICAgICAgLy8gSG9yc2UgbW92ZXMgaW4gTC1zaGFwZQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRIb3JzZU1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7CiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOwogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOwogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGhvcnNlOicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOwogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjawogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsKICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsKICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZGlyZWN0aW9uIChyb3cpCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbk1hdGNoID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IAogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoKICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsKICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgY29sdW1uCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsKICAgICAgICAgICAgICAgICAgICB9KTsKICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnZWxlcGhhbnQnKSB7CiAgICAgICAgICAgICAgICAgICAgLy8gRWxlcGhhbnQgbW92ZXMgZGlhZ29uYWxseSAyIHN0ZXBzCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEVsZXBoYW50TW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsKICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247CiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07CiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgZWxlcGhhbnQ6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgewogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbgogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gewogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykKICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOgogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOwogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOwogICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdhZHZpc29yJykgewogICAgICAgICAgICAgICAgICAgIC8vIEFkdmlzb3IgbW92ZXMgZGlhZ29uYWxseSAxIHN0ZXAKICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0QWR2aXNvck1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7CiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOwogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOwogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGFkdmlzb3I6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgewogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbgogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gewogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykKICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOgogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOwogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOwogICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAvLyBTdHJhaWdodCBsaW5lIG1vdmVtZW50IChjaGFyaW90LCBjYW5ub24sIHNvbGRpZXIpCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXAgPSBkaXJlY3Rpb24gPT09ICfov5snID8gKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAxIDogLTEpICogc3RlcHMgOgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IC0xIDogMSkgKiBzdGVwczsKICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gZnJvbVBvcy5yICsgc3RlcDsKICAgICAgICAgICAgICAgICAgICBpZiAobmV3UiA8IDAgfHwgbmV3UiA+PSAxMCkgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHJvdyBwb3NpdGlvbiBhZnRlciBtb3ZlOicsIG5ld1IsICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOwogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0geyByOiBuZXdSLCBjOiBmcm9tUG9zLmMgfTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQoKICAgICAgICAgICAgaWYgKCF0b1BvcykgewogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignQ291bGQgbm90IGRldGVybWluZSB0YXJnZXQgcG9zaXRpb24gZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsKICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgLy8gQWRkIHRoZSBtb3ZlIHRvIHRoZSBsaXN0CiAgICAgICAgICAgIG1vdmVzLnB1c2goeyBmcm9tOiB7IHI6IGZyb21Qb3MuciwgYzogZnJvbVBvcy5jIH0sIHRvOiB7IHI6IHRvUG9zLnIsIGM6IHRvUG9zLmMgfSB9KTsKCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlJ3MgYSBjYXB0dXJlZCBwaWVjZQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZFBpZWNlID0gdGVtcEJvYXJkW3RvUG9zLnJdW3RvUG9zLmNdOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8gSWYgdGhlcmUncyBhIGNhcHR1cmVkIHBpZWNlLCByZW1vdmUgaXQgZnJvbSBwaWVjZVBvc2l0aW9ucwogICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgewogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBgJHtjYXB0dXJlZFBpZWNlLmNvbG9yfS0ke2NhcHR1cmVkUGllY2UudHlwZX1gOwogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07CiAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgIGlmIChjYXB0dXJlZFBvc2l0aW9ucykgewogICAgICAgICAgICAgICAgICAgIC8vIOWwhi/luIXkuI3kvJrooqvlkIPmjonvvIzmiYDku6Xlj6rlpITnkIblhbbku5bmo4vlrZAKICAgICAgICAgICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZS50eXBlICE9PSAnZ2VuZXJhbCcpIHsKICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmVtb3ZlIHRoZSBjYXB0dXJlZCBwb3NpdGlvbiBmcm9tIHRoZSBhcnJheQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjYXB0dXJlZFBvc2l0aW9ucykpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHVwZGF0ZWRQb3NpdGlvbnMgPSBjYXB0dXJlZFBvc2l0aW9ucy5maWx0ZXIocG9zID0+IAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiAocG9zLnIgIT09IHRvUG9zLnIgfHwgcG9zLmMgIT09IHRvUG9zLmMpCiAgICAgICAgICAgICAgICAgICAgICAgICAgICApOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgcGllY2VQb3NpdGlvbnNbY2FwdHVyZWRLZXldID0gdXBkYXRlZFBvc2l0aW9uczsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVmVyaWZ5IHJlbW92YWwgd2FzIHN1Y2Nlc3NmdWwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0aWxsRXhpc3RzID0gdXBkYXRlZFBvc2l0aW9ucy5zb21lKHBvcyA9PiAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgcG9zLnIgPT09IHRvUG9zLnIgJiYgcG9zLmMgPT09IHRvUG9zLmMKICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoc3RpbGxFeGlzdHMpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IENhcHR1cmVkIHBpZWNlIHN0aWxsIGV4aXN0cyBpbiBwaWVjZVBvc2l0aW9ucyEnKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ+KchSBTVUNDRVNTOiBDYXB0dXJlZCBwaWVjZSByZW1vdmVkIGZyb20gcGllY2VQb3NpdGlvbnMnKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogVW5leHBlY3RlZCBub24tYXJyYXkgcG9zaXRpb25zIGZvciBwaWVjZTonLCBjYXB0dXJlZEtleSk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogTm8gcG9zaXRpb25zIGZvdW5kIGZvciBjYXB0dXJlZCBwaWVjZTonLCBjYXB0dXJlZEtleSk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIFZlcmlmeSB0aGUgY2FwdHVyZWQgcGllY2UgaGFzIGJlZW4gcmVtb3ZlZAogICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgewogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBgJHtjYXB0dXJlZFBpZWNlLmNvbG9yfS0ke2NhcHR1cmVkUGllY2UudHlwZX1gOwogICAgICAgICAgICAgICAgY29uc3QgZmluYWxQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07CiAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaW5hbFBvc2l0aW9ucykpIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGlsbEV4aXN0cyA9IGZpbmFsUG9zaXRpb25zLnNvbWUocG9zID0+IAogICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgcG9zLnIgPT09IHRvUG9zLnIgJiYgcG9zLmMgPT09IHRvUG9zLmMKICAgICAgICAgICAgICAgICAgICApOwogICAgICAgICAgICAgICAgICAgIGlmIChzdGlsbEV4aXN0cykgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFUlJPUjogQ2FwdHVyZWQgcGllY2Ugc3RpbGwgZXhpc3RzIGluIHBpZWNlUG9zaXRpb25zOicsIGNhcHR1cmVkUGllY2UsICdhdCcsIHRvUG9zKTsKICAgICAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU1VDQ0VTUzogQ2FwdHVyZWQgcGllY2UgcmVtb3ZlZCBmcm9tIHBpZWNlUG9zaXRpb25zJyk7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBNYWtlIHRoZSBtb3ZlIG9uIHRoZSB0ZW1wb3JhcnkgYm9hcmQgZmlyc3QgYmVmb3JlIHVwZGF0aW5nIHBpZWNlIHBvc2l0aW9ucwogICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhmcm9tUG9zLnIsIGZyb21Qb3MuYykgJiYgaXNWYWxpZFBvcyh0b1Bvcy5yLCB0b1Bvcy5jKSAmJiAKICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtmcm9tUG9zLnJdICYmIHRlbXBCb2FyZFt0b1Bvcy5yXSkgewogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSB0ZW1wQm9hcmRbZnJvbVBvcy5yXVtmcm9tUG9zLmNdOwogICAgICAgICAgICAgICAgdGVtcEJvYXJkW3RvUG9zLnJdW3RvUG9zLmNdID0gcGllY2U7CiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbZnJvbVBvcy5yXVtmcm9tUG9zLmNdID0gbnVsbDsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogSW52YWxpZCBwb3NpdGlvbnMgZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uLCBmcm9tUG9zLCB0b1Bvcyk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgcGllY2UgcG9zaXRpb24gaW4gcGllY2VQb3NpdGlvbnMKICAgICAgICAgICAgdXBkYXRlUGllY2VQb3NpdGlvbihwaWVjZVR5cGUsIGN1cnJlbnRDb2xvciwgZnJvbVBvcywgdG9Qb3MpOwogICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgLy8gU3dpdGNoIGNvbG9yIGZvciBuZXh0IG1vdmUKICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgICAgICB9KTsKCiAgICAgICAgcmV0dXJuIG1vdmVzOwogICAgfQp9CgovLyAtLS0gQ29uc3RhbnRzIC0tLQoKLy8gSW5pdGlhbGl6ZSBPcGVuaW5nIEJvb2sKY29uc3Qgb3BlbmluZ0Jvb2sgPSBuZXcgT3BlbmluZ0Jvb2soMTIpOwoKY29uc3QgaXNWYWxpZFBvcyA9IChyLCBjKSA9PiByID49IDAgJiYgciA8IFJPV1MgJiYgYyA+PSAwICYmIGMgPCBDT0xTOwoKLy8gYWxsaWVzT3V0OiDlj6/pgInvvIzmlLbpm4blj6/kv53miqTnmoTlt7HmlrnokL3ngrnvvIjkuI3lkKvlsIbluIXvvInvvIzkvpvlhbPns7vorqHnrpflpI3nlKjvvIzpgb/lhY3kuozmrKHlsITnur8KY29uc3QgZ2V0UGllY2VNb3ZlcyA9IChib2FyZCwgcG9zLCBwaWVjZSwgYWxsaWVzT3V0ID0gbnVsbCkgPT4gewogIGNvbnN0IG1vdmVzID0gW107CiAgY29uc3QgeyByLCBjIH0gPSBwb3M7CiAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7CgogIGNvbnN0IGFkZEFsbHkgPSAodHIsIHRjLCB0YXJnZXQpID0+IHsKICAgIGlmIChhbGxpZXNPdXQgJiYgdGFyZ2V0ICYmIHRhcmdldC5jb2xvciA9PT0gcGllY2UuY29sb3IgJiYgdGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgewogICAgICBhbGxpZXNPdXQucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsKICAgIH0KICB9OwoKICBjb25zdCBhZGRJZlZhbGlkID0gKHRyLCB0YykgPT4gewogICAgaWYgKGlzVmFsaWRQb3ModHIsIHRjKSkgewogICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW3RyXVt0Y107CiAgICAgICAgaWYgKCF0YXJnZXQgfHwgdGFyZ2V0LmNvbG9yICE9PSBwaWVjZS5jb2xvcikgewogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGFkZEFsbHkodHIsIHRjLCB0YXJnZXQpOwogICAgICAgIH0KICAgIH0KICB9OwoKICBzd2l0Y2ggKHBpZWNlLnR5cGUpIHsKICAgIGNhc2UgJ2dlbmVyYWwnOgogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsKICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7CiAgICAgICAgaWYgKG5jID49IDMgJiYgbmMgPD0gNSkgewogICAgICAgICAgaWYgKGlzUmVkICYmIG5yID49IDAgJiYgbnIgPD0gMikgYWRkSWZWYWxpZChuciwgbmMpOwogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDcgJiYgbnIgPD0gOSkgYWRkSWZWYWxpZChuciwgbmMpOwogICAgICAgIH0KICAgICAgfQogICAgICBicmVhazsKICAgIGNhc2UgJ2Fkdmlzb3InOgogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IERJQUdfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGRyID0gRElBR19ESVJTW2ldWzBdLCBkYyA9IERJQUdfRElSU1tpXVsxXTsKICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7CiAgICAgICAgaWYgKG5jID49IDMgJiYgbmMgPD0gNSkgewogICAgICAgICAgaWYgKGlzUmVkICYmIG5yID49IDAgJiYgbnIgPD0gMikgYWRkSWZWYWxpZChuciwgbmMpOwogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDcgJiYgbnIgPD0gOSkgYWRkSWZWYWxpZChuciwgbmMpOwogICAgICAgIH0KICAgICAgfQogICAgICBicmVhazsKICAgIGNhc2UgJ2VsZXBoYW50JzoKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBFTEVQSEFOVF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgZCA9IEVMRVBIQU5UX0RJUlNbaV07CiAgICAgICAgY29uc3QgbnIgPSByICsgZC5kciwgbmMgPSBjICsgZC5kYzsKICAgICAgICBjb25zdCBleWVSID0gciArIGQuZXllRHIsIGV5ZUMgPSBjICsgZC5leWVEYzsKICAgICAgICBpZiAoaXNWYWxpZFBvcyhuciwgbmMpICYmIGJvYXJkW2V5ZVJdW2V5ZUNdID09PSBudWxsKSB7CiAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPD0gNCkgYWRkSWZWYWxpZChuciwgbmMpOwogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDUpIGFkZElmVmFsaWQobnIsIG5jKTsKICAgICAgICB9CiAgICAgIH0KICAgICAgYnJlYWs7CiAgICBjYXNlICdob3JzZSc6CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgSE9SU0VfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGQgPSBIT1JTRV9ESVJTW2ldOwogICAgICAgIGNvbnN0IGxlZ1IgPSByICsgZC5sZWdEciwgbGVnQyA9IGMgKyBkLmxlZ0RjOwogICAgICAgIGlmIChpc1ZhbGlkUG9zKGxlZ1IsIGxlZ0MpICYmIGJvYXJkW2xlZ1JdW2xlZ0NdID09PSBudWxsKSB7CiAgICAgICAgICBhZGRJZlZhbGlkKHIgKyBkLmRyLCBjICsgZC5kYyk7CiAgICAgICAgfQogICAgICB9CiAgICAgIGJyZWFrOwogICAgY2FzZSAnY2hhcmlvdCc6CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOwogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7CiAgICAgICAgd2hpbGUgKGlzVmFsaWRQb3MobnIsIG5jKSkgewogICAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbbnJdW25jXTsKICAgICAgICAgIGlmICh0YXJnZXQgPT09IG51bGwpIHsKICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlLmNvbG9yKSBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICBlbHNlIGFkZEFsbHkobnIsIG5jLCB0YXJnZXQpOwogICAgICAgICAgICBicmVhazsKICAgICAgICAgIH0KICAgICAgICAgIG5yICs9IGRyOyBuYyArPSBkYzsKICAgICAgICB9CiAgICAgIH0KICAgICAgYnJlYWs7CiAgICBjYXNlICdjYW5ub24nOgogICAgICAvLyDnnYDms5Xku43lj6rlkKvmlYzmlrnpmpTmiZPvvJvlt7HmlrnpmpTmiZPkv53miqTnlLEgZmlsbENhbm5vblJlbGF0aW9ucyDnu5/kuIDlpITnkIYKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07CiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsKICAgICAgICBsZXQgc2NyZWVuRm91bmQgPSBmYWxzZTsKICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7CiAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7CiAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdID09PSBudWxsKSB7CiAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICBzY3JlZW5Gb3VuZCA9IHRydWU7CiAgICAgICAgICAgIH0KICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdICE9PSBudWxsKSB7CiAgICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10uY29sb3IgIT09IHBpZWNlLmNvbG9yKSBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICB9CiAgICAgICAgICB9CiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7CiAgICAgICAgfQogICAgICB9CiAgICAgIGJyZWFrOwogICAgY2FzZSAnc29sZGllcic6IHsKICAgICAgLy8g57qi5pa55YW15Yid5aeL5L2N572u5Zyocj0z77yM5ZCR5YmN6LWw5pivcuWinuWkp++8iOWQkeS4i++8ie+8m+m7keaWueWFteWIneWni+S9jee9ruWcqHI9Nu+8jOWQkeWJjei1sOaYr3Llh4/lsI/vvIjlkJHkuIrvvIkKICAgICAgY29uc3QgZm9yd2FyZCA9IGlzUmVkID8gMSA6IC0xOwogICAgICAvLyDnuqLmlrnlhbXov4fmsrPmnaHku7bmmK9yID49IDXvvIzpu5HmlrnlhbXov4fmsrPmnaHku7bmmK9yIDw9IDQKICAgICAgLy8g5rKz55WM5L2N5LqOcj005ZKMcj015LmL6Ze077yM57qi5pa55YW16ZyA6KaB6LWw5Yiwcj015omN6IO96L+H5rKz77yM6buR5pa55YW16ZyA6KaB6LWw5Yiwcj005omN6IO96L+H5rKzCiAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGlzUmVkID8gciA+PSA1IDogciA8PSA0OwogICAgICBhZGRJZlZhbGlkKHIgKyBmb3J3YXJkLCBjKTsKICAgICAgaWYgKGNyb3NzZWRSaXZlcikgewogICAgICAgIGFkZElmVmFsaWQociwgYyAtIDEpOwogICAgICAgIGFkZElmVmFsaWQociwgYyArIDEpOwogICAgICB9CiAgICAgIGJyZWFrOwogICAgfQogIH0KICByZXR1cm4gbW92ZXM7Cn07Cgpjb25zdCBpc0ZseWluZ0dlbmVyYWwgPSAoYm9hcmQpID0+IHsKICBjb25zdCByZWRHID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgJ3JlZCcpOwogIGNvbnN0IGJsYWNrRyA9IGdldEdlbmVyYWxQb3MoYm9hcmQsICdibGFjaycpOwogIGlmICghcmVkRyB8fCAhYmxhY2tHIHx8IHJlZEcuYyAhPT0gYmxhY2tHLmMpIHJldHVybiBmYWxzZTsKICAKICAvLyDnoa7kv53lvqrnjq/mlrnlkJHmraPnoa7vvIzku47ovoPlsI/nmoRy5Yiw6L6D5aSn55qEcgogIGNvbnN0IHN0YXJ0UiA9IE1hdGgubWluKGJsYWNrRy5yLCByZWRHLnIpICsgMTsKICBjb25zdCBlbmRSID0gTWF0aC5tYXgoYmxhY2tHLnIsIHJlZEcucikgLSAxOwogIAogIGZvciAobGV0IHIgPSBzdGFydFI7IHIgPD0gZW5kUjsgcisrKSB7CiAgICBpZiAoYm9hcmRbcl1bcmVkRy5jXSAhPT0gbnVsbCkgcmV0dXJuIGZhbHNlOwogIH0KICByZXR1cm4gdHJ1ZTsKfTsKCi8vIOaXoCBib2FyZEluZm8g5pe255qE5b+r6YCf5bCG5Yab5qOA5rWL77ya5bCG5L2N57yT5a2YICsg5LuO5bCG5L2N5Zub5ZCR5bCE57q/77yI6L2mL+Wwhi/ngq7lkIjlubbvvIkKY29uc3QgaXNDaGVja1JhdyA9IChib2FyZCwgY29sb3IpID0+IHsKICAgIGNvbnN0IGdlbmVyYWxQb3MgPSBnZXRHZW5lcmFsUG9zKGJvYXJkLCBjb2xvcik7CiAgICBpZiAoIWdlbmVyYWxQb3MpIHJldHVybiB0cnVlOwoKICAgIGNvbnN0IGVuZW15Q29sb3IgPSBjb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7CiAgICBjb25zdCB7IHI6IGdyLCBjOiBnYyB9ID0gZ2VuZXJhbFBvczsKCiAgICAvLyDnm7Tnur/vvJrnrKzkuIDlrZDkuLrmlYzovaYv5bCG5YiZ5bCG5Yab77yb6LaK6L+H54Ku5p625ZCO56ys5LqM5a2Q5Li65pWM54Ku5YiZ5bCG5YabCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsKICAgICAgICBsZXQgbnIgPSBnciArIGRyOwogICAgICAgIGxldCBuYyA9IGdjICsgZGM7CiAgICAgICAgbGV0IHNlZW4gPSAwOwoKICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7CiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOwogICAgICAgICAgICBpZiAocCkgewogICAgICAgICAgICAgICAgc2VlbisrOwogICAgICAgICAgICAgICAgaWYgKHNlZW4gPT09IDEpIHsKICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiAocC50eXBlID09PSAnY2hhcmlvdCcgfHwgcC50eXBlID09PSAnZ2VuZXJhbCcpKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgaWYgKHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnY2Fubm9uJykgewogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgbnIgKz0gZHI7CiAgICAgICAgICAgIG5jICs9IGRjOwogICAgICAgIH0KICAgIH0KCiAgICAvLyDpqazvvJrku47lsIbkvY3lj43mjqjvvIzpqazohb/lnKjpqazkuIDkvqfvvIjkuI4gZ2V0UGllY2VNb3ZlcyAvIEhPUlNFX0RJUlMg5LiA6Ie077yJCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IEhPUlNFX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBkID0gSE9SU0VfRElSU1tpXTsKICAgICAgICBjb25zdCBuciA9IGdyICsgZC5kcjsKICAgICAgICBjb25zdCBuYyA9IGdjICsgZC5kYzsKICAgICAgICBpZiAoaXNWYWxpZFBvcyhuciwgbmMpKSB7CiAgICAgICAgICAgIGNvbnN0IGxlZ1IgPSBuciAtIGQubGVnRHI7CiAgICAgICAgICAgIGNvbnN0IGxlZ0MgPSBuYyAtIGQubGVnRGM7CiAgICAgICAgICAgIGlmIChib2FyZFtsZWdSXVtsZWdDXSA9PT0gbnVsbCkgewogICAgICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107CiAgICAgICAgICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ2hvcnNlJykgewogICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIC8vIOWjq++8iOS5neWuq+WGhe+8iQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBESUFHX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBkciA9IERJQUdfRElSU1tpXVswXSwgZGMgPSBESUFHX0RJUlNbaV1bMV07CiAgICAgICAgY29uc3QgbnIgPSBnciArIGRyOwogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkYzsKICAgICAgICBpZiAoaXNWYWxpZFBvcyhuciwgbmMpICYmCiAgICAgICAgICAgICgoY29sb3IgPT09ICdyZWQnICYmIG5yID49IDAgJiYgbnIgPD0gMikgfHwgKGNvbG9yID09PSAnYmxhY2snICYmIG5yID49IDcgJiYgbnIgPD0gOSkpICYmCiAgICAgICAgICAgIG5jID49IDMgJiYgbmMgPD0gNSkgewogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsKICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdhZHZpc29yJykgewogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CgogICAgLy8g5YW177ya5q2j5YmN5pa55aeL57uI5Y+v5pS777yb5bem5Y+z5LuF6L+H5rKz5YW1CiAgICBjb25zdCBlbmVteUZvcndhcmQgPSBlbmVteUNvbG9yID09PSAncmVkJyA/IDEgOiAtMTsKICAgIGNvbnN0IGZvcndhcmRGcm9tUiA9IGdyIC0gZW5lbXlGb3J3YXJkOwogICAgaWYgKGlzVmFsaWRQb3MoZm9yd2FyZEZyb21SLCBnYykpIHsKICAgICAgICBjb25zdCBwID0gYm9hcmRbZm9yd2FyZEZyb21SXVtnY107CiAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdzb2xkaWVyJykgewogICAgICAgICAgICByZXR1cm4gdHJ1ZTsKICAgICAgICB9CiAgICB9CiAgICBmb3IgKGNvbnN0IGRjIG9mIFsxLCAtMV0pIHsKICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7CiAgICAgICAgaWYgKGlzVmFsaWRQb3MoZ3IsIG5jKSkgewogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbZ3JdW25jXTsKICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdzb2xkaWVyJykgewogICAgICAgICAgICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyBnciA+PSA1IDogZ3IgPD0gNDsKICAgICAgICAgICAgICAgIGlmIChjcm9zc2VkUml2ZXIpIHsKICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KCiAgICByZXR1cm4gZmFsc2U7Cn07Cgpjb25zdCBpc0NoZWNrID0gKGJvYXJkLCBjb2xvciwgcGllY2VzSW5mbyA9IG51bGwsIGJvYXJkSW5mbyA9IG51bGwpID0+IHsKICAgIC8vIOS8mOWFiOS9v+eUqOmihOiuoeeul+eahOWwhuWGm+eKtuaAgQogICAgaWYgKGJvYXJkSW5mbykgewogICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkSXNJbkNoZWNrIDogYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrOwogICAgfQoKICAgIC8vIOWmguaenOaciXBpZWNlc0luZm/vvIzkuZ/lj6/ku6Xku47kuK3ojrflj5blsIblhpvnirbmgIEKICAgIGlmIChwaWVjZXNJbmZvICYmIHBpZWNlc0luZm8ubGVuZ3RoID4gMCkgewogICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyBwaWVjZXNJbmZvWzBdLnJlZElzSW5DaGVjayA6IHBpZWNlc0luZm9bMF0uYmxhY2tJc0luQ2hlY2s7CiAgICB9CgogICAgcmV0dXJuIGlzQ2hlY2tSYXcoYm9hcmQsIGNvbG9yKTsKfTsKCi8vIOWQiOazleedgOazle+8muS8quWQiOazlSArIOS4jemAgeWwhi/kuI3po57lsIbvvIhtYWtlL3VubWFrZe+8iQpjb25zdCBnZXRWYWxpZE1vdmVzID0gKGJvYXJkLCBwb3MpID0+IHsKICBjb25zdCBwaWVjZSA9IGJvYXJkW3Bvcy5yXVtwb3MuY107CiAgaWYgKCFwaWVjZSkgcmV0dXJuIFtdOwogIGNvbnN0IHBzZXVkb01vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgcG9zLCBwaWVjZSk7CiAgcmV0dXJuIGZpbHRlckxlZ2FsTW92ZXMoYm9hcmQsIHBvcywgcGllY2UsIHBzZXVkb01vdmVzKTsKfTsKCmNvbnN0IGlzVmFsaWRQbGFjZW1lbnQgPSAodHlwZSwgY29sb3IsIHIsIGMpID0+IHsKICAgIGNvbnN0IGlzUmVkID0gY29sb3IgPT09ICdyZWQnOwogICAgc3dpdGNoKHR5cGUpIHsKICAgICAgICBjYXNlICdnZW5lcmFsJzoKICAgICAgICAgICAgLy8g5biF5bCG5Y+q6IO95Zyo5Lmd5a6r5Lit5b+D55qE5LiA5p2h57q/5LiKCiAgICAgICAgICAgIGlmIChjIDwgMyB8fCBjID4gNSkgcmV0dXJuIGZhbHNlOwogICAgICAgICAgICBpZiAoaXNSZWQpIHJldHVybiByID49IDAgJiYgciA8PSAyOwogICAgICAgICAgICBlbHNlIHJldHVybiByID49IDcgJiYgciA8PSA5OwogICAgICAgIGNhc2UgJ2Fkdmlzb3InOgogICAgICAgICAgICAvLyDlo6vlj6rog73lnKjkuZ3lrqvnmoQ15Liq54K55LmL5LiACiAgICAgICAgICAgIGNvbnN0IHZhbGlkQWR2aXNvclBvc2l0aW9ucyA9IHsKICAgICAgICAgICAgICAgIHJlZDogW1swLCAzXSwgWzAsIDVdLCBbMSwgNF0sIFsyLCAzXSwgWzIsIDVdXSwKICAgICAgICAgICAgICAgIGJsYWNrOiBbWzcsIDNdLCBbNywgNV0sIFs4LCA0XSwgWzksIDNdLCBbOSwgNV1dCiAgICAgICAgICAgIH07CiAgICAgICAgICAgIHJldHVybiB2YWxpZEFkdmlzb3JQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOwogICAgICAgIGNhc2UgJ2VsZXBoYW50JzoKICAgICAgICAgICAgLy8g55u45Y+q6IO95Zyo5bex5pa55Y2K5Zy655qEN+S4queCueS5i+S4gAogICAgICAgICAgICBjb25zdCB2YWxpZEVsZXBoYW50UG9zaXRpb25zID0gewogICAgICAgICAgICAgICAgcmVkOiBbWzAsIDJdLCBbMCwgNl0sIFsyLCAwXSwgWzIsIDRdLCBbMiwgOF0sIFs0LCAyXSwgWzQsIDZdXSwKICAgICAgICAgICAgICAgIGJsYWNrOiBbWzUsIDJdLCBbNSwgNl0sIFs3LCAwXSwgWzcsIDRdLCBbNywgOF0sIFs5LCAyXSwgWzksIDZdXQogICAgICAgICAgICB9OwogICAgICAgICAgICByZXR1cm4gdmFsaWRFbGVwaGFudFBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ10uc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7CiAgICAgICAgY2FzZSAnc29sZGllcic6CiAgICAgICAgICAgIC8vIOWFteeahOS9jee9rumZkOWItu+8mui/h+ays+WJjeWPquiDveWcqOWBtuaVsOWIl++8jOi/h+ays+WQjuWPr+S7peWcqOS7u+S9leWIlwogICAgICAgICAgICAvLyDnuqLmlrnlhbXov4fmsrPmnaHku7bmmK9yID49IDXvvIzpu5HmlrnlhbXov4fmsrPmnaHku7bmmK9yIDw9IDQKICAgICAgICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gaXNSZWQgPyByID49IDUgOiByIDw9IDQ7CiAgICAgICAgICAgIAogICAgICAgICAgICBpZiAoIWNyb3NzZWRSaXZlcikgewogICAgICAgICAgICAgICAgLy8g6L+H5rKz5YmN5Y+q6IO95Zyo5YG25pWw5YiX77yIYz0wLDIsNCw2LDjvvIkKICAgICAgICAgICAgICAgIGlmICghWzAsIDIsIDQsIDYsIDhdLmluY2x1ZGVzKGMpKSByZXR1cm4gZmFsc2U7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIOWFteeahOS9jee9rumZkOWItu+8mui/h+ays+WJjeWPquiDveWcqOWFteS9jeWSjOWFteS9jeWJjeaWue+8jOi/h+ays+WQjuaVjOaWueWNiuWcuumDveWQiOazlQogICAgICAgICAgICBjb25zdCB2YWxpZFNvbGRpZXJQb3NpdGlvbnMgPSB7CiAgICAgICAgICAgICAgICByZWQ6IHsKICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnliJ3lp4vlhbXkvY3vvJpyPTMsIGM9MCwyLDQsNiw4CiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbDogW1szLCAwXSwgWzMsIDJdLCBbMywgNF0sIFszLCA2XSwgWzMsIDhdXSwKICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnlhbXkvY3liY3mlrnvvJpyPTQsIGM9MCwyLDQsNiw4CiAgICAgICAgICAgICAgICAgICAgZm9yd2FyZDogW1s0LCAwXSwgWzQsIDJdLCBbNCwgNF0sIFs0LCA2XSwgWzQsIDhdXSwKICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov4fmsrPnur/vvJpyPj01CiAgICAgICAgICAgICAgICAgICAgY3Jvc3NlZFJpdmVyOiByID49IDUKICAgICAgICAgICAgICAgIH0sCiAgICAgICAgICAgICAgICBibGFjazogewogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueWIneWni+WFteS9je+8mnI9NiwgYz0wLDIsNCw2LDgKICAgICAgICAgICAgICAgICAgICBpbml0aWFsOiBbWzYsIDBdLCBbNiwgMl0sIFs2LCA0XSwgWzYsIDZdLCBbNiwgOF1dLAogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueWFteS9jeWJjeaWue+8mnI9NSwgYz0wLDIsNCw2LDgKICAgICAgICAgICAgICAgICAgICBmb3J3YXJkOiBbWzUsIDBdLCBbNSwgMl0sIFs1LCA0XSwgWzUsIDZdLCBbNSwgOF1dLAogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/h+ays+e6v++8mnI8PTQKICAgICAgICAgICAgICAgICAgICBjcm9zc2VkUml2ZXI6IHIgPD0gNAogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9OwogICAgICAgICAgICAKICAgICAgICAgICAgY29uc3Qgc29sZGllckluZm8gPSB2YWxpZFNvbGRpZXJQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddOwogICAgICAgICAgICBjb25zdCBpc0luaXRpYWxQb3MgPSBzb2xkaWVySW5mby5pbml0aWFsLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOwogICAgICAgICAgICBjb25zdCBpc0ZvcndhcmRQb3MgPSBzb2xkaWVySW5mby5mb3J3YXJkLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOwogICAgICAgICAgICAKICAgICAgICAgICAgaWYgKHNvbGRpZXJJbmZvLmNyb3NzZWRSaXZlcikgewogICAgICAgICAgICAgICAgLy8g6L+H5rKz5ZCO5pWM5pa55Y2K5Zy66YO95ZCI5rOVCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIC8vIOi/h+ays+WJjeWPquiDveWcqOWFteS9jeWSjOWFteS9jeWJjeaWuQogICAgICAgICAgICAgICAgcmV0dXJuIGlzSW5pdGlhbFBvcyB8fCBpc0ZvcndhcmRQb3M7CiAgICAgICAgICAgIH0KICAgICAgICBkZWZhdWx0OgogICAgICAgICAgICByZXR1cm4gdHJ1ZTsKICAgIH0KfTsKCmNvbnN0IGNoZWNrR2FtZVN0YXRlID0gKGJvYXJkLCB0dXJuLCBwaWVjZXNJbmZvID0gbnVsbCwgYm9hcmRJbmZvID0gbnVsbCkgPT4gewogICAgLy8g5LyY5YWI5L2/55So6aKE6K6h566X55qEZ2FtZVN0YXRlCiAgICBpZiAoYm9hcmRJbmZvICYmIGJvYXJkSW5mby5nYW1lU3RhdGUpIHsKICAgICAgICByZXR1cm4gYm9hcmRJbmZvLmdhbWVTdGF0ZTsKICAgIH0KICAgIAogICAgLy8g5rKh5pyJ6aKE6K6h566X57uT5p6c5pe277yM5omn6KGM5Y6f5aeL6K6h566XCiAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsKICAgIGZvcihsZXQgcj0wOyByPFJPV1M7IHIrKykgewogICAgICAgIGZvcihsZXQgYz0wOyBjPENPTFM7IGMrKykgewogICAgICAgICAgICBpZiAoYm9hcmRbcl1bY10/LmNvbG9yID09PSB0dXJuKSB7CiAgICAgICAgICAgICAgICBpZiAoZ2V0VmFsaWRNb3Zlcyhib2FyZCwge3IsY30pLmxlbmd0aCA+IDApIHsKICAgICAgICAgICAgICAgICAgICBoYXNNb3ZlcyA9IHRydWU7CiAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgaWYgKGhhc01vdmVzKSBicmVhazsKICAgIH0KCiAgICBpZiAoaGFzTW92ZXMpIHJldHVybiB7IHN0YXR1czogJ3BsYXlpbmcnIH07CgogICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2soYm9hcmQsIHR1cm4sIHBpZWNlc0luZm8sIGJvYXJkSW5mbyk7CiAgICBjb25zdCBvcHBvbmVudCA9IHR1cm4gPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgCiAgICBpZiAoaW5DaGVjaykgewogICAgICAgIHJldHVybiB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsKICAgIH0gZWxzZSB7CiAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9OwogICAgfQp9OwoKCgovLyDlop7lvLrnmoTmuLjmiI/pmLbmrrXor4bliKsKY29uc3QgZ2V0R2FtZVBoYXNlID0gKGJvYXJkKSA9PiB7CiAgLyoKICBjb25zdCBwaWVjZUNvdW50ID0gY291bnRQaWVjZXMoYm9hcmQpOwogIAogIGlmIChwaWVjZUNvdW50IDw9IDgpIHJldHVybiAnZW5kZ2FtZSc7CiAgaWYgKHBpZWNlQ291bnQgPD0gMTYpIHJldHVybiAnbWlkZGxlZ2FtZSc7CiAgcmV0dXJuICdvcGVuaW5nJzsKICAqLwogIHJldHVybiAnb3BlbmluZyc7Cn07CgovLyDorqHnrpfmo4vlrZDmgLvmlbAKY29uc3QgY291bnRQaWVjZXMgPSAoYm9hcmQpID0+IHsKICBsZXQgY291bnQgPSAwOwogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7CiAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICBpZiAoYm9hcmRbcl1bY10pIGNvdW50Kys7CiAgICB9CiAgfQogIHJldHVybiBjb3VudDsKfTsKCi8vIOWunuS+i+WMllpvYnJpc3RIYXNoZXIKY29uc3Qgem9icmlzdEhhc2hlciA9IG5ldyBab2JyaXN0SGFzaGVyKCk7CgovLyDnva7mjaLooajlrp7njrDvvIjlrrnph4/nuqYgMl4yMO+8jOmBv+WFjSBNYXAg6L+H5aSn5ouW5oWiIEdD77yJCmNsYXNzIFRyYW5zcG9zaXRpb25UYWJsZSB7CiAgICBjb25zdHJ1Y3RvcihzaXplID0gTWF0aC5wb3coMiwgMjApKSB7CiAgICAgICAgdGhpcy50YWJsZSA9IG5ldyBNYXAoKTsKICAgICAgICB0aGlzLnNpemUgPSBzaXplOwogICAgICAgIHRoaXMuaGFzaGVyID0gem9icmlzdEhhc2hlcjsKICAgICAgICAvLyDnu5/orqHkv6Hmga8KICAgICAgICB0aGlzLnN0YXRzID0gewogICAgICAgICAgICBoaXRzOiAwLAogICAgICAgICAgICBtaXNzZXM6IDAsCiAgICAgICAgICAgIGV4YWN0SGl0czogMCwKICAgICAgICAgICAgbG93ZXJib3VuZEhpdHM6IDAsCiAgICAgICAgICAgIHVwcGVyYm91bmRIaXRzOiAwLAogICAgICAgICAgICBzdG9yZXM6IDAsCiAgICAgICAgICAgIGxydUV2aWN0aW9uczogMCwKICAgICAgICAgICAgY2xlYXJzOiAwCiAgICAgICAgfTsKICAgIH0KICAgIAogICAgc3RvcmUoa2V5LCBkZXB0aCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlID0gbnVsbCwgbW92ZVNlcXVlbmNlID0gbnVsbCkgewogICAgICAgIGlmICh0aGlzLnRhYmxlLnNpemUgPj0gdGhpcy5zaXplKSB7CiAgICAgICAgICAgIC8vIOeugOWNleeahExSVeetlueVpe+8muenu+mZpOesrOS4gOS4quWFg+e0oAogICAgICAgICAgICBjb25zdCBmaXJzdEtleSA9IHRoaXMudGFibGUua2V5cygpLm5leHQoKS52YWx1ZTsKICAgICAgICAgICAgdGhpcy50YWJsZS5kZWxldGUoZmlyc3RLZXkpOwogICAgICAgICAgICB0aGlzLnN0YXRzLmxydUV2aWN0aW9ucysrOwogICAgICAgIH0KICAgICAgICB0aGlzLnRhYmxlLnNldChrZXksIHsgZGVwdGgsIHZhbHVlLCBmbGFnLCBiZXN0TW92ZSwgbW92ZVNlcXVlbmNlIH0pOwogICAgICAgIHRoaXMuc3RhdHMuc3RvcmVzKys7CiAgICB9CiAgICAKICAgIHJldHJpZXZlKGtleSkgewogICAgICAgIGNvbnN0IGVudHJ5ID0gdGhpcy50YWJsZS5nZXQoa2V5KSB8fCBudWxsOwogICAgICAgIGlmIChlbnRyeSkgewogICAgICAgICAgICB0aGlzLnN0YXRzLmhpdHMrKzsKICAgICAgICAgICAgLy8g57uf6K6h5LiN5ZCM57G75Z6L55qE5ZG95LitCiAgICAgICAgICAgIHN3aXRjaCAoZW50cnkuZmxhZykgewogICAgICAgICAgICAgICAgY2FzZSAnZXhhY3QnOgogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMuZXhhY3RIaXRzKys7CiAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICBjYXNlICdsb3dlcmJvdW5kJzoKICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLmxvd2VyYm91bmRIaXRzKys7CiAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICBjYXNlICd1cHBlcmJvdW5kJzoKICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLnVwcGVyYm91bmRIaXRzKys7CiAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIH0KICAgICAgICB9IGVsc2UgewogICAgICAgICAgICB0aGlzLnN0YXRzLm1pc3NlcysrOwogICAgICAgIH0KICAgICAgICByZXR1cm4gZW50cnk7CiAgICB9CiAgICAKICAgIGNsZWFyKCkgewogICAgICAgIHRoaXMudGFibGUuY2xlYXIoKTsKICAgICAgICB0aGlzLnN0YXRzLmNsZWFycysrOwogICAgfQogICAgCiAgICAvLyDojrflj5bnu5/orqHkv6Hmga/lubborqHnrpflkb3kuK3njocKICAgIGdldFN0YXRzKCkgewogICAgICAgIGNvbnN0IHRvdGFsQWNjZXNzZXMgPSB0aGlzLnN0YXRzLmhpdHMgKyB0aGlzLnN0YXRzLm1pc3NlczsKICAgICAgICBjb25zdCBoaXRSYXRlID0gdG90YWxBY2Nlc3NlcyA+IDAgPyAodGhpcy5zdGF0cy5oaXRzIC8gdG90YWxBY2Nlc3NlcyAqIDEwMCkudG9GaXhlZCgyKSA6IDA7CiAgICAgICAgcmV0dXJuIHsKICAgICAgICAgICAgLi4udGhpcy5zdGF0cywKICAgICAgICAgICAgdG90YWxBY2Nlc3NlcywKICAgICAgICAgICAgaGl0UmF0ZSwKICAgICAgICAgICAgY3VycmVudFNpemU6IHRoaXMudGFibGUuc2l6ZSwKICAgICAgICAgICAgbWF4U2l6ZTogdGhpcy5zaXplLAogICAgICAgICAgICBmaWxsUGVyY2VudGFnZTogKHRoaXMudGFibGUuc2l6ZSAvIHRoaXMuc2l6ZSAqIDEwMCkudG9GaXhlZCgyKQogICAgICAgIH07CiAgICB9CiAgICAKICAgIC8vIOmHjee9rue7n+iuoeS/oeaBrwogICAgcmVzZXRTdGF0cygpIHsKICAgICAgICB0aGlzLnN0YXRzID0gewogICAgICAgICAgICBoaXRzOiAwLAogICAgICAgICAgICBtaXNzZXM6IDAsCiAgICAgICAgICAgIGV4YWN0SGl0czogMCwKICAgICAgICAgICAgbG93ZXJib3VuZEhpdHM6IDAsCiAgICAgICAgICAgIHVwcGVyYm91bmRIaXRzOiAwLAogICAgICAgICAgICBzdG9yZXM6IDAsCiAgICAgICAgICAgIGxydUV2aWN0aW9uczogMCwKICAgICAgICAgICAgY2xlYXJzOiAwCiAgICAgICAgfTsKICAgIH0KfQoKLy8g5oCn6IO957uf6K6hCmxldCBwZXJmU3RhdHMgPSB7CiAgICBldmFsdWF0ZUJvYXJkQ291bnQ6IHsgcmVkOiAwLCBibGFjazogMCB9LAogICAgcHJlcGFyZVNlYXJjaEluZm9Db3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sCiAgICBhbHBoYUJldGFDYWxsczogMCwgIC8vIOaAu+iwg+eUqOasoeaVsAogICAgbm9kZXNTZWFyY2hlZDoge30sIC8vIOaMiea3seW6pue7n+iuoeaQnOe0oueahOiKgueCueaVsAogICAgbW92ZXNHZW5lcmF0ZWQ6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHnlJ/miJDnmoTotbDms5XmlbAKICAgIGN1dG9mZnM6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHliarmnp3mrKHmlbAKICAgIC8vIOWQiOazleaAp+i3r+W+hO+8muS8quWQiOazleeUn+aIkOmHj+OAgeivlei1sOWQiOazleaAp+ajgOa1i+OAgemdnuazlei3s+i/h+OAgeWunumZhei/m+WFpeaQnOe0oueahOWQiOazleedgAogICAgcHNldWRvTW92ZXNHZW5lcmF0ZWQ6IDAsCiAgICBsZWdhbGl0eUNoZWNrczogMCwKICAgIGlsbGVnYWxNb3Zlc1NraXBwZWQ6IDAsCiAgICBsZWdhbE1vdmVzU2VhcmNoZWQ6IDAsCiAgICAvLyBab2JyaXN077ya5YWo55uY6YeN566X5qyh5pWwIC8g5aKe6YeP5pu05paw5qyh5pWwIC8g5qCh6aqM5LiN5LiA6Ie077yI5LuFIHZlcmlmeSDmqKHlvI/vvIkKICAgIGZ1bGxIYXNoQ291bnQ6IDAsCiAgICBpbmNyZW1lbnRhbEhhc2hVcGRhdGVzOiAwLAogICAgaGFzaE1pc21hdGNoZXM6IDAsCiAgICBldmFsdWF0ZUJvYXJkTXM6IDAsCiAgICBwcmVwYXJlU2VhcmNoSW5mb01zOiAwLAogICAgc3RhcnRUaW1lOiBEYXRlLm5vdygpCn07CgovLyDph43nva7nu5/orqHvvIjmr4/mrKHmkJzntKLlvIDlp4vml7bosIPnlKjvvIkKY29uc3QgcmVzZXRQZXJmU3RhdHMgPSAoKSA9PiB7CiAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50ID0geyByZWQ6IDAsIGJsYWNrOiAwIH07CiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9OwogICAgcGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50ID0geyByZWQ6IDAsIGJsYWNrOiAwIH07CiAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMgPSAwOwogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWQgPSB7fTsKICAgIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZCA9IHt9OwogICAgcGVyZlN0YXRzLmN1dG9mZnMgPSB7fTsKICAgIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCA9IDA7CiAgICBwZXJmU3RhdHMubGVnYWxpdHlDaGVja3MgPSAwOwogICAgcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQgPSAwOwogICAgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCA9IDA7CiAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCA9IDA7CiAgICBwZXJmU3RhdHMuaW5jcmVtZW50YWxIYXNoVXBkYXRlcyA9IDA7CiAgICBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMgPSAwOwogICAgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcyA9IDA7CiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcyA9IDA7CiAgICBwZXJmU3RhdHMuc3RhcnRUaW1lID0gRGF0ZS5ub3coKTsKfTsKCmNvbnN0IHNuYXBzaG90UGVyZlN0YXRzID0gKCkgPT4gewogICAgY29uc3QgZWxhcHNlZCA9IERhdGUubm93KCkgLSBwZXJmU3RhdHMuc3RhcnRUaW1lOwogICAgY29uc3QgdHRTdGF0cyA9IHRyYW5zcG9zaXRpb25UYWJsZS5nZXRTdGF0cygpOwogICAgY29uc3QgZGVwdGhzID0gT2JqZWN0LmtleXMocGVyZlN0YXRzLm5vZGVzU2VhcmNoZWQpLnNvcnQoKGEsIGIpID0+IE51bWJlcihhKSAtIE51bWJlcihiKSk7CiAgICBjb25zdCBieURlcHRoID0ge307CiAgICBmb3IgKGNvbnN0IGQgb2YgZGVwdGhzKSB7CiAgICAgICAgYnlEZXB0aFtkXSA9IHsKICAgICAgICAgICAgbm9kZXM6IHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdIHx8IDAsCiAgICAgICAgICAgIG1vdmVzOiBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gfHwgMCwKICAgICAgICAgICAgY3V0b2ZmczogcGVyZlN0YXRzLmN1dG9mZnNbZF0gfHwgMAogICAgICAgIH07CiAgICB9CiAgICByZXR1cm4gewogICAgICAgIGVsYXBzZWRNczogZWxhcHNlZCwKICAgICAgICBkZWZlckxlZ2FsaXR5OiBTRUFSQ0hfREVGRVJfTEVHQUxJVFksCiAgICAgICAgaW5jcmVtZW50YWxab2JyaXN0OiBTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCwKICAgICAgICBsZWFmQXR0YWNrQml0czogU0VBUkNIX0xFQUZfQVRUQUNLX0JJVFMsCiAgICAgICAgcmVsYXRpb25NYXNrczogU0VBUkNIX1JFTEFUSU9OX01BU0tTLAogICAgICAgIGV2YWx1YXRlQm9hcmQ6IHsgLi4ucGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRDb3VudCB9LAogICAgICAgIHByZXBhcmVTZWFyY2hJbmZvOiB7IC4uLnBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50IH0sCiAgICAgICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzOiB7IC4uLnBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudCB9LAogICAgICAgIGFscGhhQmV0YUNhbGxzOiBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMsCiAgICAgICAgcHNldWRvTW92ZXNHZW5lcmF0ZWQ6IHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCwKICAgICAgICBsZWdhbGl0eUNoZWNrczogcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzLAogICAgICAgIGlsbGVnYWxNb3Zlc1NraXBwZWQ6IHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkLAogICAgICAgIGxlZ2FsTW92ZXNTZWFyY2hlZDogcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCwKICAgICAgICBmdWxsSGFzaENvdW50OiBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCwKICAgICAgICBpbmNyZW1lbnRhbEhhc2hVcGRhdGVzOiBwZXJmU3RhdHMuaW5jcmVtZW50YWxIYXNoVXBkYXRlcywKICAgICAgICBoYXNoTWlzbWF0Y2hlczogcGVyZlN0YXRzLmhhc2hNaXNtYXRjaGVzLAogICAgICAgIGV2YWx1YXRlQm9hcmRNczogcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcywKICAgICAgICBwcmVwYXJlU2VhcmNoSW5mb01zOiBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcywKICAgICAgICB0dDogdHRTdGF0cywKICAgICAgICBieURlcHRoCiAgICB9Owp9OwoKLy8g5omT5Y2w57uf6K6h5L+h5oGvCmNvbnN0IGxvZ1BlcmZTdGF0cyA9IChjdXJyZW50UGxheWVyKSA9PiB7CiAgICBjb25zdCBzbmFwID0gc25hcHNob3RQZXJmU3RhdHMoKTsKICAgIGNvbnNvbGUubG9nKGDwn5OKIOaAp+iDvee7n+iuoSAoJHtjdXJyZW50UGxheWVyfSkgLSAke3NuYXAuZWxhcHNlZE1zfW1zOmApOwogICAgY29uc29sZS5sb2coYCAgIGV2YWx1YXRlQm9hcmQ6IHJlZD0ke3NuYXAuZXZhbHVhdGVCb2FyZC5yZWR9LCBibGFjaz0ke3NuYXAuZXZhbHVhdGVCb2FyZC5ibGFja31gKTsKICAgIGNvbnNvbGUubG9nKGAgICBwcmVwYXJlU2VhcmNoSW5mbzogcmVkPSR7c25hcC5wcmVwYXJlU2VhcmNoSW5mby5yZWR9LCBibGFjaz0ke3NuYXAucHJlcGFyZVNlYXJjaEluZm8uYmxhY2t9YCk7CiAgICBjb25zb2xlLmxvZyhgICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzOiByZWQ9JHtzbmFwLmNhbGN1bGF0ZVRocmVhdFZhbHVlcy5yZWR9LCBibGFjaz0ke3NuYXAuY2FsY3VsYXRlVGhyZWF0VmFsdWVzLmJsYWNrfWApOwogICAgY29uc29sZS5sb2coYCAgIGFscGhhQmV0Yeiwg+eUqOasoeaVsDogJHtzbmFwLmFscGhhQmV0YUNhbGxzfWApOwogICAgY29uc29sZS5sb2coYCAgIOWQiOazleaApzogcHNldWRvPSR7c25hcC5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZH0sIGNoZWNrcz0ke3NuYXAubGVnYWxpdHlDaGVja3N9LCBpbGxlZ2FsU2tpcD0ke3NuYXAuaWxsZWdhbE1vdmVzU2tpcHBlZH0sIGxlZ2FsU2VhcmNoZWQ9JHtzbmFwLmxlZ2FsTW92ZXNTZWFyY2hlZH1gKTsKICAgIGNvbnNvbGUubG9nKGAgICBab2JyaXN0OiBpbmNyZW1lbnRhbD0ke3NuYXAuaW5jcmVtZW50YWxab2JyaXN0fSwgZnVsbEhhc2g9JHtzbmFwLmZ1bGxIYXNoQ291bnR9LCBpbmNyVXBkYXRlcz0ke3NuYXAuaW5jcmVtZW50YWxIYXNoVXBkYXRlc30sIG1pc21hdGNoZXM9JHtzbmFwLmhhc2hNaXNtYXRjaGVzfWApOwogICAgY29uc29sZS5sb2coYCAgIGxlYWZBdHRhY2tCaXRzPSR7c25hcC5sZWFmQXR0YWNrQml0c30gcmVsYXRpb25NYXNrcz0ke3NuYXAucmVsYXRpb25NYXNrc30gZXZhbE1zPSR7TWF0aC5yb3VuZChzbmFwLmV2YWx1YXRlQm9hcmRNcyl9IHByZXBhcmVNcz0ke01hdGgucm91bmQoc25hcC5wcmVwYXJlU2VhcmNoSW5mb01zKX1gKTsKICAgIGNvbnNvbGUubG9nKGAgICBUVDogaGl0cz0ke3NuYXAudHQuaGl0c30sIG1pc3Nlcz0ke3NuYXAudHQubWlzc2VzfSwgaGl0UmF0ZT0ke3NuYXAudHQuaGl0UmF0ZX0lLCBzdG9yZXM9JHtzbmFwLnR0LnN0b3Jlc30sIHNpemU9JHtzbmFwLnR0LmN1cnJlbnRTaXplfWApOwogICAgCiAgICBjb25zdCBkZXB0aHMgPSBPYmplY3Qua2V5cyhzbmFwLmJ5RGVwdGgpOwogICAgaWYgKGRlcHRocy5sZW5ndGggPiAwKSB7CiAgICAgICAgY29uc29sZS5sb2coJyAgIOaMiea3seW6pue7n+iuoTonKTsKICAgICAgICBmb3IgKGNvbnN0IGQgb2YgZGVwdGhzKSB7CiAgICAgICAgICAgIGNvbnN0IHJvdyA9IHNuYXAuYnlEZXB0aFtkXTsKICAgICAgICAgICAgY29uc29sZS5sb2coYCAgICAg5rex5bqmJHtkfTog6IqC54K5PSR7cm93Lm5vZGVzfSwg6LWw5rOVPSR7cm93Lm1vdmVzfSwg5Ymq5p6dPSR7cm93LmN1dG9mZnN9YCk7CiAgICAgICAgfQogICAgfQp9OwoKY29uc3QgdHJhbnNwb3NpdGlvblRhYmxlID0gbmV3IFRyYW5zcG9zaXRpb25UYWJsZSgpOwoKLy8g5Y+26K+E5Lyw57yT5a2Y77yI5a6M5pW05b2i5Yq/5YiG77yJ77yb5q+P5qyhIGdldEJlc3RNb3ZlIOa4heepugpjb25zdCBFVkFMX0NBQ0hFX01BWCA9IE1hdGgucG93KDIsIDE4KTsKY29uc3QgZXZhbENhY2hlID0gbmV3IE1hcCgpOwpjb25zdCBjbGVhckV2YWxDYWNoZSA9ICgpID0+IHsKICAgIGV2YWxDYWNoZS5jbGVhcigpOwp9OwoKLy8g5Ymq5p6d5byA5YWz77ya5a6M5pW06K+E5Lyw5LiL6Iul5byA5bGA5Ye65bqf5qOL5YiZ5YWI5YWz77yM5L+d5qOL5Yqb5YaN6YeN5qCH5a6aCmNvbnN0IFNFQVJDSF9FTkFCTEVfTk1QID0gZmFsc2U7CmNvbnN0IFNFQVJDSF9FTkFCTEVfTE1SID0gZmFsc2U7CgovLyDnnYDms5XlkIjms5XmgKfvvJp0cnVlPeaQnOe0ouWGheivlei1sOaXtuajgOa1i++8iOWPr+i3s+i/h+WJquaeneacquinpuWPiuedgOazle+8ie+8m2ZhbHNlPXByZXBhcmUg5pe25YWo6YePIGZpbHRlckxlZ2FsTW92ZXPvvIjml6fot6/lvoTvvIkKbGV0IFNFQVJDSF9ERUZFUl9MRUdBTElUWSA9IHRydWU7CgovLyBab2JyaXN0L1RU77yadHJ1ZT3mkJzntKLlhoXlop7ph4/nu7TmiqTlsYDpnaLlk4jluIwgKyDmlbDlgLwgVFQga2V577ybZmFsc2U95q+P6IqC54K55YWo55uYIGhhc2ggKyDlrZfnrKbkuLIga2V577yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQpsZXQgU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QgPSB0cnVlOwovLyDosIPor5XvvJrlop7ph4/lkI7kuI7lhajnm5ggaGFzaCDmr5Tlr7nvvIjku4XmoKHpqozohJrmnKzlvIDlkK/vvIzmraPlvI/mkJzntKLlhbPpl63vvIkKbGV0IFNFQVJDSF9aT0JSSVNUX1ZFUklGWSA9IGZhbHNlOwoKLy8g5pCc57Si5ZCv5Y+R77ya5p2A5qOL6KGoICsg5Y6G5Y+y5ZCv5Y+R77yI5q+P5qyhIGdldEJlc3RNb3ZlIOmHjee9ru+8iQpsZXQga2lsbGVyTW92ZXMgPSBbXTsKbGV0IGhpc3RvcnlUYWJsZSA9IG51bGw7Cgpjb25zdCByZXNldFNlYXJjaEhldXJpc3RpY3MgPSAobWF4RGVwdGgpID0+IHsKICAgIGtpbGxlck1vdmVzID0gQXJyYXkobWF4RGVwdGggKyAyKS5maWxsKG51bGwpLm1hcCgoKSA9PiBbbnVsbCwgbnVsbF0pOwogICAgaGlzdG9yeVRhYmxlID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogMTAgfSwgKCkgPT4KICAgICAgICBBcnJheS5mcm9tKHsgbGVuZ3RoOiA5IH0sICgpID0+CiAgICAgICAgICAgIEFycmF5LmZyb20oeyBsZW5ndGg6IDEwIH0sICgpID0+IEFycmF5KDkpLmZpbGwoMCkpCiAgICAgICAgKQogICAgKTsKfTsKCmNvbnN0IGlzU2FtZU1vdmUgPSAoYSwgYikgPT4KICAgIGEgJiYgYiAmJgogICAgYS5mcm9tLnIgPT09IGIuZnJvbS5yICYmIGEuZnJvbS5jID09PSBiLmZyb20uYyAmJgogICAgYS50by5yID09PSBiLnRvLnIgJiYgYS50by5jID09PSBiLnRvLmM7Cgpjb25zdCBzdG9yZUtpbGxlck1vdmUgPSAoZGVwdGgsIG1vdmUpID0+IHsKICAgIGlmIChkZXB0aCA8IDAgfHwgZGVwdGggPj0ga2lsbGVyTW92ZXMubGVuZ3RoIHx8ICFtb3ZlKSByZXR1cm47CiAgICBjb25zdCBzbG90ID0ga2lsbGVyTW92ZXNbZGVwdGhdOwogICAgaWYgKGlzU2FtZU1vdmUoc2xvdFswXSwgbW92ZSkpIHJldHVybjsKICAgIHNsb3RbMV0gPSBzbG90WzBdOwogICAgc2xvdFswXSA9IHsgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogbW92ZS5mcm9tLmMgfSwgdG86IHsgcjogbW92ZS50by5yLCBjOiBtb3ZlLnRvLmMgfSB9Owp9OwoKY29uc3QgYWRkSGlzdG9yeVNjb3JlID0gKG1vdmUsIGRlcHRoKSA9PiB7CiAgICBpZiAoIWhpc3RvcnlUYWJsZSB8fCAhbW92ZSkgcmV0dXJuOwogICAgY29uc3QgeyBmcm9tLCB0byB9ID0gbW92ZTsKICAgIGhpc3RvcnlUYWJsZVtmcm9tLnJdW2Zyb20uY11bdG8ucl1bdG8uY10gKz0gZGVwdGggKiBkZXB0aDsKfTsKCmNvbnN0IGdldEhpc3RvcnlTY29yZSA9IChtb3ZlKSA9PiB7CiAgICBpZiAoIWhpc3RvcnlUYWJsZSB8fCAhbW92ZSkgcmV0dXJuIDA7CiAgICBjb25zdCB7IGZyb20sIHRvIH0gPSBtb3ZlOwogICAgcmV0dXJuIGhpc3RvcnlUYWJsZVtmcm9tLnJdW2Zyb20uY11bdG8ucl1bdG8uY10gfHwgMDsKfTsKCi8vIFdvcmtlciBtZXNzYWdlIGhhbmRsaW5nCmlmICh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcpIHsKICAgIHNlbGYub25tZXNzYWdlID0gZnVuY3Rpb24oZSkgewogICAgY29uc3QgeyB0eXBlLCBwYXlsb2FkIH0gPSBlLmRhdGE7CiAgICAKICAgIHN3aXRjaCAodHlwZSkgeyAgICAgICAgICAgIAogICAgICAgIGNhc2UgJ1NFQVJDSCc6IHsKICAgICAgICAgICAgY29uc3QgeyBib2FyZDogc2VhcmNoQm9hcmQsIHR1cm46IHNlYXJjaFR1cm4sIGRlcHRoOiBzZWFyY2hEZXB0aCwgcmFuZG9tbmVzczogc2VhcmNoUmFuZG9tbmVzcywgZ2FtZUlkLCBvcGVuaW5nQm9va0VuYWJsZWQ6IHNlYXJjaE9wZW5pbmdCb29rRW5hYmxlZCA9IHRydWUsIHBseTogc2VhcmNoUGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0OiBzZWFyY2hFbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzOiBzZWFyY2hFeGFjdFJvb3RTY29yZXMgPSBmYWxzZSwgZGVmZXJMZWdhbGl0eTogc2VhcmNoRGVmZXJMZWdhbGl0eSwgaW5jcmVtZW50YWxab2JyaXN0OiBzZWFyY2hJbmNyZW1lbnRhbFpvYnJpc3QsIGxlYWZBdHRhY2tCaXRzOiBzZWFyY2hMZWFmQXR0YWNrQml0cywgcmVsYXRpb25NYXNrczogc2VhcmNoUmVsYXRpb25NYXNrcywgem9icmlzdFZlcmlmeTogc2VhcmNoWm9icmlzdFZlcmlmeSB9ID0gcGF5bG9hZDsKICAgICAgICAgICAgaWYgKHR5cGVvZiBzZWFyY2hEZWZlckxlZ2FsaXR5ID09PSAnYm9vbGVhbicpIHsKICAgICAgICAgICAgICAgIFNFQVJDSF9ERUZFUl9MRUdBTElUWSA9IHNlYXJjaERlZmVyTGVnYWxpdHk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgaWYgKHR5cGVvZiBzZWFyY2hJbmNyZW1lbnRhbFpvYnJpc3QgPT09ICdib29sZWFuJykgewogICAgICAgICAgICAgICAgU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QgPSBzZWFyY2hJbmNyZW1lbnRhbFpvYnJpc3Q7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgaWYgKHR5cGVvZiBzZWFyY2hMZWFmQXR0YWNrQml0cyA9PT0gJ2Jvb2xlYW4nKSB7CiAgICAgICAgICAgICAgICBTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUUyA9IHNlYXJjaExlYWZBdHRhY2tCaXRzOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoUmVsYXRpb25NYXNrcyA9PT0gJ2Jvb2xlYW4nKSB7CiAgICAgICAgICAgICAgICBTRUFSQ0hfUkVMQVRJT05fTUFTS1MgPSBzZWFyY2hSZWxhdGlvbk1hc2tzOwogICAgICAgICAgICB9CiAgICAgICAgICAgIFNFQVJDSF9aT0JSSVNUX1ZFUklGWSA9ICEhc2VhcmNoWm9icmlzdFZlcmlmeTsKICAgICAgICAgICAgLy8gU2V0IG9wZW5pbmcgYm9vayBlbmFibGVkIHN0YXR1cwogICAgICAgICAgICBvcGVuaW5nQm9vay5zZXRFbmFibGVkKHNlYXJjaE9wZW5pbmdCb29rRW5hYmxlZCk7CiAgICAgICAgICAgIC8vIOiusOW9leaQnOe0ouW8gOWni+aXtumXtAogICAgICAgICAgICBjb25zdCBzdGFydFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKTsKICAgICAgICAgICAgLy8g5omn6KGM5pCc57SiCiAgICAgICAgICAgIGNvbnN0IGJlc3RTZWFyY2hNb3ZlID0gZ2V0QmVzdE1vdmUoc2VhcmNoQm9hcmQsIHNlYXJjaFR1cm4sIHNlYXJjaERlcHRoLCBzZWFyY2hSYW5kb21uZXNzLCBzZWFyY2hQbHksIHNlYXJjaEVuYWJsZVRpbWVMaW1pdCwgc2VhcmNoRXhhY3RSb290U2NvcmVzKTsKICAgICAgICAgICAgLy8g6K6w5b2V5pCc57Si57uT5p2f5pe26Ze05bm26K6h566X5oCd6ICD5pe26Ze0CiAgICAgICAgICAgIGNvbnN0IGVuZFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKTsKICAgICAgICAgICAgY29uc3QgdGhpbmtpbmdUaW1lID0gZW5kVGltZSAtIHN0YXJ0VGltZTsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIOajgOafpeaYr+WQpuadpeiHquW8gOWxgOW6kwogICAgICAgICAgICBjb25zdCBib29rTW92ZVNlYXJjaCA9IG9wZW5pbmdCb29rLmdldEJvb2tNb3ZlKHNlYXJjaEJvYXJkLCBzZWFyY2hQbHkpOwogICAgICAgICAgICBjb25zdCBmcm9tQm9va1NlYXJjaCA9ICEhYm9va01vdmVTZWFyY2ggJiYgSlNPTi5zdHJpbmdpZnkoYm9va01vdmVTZWFyY2gpID09PSBKU09OLnN0cmluZ2lmeShiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSk7CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyDmt7vliqDmgKfog73nu5/orqHml6Xlv5cKICAgICAgICAgICAgbG9nUGVyZlN0YXRzKHNlYXJjaFR1cm4pOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8g5re75Yqg5oCd6ICD5pe26Ze05pel5b+XCiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBTZWFyY2ggY29tcGxldGVkIGluICR7TWF0aC5yb3VuZCh0aGlua2luZ1RpbWUpfW1zLCBnYW1lSWQ9JHtnYW1lSWR9LCBiZXN0TW92ZT0ke0pTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlKX0sIHNlY29uZEJlc3RNb3ZlPSR7SlNPTi5zdHJpbmdpZnkoYmVzdFNlYXJjaE1vdmUuc2Vjb25kQmVzdE1vdmUpfSwgZnJvbUJvb2s9JHtmcm9tQm9va1NlYXJjaH1gKTsKICAgICAgICAgICAgLy8g5Y+R6YCB5pCc57Si57uT5p6c5ZKM5oCd6ICD5pe26Ze0CiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyAKICAgICAgICAgICAgICAgIHR5cGU6ICdTRUFSQ0hfQ09NUExFVEUnLCAKICAgICAgICAgICAgICAgIHBheWxvYWQ6IHsgCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmU6IGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlLCAKICAgICAgICAgICAgICAgICAgICBzZWNvbmRCZXN0TW92ZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kQmVzdE1vdmUsIAogICAgICAgICAgICAgICAgICAgIGdhbWVJZCwgCiAgICAgICAgICAgICAgICAgICAgZnJvbUJvb2s6IGZyb21Cb29rU2VhcmNoLCAKICAgICAgICAgICAgICAgICAgICB0aGlua2luZ1RpbWU6IE1hdGgucm91bmQodGhpbmtpbmdUaW1lKSwgLy8g5Zub6IiN5LqU5YWl5Yiw5q+r56eSCiAgICAgICAgICAgICAgICAgICAgbW92ZVNlcXVlbmNlOiBiZXN0U2VhcmNoTW92ZS5tb3ZlU2VxdWVuY2UsCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kTW92ZVNlcXVlbmNlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRNb3ZlU2VxdWVuY2UsCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTY29yZTogYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmVTY29yZSwKICAgICAgICAgICAgICAgICAgICBzZWNvbmRCZXN0TW92ZVNjb3JlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZVNjb3JlLAogICAgICAgICAgICAgICAgICAgIGFsbE1vdmVzV2l0aFNjb3JlczogYmVzdFNlYXJjaE1vdmUuYWxsTW92ZXNXaXRoU2NvcmVzIHx8IFtdLAogICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlZERlcHRoOiBiZXN0U2VhcmNoTW92ZS5jb21wbGV0ZWREZXB0aCwKICAgICAgICAgICAgICAgICAgICBwZXJmOiBzbmFwc2hvdFBlcmZTdGF0cygpCiAgICAgICAgICAgICAgICB9IAogICAgICAgICAgICB9KTsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgICAgIGNhc2UgJ2dldFZhbGlkTW92ZXMnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHZtQm9hcmQsIHBvczogdm1Qb3MgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIHN5bmNHZW5lcmFsUG9zQ2FjaGUodm1Cb2FyZCk7CiAgICAgICAgICAgIGNvbnN0IHZhbGlkTW92ZXMgPSBnZXRWYWxpZE1vdmVzKHZtQm9hcmQsIHZtUG9zKTsKICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7CiAgICAgICAgICAgICAgICB0eXBlOiAndmFsaWRNb3ZlcycsCiAgICAgICAgICAgICAgICBtb3ZlczogdmFsaWRNb3ZlcwogICAgICAgICAgICB9KTsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICBjYXNlICdnZXRQaWVjZVJlbGF0aW9ucyc6IHsKICAgICAgICAgICAgY29uc3QgeyBib2FyZDogcHJCb2FyZCwgcG9zOiBwclBvcyB9ID0gcGF5bG9hZDsKICAgICAgICAgICAgY29uc3QgcGllY2UgPSBwckJvYXJkW3ByUG9zLnJdW3ByUG9zLmNdOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8g6LCD55SoZXZhbHVhdGVCb2FyZOiOt+WPluWujOaVtOeahOaji+WtkOS/oeaBr+WSjGJvYXJkSW5mbwogICAgICAgICAgICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZShwckJvYXJkKTsKICAgICAgICAgICAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7CiAgICAgICAgICAgIGNvbnN0IGJvYXJkRXZhbHVhdGlvbiA9IGV2YWx1YXRlQm9hcmQocHJCb2FyZCwgZmFsc2UsIG51bGwsIDAsIG51bGwsIGdhbWVTdGFnZSk7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlc0luZm8gPSBib2FyZEV2YWx1YXRpb24ucGllY2VzSW5mbzsKICAgICAgICAgICAgY29uc3QgYm9hcmRJbmZvID0gYm9hcmRFdmFsdWF0aW9uLmJvYXJkSW5mbzsKCiAgICAgICAgICAgIGlmIChib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcykgewogICAgICAgICAgICAgICAgaHlkcmF0ZVJlbGF0aW9uc0Zyb21NYXNrcyhwaWVjZXNJbmZvLCBib2FyZEluZm8pOwogICAgICAgICAgICB9CgogICAgICAgICAgICAvLyBib2FyZEluZm8g5qC85YaF5Y+v6IO95pivIHBpZWNlc0luZm8g5byV55So77yM57uf5LiA5pig5bCE5Li6IHtyLGN9IOS+myBVSSDkvb/nlKgKICAgICAgICAgICAgY29uc3QgcmF3Q29udHJvbGxlcnMgPSBib2FyZEluZm8uY29udHJvbGxlckdyaWQKICAgICAgICAgICAgICAgID8gKGJvYXJkSW5mby5jb250cm9sbGVyR3JpZFtwclBvcy5yXVtwclBvcy5jXSB8fCBbXSkKICAgICAgICAgICAgICAgIDogKGJvYXJkSW5mb1twclBvcy5yXSAmJiBib2FyZEluZm9bcHJQb3Mucl1bcHJQb3MuY10pIHx8IFtdOwogICAgICAgICAgICBjb25zdCBjb250cm9sbGVycyA9IHJhd0NvbnRyb2xsZXJzLm1hcCgoY3RybCkgPT4gKHsgcjogY3RybC5yLCBjOiBjdHJsLmMgfSkpOwogICAgICAgICAgICAKICAgICAgICAgICAgbGV0IHJlbGF0aW9ucyA9IHsKICAgICAgICAgICAgICAgIHRocmVhdDogW10sIAogICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwgCiAgICAgICAgICAgICAgICBndWFyZDogW10sIAogICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwgCiAgICAgICAgICAgICAgICBjb250cm9sOiBbXSwKICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJzCiAgICAgICAgICAgIH07CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyDlpoLmnpzngrnlh7vnmoTmmK/mo4vlrZDvvIzov5Tlm57or6Xmo4vlrZDnmoTlhbPns7vkv6Hmga8KICAgICAgICAgICAgaWYgKHBpZWNlKSB7CiAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBjdXJyZW50IHBpZWNlIGluZm8KICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRQaWVjZUluZm8gPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHByUG9zLnIgJiYgcC5jID09PSBwclBvcy5jKTsKICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRQaWVjZUluZm8pIHsKICAgICAgICAgICAgICAgICAgICAvLyBFeHRyYWN0IHJlbGF0aW9ucwogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRocmVhdCA9IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0Lm1hcCh0aHJlYXRQaWVjZSA9PiAoeyByOiB0aHJlYXRQaWVjZS5yLCBjOiB0aHJlYXRQaWVjZS5jIH0pKTsKICAgICAgICAgICAgICAgICAgICBjb25zdCB0aHJlYXRlbmVkQnkgPSBjdXJyZW50UGllY2VJbmZvLnRocmVhdGVuZWRCeS5tYXAodGhyZWF0ZW5lZEJ5UGllY2UgPT4gKHsgcjogdGhyZWF0ZW5lZEJ5UGllY2UuciwgYzogdGhyZWF0ZW5lZEJ5UGllY2UuYyB9KSk7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZ3VhcmQgPSBjdXJyZW50UGllY2VJbmZvLmd1YXJkLm1hcChndWFyZFBpZWNlID0+ICh7IHI6IGd1YXJkUGllY2UuciwgYzogZ3VhcmRQaWVjZS5jIH0pKTsKICAgICAgICAgICAgICAgICAgICBjb25zdCBndWFyZGVkQnkgPSBjdXJyZW50UGllY2VJbmZvLmd1YXJkZWRCeS5tYXAoZ3VhcmRlZEJ5UGllY2UgPT4gKHsgcjogZ3VhcmRlZEJ5UGllY2UuciwgYzogZ3VhcmRlZEJ5UGllY2UuYyB9KSk7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udHJvbCA9IChjdXJyZW50UGllY2VJbmZvLmNvbnRyb2wgfHwgW10pLm1hcChjb250cm9sUG9zID0+ICh7IHI6IGNvbnRyb2xQb3MuciwgYzogY29udHJvbFBvcy5jIH0pKTsKICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICByZWxhdGlvbnMgPSB7CiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdCwgCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeSwgCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkLCAKICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRlZEJ5LCAKICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbCwKICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbGxlcnMKICAgICAgICAgICAgICAgICAgICB9OwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsKICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZVJlbGF0aW9ucycsCiAgICAgICAgICAgICAgICByZWxhdGlvbnM6IHJlbGF0aW9ucwogICAgICAgICAgICB9KTsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICBjYXNlICdjaGVja0dhbWVTdGF0ZSc6IHsKICAgICAgICAgICAgY29uc3QgeyBib2FyZDogY2dzQm9hcmQsIHR1cm46IGNnc1R1cm4sIHJlcXVlc3RJZCB9ID0gcGF5bG9hZDsKICAgICAgICAgICAgY29uc3QgZ2FtZVN0YXRlID0gY2hlY2tHYW1lU3RhdGUoY2dzQm9hcmQsIGNnc1R1cm4pOwogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsKICAgICAgICAgICAgICAgIHR5cGU6ICdnYW1lU3RhdGUnLAogICAgICAgICAgICAgICAgc3RhdGU6IGdhbWVTdGF0ZSwKICAgICAgICAgICAgICAgIHJlcXVlc3RJZAogICAgICAgICAgICB9KTsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICBjYXNlICdldmFsdWF0ZUJvYXJkJzogewogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBldmFsQm9hcmQsIHR1cm46IGV2YWxUdXJuLCBpc1JlcGxheSA9IGZhbHNlLCBkZXB0aCA9IDEgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIC8vIOaJk+WNsOaOpeaUtueahOWPguaVsAogICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdldmFsdWF0ZUJvYXJkIGNhbGxlZCB3aXRoOicsIHsgdHVybjogZXZhbFR1cm4sIGlzUmVwbGF5LCBkZXB0aCB9KTsKICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoZXZhbEJvYXJkKTsKICAgICAgICAgICAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7CiAgICAgICAgICAgIGNvbnN0IGRldGFpbGVkRXZhbCA9IGV2YWx1YXRlQm9hcmQoZXZhbEJvYXJkLCBpc1JlcGxheSwgZXZhbFR1cm4sIGRlcHRoLCBldmFsVHVybiwgZ2FtZVN0YWdlKTsKICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7CiAgICAgICAgICAgICAgICB0eXBlOiAnZGV0YWlsZWRFdmFsdWF0aW9uJywKICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IGRldGFpbGVkRXZhbAogICAgICAgICAgICB9KTsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQoKICAgICAgICBjYXNlICdldmFsdWF0ZVBpZWNlJzogewogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBwaWVjZUV2YWxCb2FyZCwgcG9zOiBwaWVjZUV2YWxQb3MsIHR1cm4gfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gcGllY2VFdmFsQm9hcmRbcGllY2VFdmFsUG9zLnJdW3BpZWNlRXZhbFBvcy5jXTsKICAgICAgICAgICAgCiAgICAgICAgICAgIGlmICghcGllY2UpIHsKICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLAogICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsKICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAsCiAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLAogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwKICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiAwLAogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IDAsCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMAogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGVsc2UgewogICAgICAgICAgICAgICAgLy8g5Li75Yqo6LCD55SoZXZhbHVhdGVCb2FyZOiOt+WPluWujOaVtOeahOivhOS8sOS/oeaBrwogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5ri45oiP6Zi25q61CiAgICAgICAgICAgICAgICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZShwaWVjZUV2YWxCb2FyZCk7CiAgICAgICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsKICAgICAgICAgICAgICAgIGNvbnN0IGJvYXJkRXZhbHVhdGlvbiA9IGV2YWx1YXRlQm9hcmQocGllY2VFdmFsQm9hcmQsIGZhbHNlLCB0dXJuLCAwLCB0dXJuLCBnYW1lU3RhZ2UpOwogICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAvLyDku45ldmFsdWF0ZUJvYXJk55qE6L+U5Zue5YC85Lit5om+5Yiw5b2T5YmN5qOL5a2Q55qE5L+h5oGvCiAgICAgICAgICAgICAgICBjdXJyZW50UGllY2VJbmZvID0gYm9hcmRFdmFsdWF0aW9uLnBpZWNlc0luZm8uZmluZCgKICAgICAgICAgICAgICAgICAgICBwID0+IHAuciA9PT0gcGllY2VFdmFsUG9zLnIgJiYgcC5jID09PSBwaWVjZUV2YWxQb3MuYwogICAgICAgICAgICAgICAgKTsKICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRQaWVjZUluZm8pIHsKICAgICAgICAgICAgICAgICAgICAvLyDlupTnlKjmnYPph43lubbov5Tlm57ljZXkuKrmo4vlrZDnmoTor4TkvLDlgLwKICAgICAgICAgICAgICAgICAgICBjb25zdCBldmFsdWF0aW9uID0gewogICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogY3VycmVudFBpZWNlSW5mby5tYXRlcmlhbFZhbHVlICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwKICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IGN1cnJlbnRQaWVjZUluZm8ucG9zaXRpb25WYWx1ZSAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiBjdXJyZW50UGllY2VJbmZvLm1vYmlsaXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LAogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0VmFsdWUgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCwKICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiBjdXJyZW50UGllY2VJbmZvLnNhZmV0eVZhbHVlICogVkFMVUVfV0VJR0hUUy5zYWZldHksCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogY3VycmVudFBpZWNlSW5mby50YWN0aWNWYWx1ZSAqIFZBTFVFX1dFSUdIVFMudGFjdGljCiAgICAgICAgICAgICAgICAgICAgfTsKICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsKICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsCiAgICAgICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IGV2YWx1YXRpb24KICAgICAgICAgICAgICAgICAgICB9KTsKICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgLy8g5aaC5p6c5LuN54S25om+5LiN5Yiw5qOL5a2Q5L+h5oGv77yM6L+U5Zue6buY6K6k5YC8CiAgICAgICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7CiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLAogICAgICAgICAgICAgICAgICAgICAgICBldmFsdWF0aW9uOiB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogMCwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IDAsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IDAsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YWN0aWM6IDAKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICBjYXNlICdpc0NoZWNrJzogewogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBjQm9hcmQsIGNvbG9yOiBjQ29sb3IsIHJlcXVlc3RJZCB9ID0gcGF5bG9hZDsKICAgICAgICAgICAgc3luY0dlbmVyYWxQb3NDYWNoZShjQm9hcmQpOwogICAgICAgICAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVjayhjQm9hcmQsIGNDb2xvcik7CiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICAgICAgdHlwZTogJ2NoZWNrJywKICAgICAgICAgICAgICAgIGlzQ2hlY2s6IGluQ2hlY2ssCiAgICAgICAgICAgICAgICByZXF1ZXN0SWQKICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgY2FzZSAnaXNWYWxpZFBsYWNlbWVudCc6IHsKICAgICAgICAgICAgY29uc3QgeyB0eXBlOiBpcFR5cGUsIGNvbG9yOiBpcENvbG9yLCByLCBjIH0gPSBwYXlsb2FkOwogICAgICAgICAgICBjb25zdCB2YWxpZFBsYWNlbWVudCA9IGlzVmFsaWRQbGFjZW1lbnQoaXBUeXBlLCBpcENvbG9yLCByLCBjKTsKICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7CiAgICAgICAgICAgICAgICB0eXBlOiAndmFsaWRQbGFjZW1lbnQnLAogICAgICAgICAgICAgICAgaXNWYWxpZDogdmFsaWRQbGFjZW1lbnQKICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgY2FzZSAnYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nJzogewogICAgICAgICAgICBjb25zdCB7IG1vdmVzLCB3ZWlnaHRzIH0gPSBwYXlsb2FkOwogICAgICAgICAgICAvLyBBZGQgdGhlIG9wZW5pbmcgbGluZSB0byB0aGUgb3BlbmluZyBib29rCiAgICAgICAgICAgIG9wZW5pbmdCb29rLmFkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyhbbW92ZXNdLCB3ZWlnaHRzKTsKICAgICAgICAgICAgLy8gU2VuZCBjb25maXJtYXRpb24KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7IAogICAgICAgICAgICAgICAgdHlwZTogJ29wZW5pbmdMaW5lQWRkZWQnLCAKICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUgCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgIGNhc2UgJ21vdmVzVG9Ob3RhdGlvbic6IHsKICAgICAgICAgICAgY29uc3QgeyBib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5IH0gPSBwYXlsb2FkOwogICAgICAgICAgICBjb25zdCBub3RhdGlvbiA9IG9wZW5pbmdCb29rLm1vdmVzVG9Ob3RhdGlvbihib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5KTsKICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7IAogICAgICAgICAgICAgICAgdHlwZTogJ25vdGF0aW9uJywgCiAgICAgICAgICAgICAgICBub3RhdGlvbjogbm90YXRpb24gCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgIGNhc2UgJ25vdGF0aW9uVG9Nb3Zlcyc6IHsKICAgICAgICAgICAgY29uc3QgeyBub3RhdGlvbjogbm90YXRpb25TdHJpbmcsIGluaXRpYWxCb2FyZCB9ID0gcGF5bG9hZDsKICAgICAgICAgICAgY29uc3QgbW92ZXNGcm9tTm90YXRpb24gPSBvcGVuaW5nQm9vay5ub3RhdGlvblRvTW92ZXMobm90YXRpb25TdHJpbmcsIGluaXRpYWxCb2FyZCk7CiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyAKICAgICAgICAgICAgICAgIHR5cGU6ICdtb3ZlcycsIAogICAgICAgICAgICAgICAgbW92ZXM6IG1vdmVzRnJvbU5vdGF0aW9uIAogICAgICAgICAgICB9KTsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICBjYXNlICdzZXRWYWx1ZVdlaWdodHMnOiB7CiAgICAgICAgICAgIFZBTFVFX1dFSUdIVFMgPSB7IC4uLlZBTFVFX1dFSUdIVFMsIC4uLnBheWxvYWQgfTsKICAgICAgICAgICAgY29uc29sZS5sb2coJ1VwZGF0ZWQgVkFMVUVfV0VJR0hUUzonLCBWQUxVRV9XRUlHSFRTKTsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgfQp9OwoKICAgIC8vIE92ZXJyaWRlIGNvbnNvbGUubG9nIHRvIHNlbmQgbWVzc2FnZXMgYmFjayB0byBtYWluIHRocmVhZAogICAgY29uc3Qgb3JpZ2luYWxDb25zb2xlTG9nID0gY29uc29sZS5sb2c7CiAgICBjb25zb2xlLmxvZyA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHsKICAgICAgICAvLyBTZW5kIHRvIG1haW4gdGhyZWFkCiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7CiAgICAgICAgICAgIHR5cGU6ICdsb2cnLAogICAgICAgICAgICBkYXRhOiBhcmdzLmpvaW4oJyAnKQogICAgICAgIH0pOwogICAgICAgIAogICAgICAgIC8vIEFsc28gbG9nIHRvIHdvcmtlciBjb25zb2xlCiAgICAgICAgb3JpZ2luYWxDb25zb2xlTG9nLmFwcGx5KGNvbnNvbGUsIGFyZ3MpOwogICAgfTsKfQoKLy8g56m6552A5Ymq5p6d77ya5pyJ6L+b5pS75a2Q5Yqb5pe25omN5YWB6K6477yI6YG/5YWN5bCGL+Wjqy/osaHmrovlsYDpgLznnYDor6/liarvvIkKY29uc3QgY2FuRG9OdWxsTW92ZSA9IChib2FyZCwgY29sb3IpID0+IHsKICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7CiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsKICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICBpZiAoIXAgfHwgcC5jb2xvciAhPT0gY29sb3IpIGNvbnRpbnVlOwogICAgICAgICAgICBpZiAocC50eXBlID09PSAnY2hhcmlvdCcgfHwgcC50eXBlID09PSAnaG9yc2UnIHx8IHAudHlwZSA9PT0gJ2Nhbm5vbicgfHwgcC50eXBlID09PSAnc29sZGllcicpIHsKICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQogICAgcmV0dXJuIGZhbHNlOwp9OwoKLy8g5pCc57Si55SoIFRUIGtlee+8muWinumHj+aooeW8j+S4uiBudW1iZXLvvIzml6fmqKHlvI/kuLogYCR7aGFzaH06JHtzaWRlfWAg5a2X56ym5LiyCmNvbnN0IG1ha2VTZWFyY2hUVEtleSA9IChib2FyZCwgY3VycmVudFBsYXllciwgYm9hcmRIYXNoKSA9PiB7CiAgICBpZiAoU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QpIHsKICAgICAgICByZXR1cm4gem9icmlzdEhhc2hlci50dEtleUZyb21IYXNoKGJvYXJkSGFzaCwgY3VycmVudFBsYXllcik7CiAgICB9CiAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOwogICAgcmV0dXJuIGAke3pvYnJpc3RIYXNoZXIuaGFzaChib2FyZCl9OiR7Y3VycmVudFBsYXllcn1gOwp9OwoKLy8g6LWw5a2Q5ZCO55qE5a2Q6IqC54K55bGA6Z2i5ZOI5biM77yI5LuF5aKe6YeP5qih5byP5pyJ5oSP5LmJ77yb6aG75ZyoIG1ha2Ug5YmN5L+d5a2YIG1vdmluZ1BpZWNl77yJCmNvbnN0IGNoaWxkQm9hcmRIYXNoID0gKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKSA9PiB7CiAgICBpZiAoIVNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUKSByZXR1cm4gYm9hcmRIYXNoOwogICAgcGVyZlN0YXRzLmluY3JlbWVudGFsSGFzaFVwZGF0ZXMrKzsKICAgIHJldHVybiB6b2JyaXN0SGFzaGVyLnVwZGF0ZUhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOwp9OwoKY29uc3QgdmVyaWZ5Qm9hcmRIYXNoID0gKGJvYXJkLCBleHBlY3RlZEhhc2gpID0+IHsKICAgIGlmICghU0VBUkNIX1pPQlJJU1RfVkVSSUZZKSByZXR1cm47CiAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOwogICAgY29uc3QgZnVsbCA9IHpvYnJpc3RIYXNoZXIuaGFzaChib2FyZCk7CiAgICBpZiAoZnVsbCAhPT0gZXhwZWN0ZWRIYXNoKSB7CiAgICAgICAgcGVyZlN0YXRzLmhhc2hNaXNtYXRjaGVzKys7CiAgICB9Cn07CgovLyDmkJzntKLnlKjlh4DliIbvvJrlrozmlbTlvaLlir/or4TkvLDvvIjlhbPns7sv5aiB6IOBL+WuieWFqC/mnLrliqjvvInvvIzku4Xot7Pov4fnu4jlsYDnnYDms5XmnprkuL7vvJvluKYgWm9icmlzdCDnvJPlrZgKY29uc3Qgc3RhdGljU2VhcmNoRXZhbCA9IChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGJvYXJkSGFzaCA9IDApID0+IHsKICAgIGxldCBjYWNoZUtleTsKICAgIGlmIChTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCkgewogICAgICAgIGNhY2hlS2V5ID0gem9icmlzdEhhc2hlci5ldmFsQ2FjaGVLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsKICAgIH0gZWxzZSB7CiAgICAgICAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsKICAgICAgICBjYWNoZUtleSA9IHpvYnJpc3RIYXNoZXIuZXZhbENhY2hlS2V5KGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSk7CiAgICB9CiAgICBpZiAoZXZhbENhY2hlLmhhcyhjYWNoZUtleSkpIHsKICAgICAgICByZXR1cm4gZXZhbENhY2hlLmdldChjYWNoZUtleSk7CiAgICB9CiAgICBjb25zdCBldmFsUmVzdWx0ID0gZXZhbHVhdGVCb2FyZChib2FyZCwgZmFsc2UsIHNlYXJjaEluaXRpYXRvciwgMCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHsgZm9yU2VhcmNoTGVhZjogdHJ1ZSB9KTsKICAgIGNvbnN0IG9wcG9uZW50ID0gc2VhcmNoSW5pdGlhdG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgIGNvbnN0IG5ldCA9IGV2YWxSZXN1bHRbc2VhcmNoSW5pdGlhdG9yXS50b3RhbCAtIGV2YWxSZXN1bHRbb3Bwb25lbnRdLnRvdGFsOwogICAgaWYgKGV2YWxDYWNoZS5zaXplID49IEVWQUxfQ0FDSEVfTUFYKSB7CiAgICAgICAgLy8g566A5Y2V5reY5rGw5pyA5pep5YaZ5YWl55qE5LiA5om577yM6YG/5YWNIE1hcCDml6DpmZDmtqgKICAgICAgICBsZXQgZHJvcCA9IDA7CiAgICAgICAgZm9yIChjb25zdCBrIG9mIGV2YWxDYWNoZS5rZXlzKCkpIHsKICAgICAgICAgICAgZXZhbENhY2hlLmRlbGV0ZShrKTsKICAgICAgICAgICAgaWYgKCsrZHJvcCA+PSA0MDk2KSBicmVhazsKICAgICAgICB9CiAgICB9CiAgICBldmFsQ2FjaGUuc2V0KGNhY2hlS2V5LCBuZXQpOwogICAgcmV0dXJuIG5ldDsKfTsKCi8vIOeUn+aIkOW9k+WJjeaWueWQg+WtkOedgO+8iOS+m+mdmem7mOaQnOe0ou+8iQpjb25zdCBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoID0gKGJvYXJkLCBjdXJyZW50UGxheWVyKSA9PiB7CiAgICBjb25zdCBjYXB0dXJlcyA9IFtdOwogICAgY29uc3QgZGVmZXIgPSBTRUFSQ0hfREVGRVJfTEVHQUxJVFk7CiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgewogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgIGlmICghcGllY2UgfHwgcGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIGNvbnRpbnVlOwogICAgICAgICAgICBjb25zdCBwc2V1ZG8gPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCB7IHIsIGMgfSwgcGllY2UpOwogICAgICAgICAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgKz0gcHNldWRvLmxlbmd0aDsKICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IHBzZXVkbyA6IGZpbHRlckxlZ2FsTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSwgcHNldWRvKTsKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB1c2VNb3Zlcy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tpXTsKICAgICAgICAgICAgICAgIGlmIChib2FyZFt0by5yXVt0by5jXSkgewogICAgICAgICAgICAgICAgICAgIGNhcHR1cmVzLnB1c2goeyBmcm9tOiB7IHIsIGMgfSwgdG8gfSk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CiAgICByZXR1cm4gY2FwdHVyZXM7Cn07CgovLyDpnZnpu5jmkJzntKLvvJpzdGFuZC1wYXQg55So5a6M5pW05b2i5Yq/6K+E5Lyw77yb5LuF5a+55ZCD5a2Q5bu25Ly477yIUVPiiaQz77yJCmNvbnN0IHF1aWVzY2VuY2UgPSAoCiAgICBiLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwKICAgIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBxc0RlcHRoLCBib2FyZEhhc2ggPSAwCikgPT4gewogICAgY29uc3Qgc3RhbmRQYXQgPSBzdGF0aWNTZWFyY2hFdmFsKGIsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBib2FyZEhhc2gpOwoKICAgIGlmIChxc0RlcHRoIDw9IDApIHsKICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsKICAgIH0KCiAgICBpZiAobWF4aW1pemluZykgewogICAgICAgIGlmIChzdGFuZFBhdCA+PSBiZXRhKSB7CiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9OwogICAgICAgIH0KICAgICAgICBpZiAoc3RhbmRQYXQgPiBhbHBoYSkgewogICAgICAgICAgICBhbHBoYSA9IHN0YW5kUGF0OwogICAgICAgIH0KICAgIH0gZWxzZSB7CiAgICAgICAgaWYgKHN0YW5kUGF0IDw9IGFscGhhKSB7CiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9OwogICAgICAgIH0KICAgICAgICBpZiAoc3RhbmRQYXQgPCBiZXRhKSB7CiAgICAgICAgICAgIGJldGEgPSBzdGFuZFBhdDsKICAgICAgICB9CiAgICB9CgogICAgbGV0IGNhcHR1cmVzID0gZ2VuZXJhdGVDYXB0dXJlc0ZvclNlYXJjaChiLCBjdXJyZW50UGxheWVyKTsKICAgIGlmIChjYXB0dXJlcy5sZW5ndGggPT09IDApIHsKICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsKICAgIH0KCiAgICAvLyBNVlYtTFZB77ya5YWI6K+V5ZCD5aSn5a2QCiAgICBjYXB0dXJlcy5zb3J0KChhLCBiTW92ZSkgPT4gewogICAgICAgIGNvbnN0IHNjb3JlQSA9CiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYlthLnRvLnJdW2EudG8uY10sIGdhbWVTdGFnZSkgKiAxNiAtCiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYlthLmZyb20ucl1bYS5mcm9tLmNdLCBnYW1lU3RhZ2UpOwogICAgICAgIGNvbnN0IHNjb3JlQiA9CiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYltiTW92ZS50by5yXVtiTW92ZS50by5jXSwgZ2FtZVN0YWdlKSAqIDE2IC0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW2JNb3ZlLmZyb20ucl1bYk1vdmUuZnJvbS5jXSwgZ2FtZVN0YWdlKTsKICAgICAgICByZXR1cm4gc2NvcmVCIC0gc2NvcmVBOwogICAgfSk7CgogICAgbGV0IGJlc3RFdmFsID0gc3RhbmRQYXQ7CiAgICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOwogICAgY29uc3QgZGVmZXIgPSBTRUFSQ0hfREVGRVJfTEVHQUxJVFk7CgogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjYXB0dXJlcy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IG1vdmUgPSBjYXB0dXJlc1tpXTsKICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXTsKICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VNb3ZlKGIsIG1vdmUuZnJvbSwgbW92ZS50byk7CiAgICAgICAgaWYgKGRlZmVyICYmIGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllcikpIHsKICAgICAgICAgICAgdW5tYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8sIGNhcHR1cmVkKTsKICAgICAgICAgICAgcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQrKzsKICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgfQogICAgICAgIGNvbnN0IG5leHRIYXNoID0gY2hpbGRCb2FyZEhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOwogICAgICAgIHZlcmlmeUJvYXJkSGFzaChiLCBuZXh0SGFzaCk7CiAgICAgICAgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCsrOwogICAgICAgIGNvbnN0IG5leHRQbGF5ZXIgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgICAgICBjb25zdCBuZXh0TWF4aW1pemluZyA9IG5leHRQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsKICAgICAgICBjb25zdCByZXN1bHQgPSBxdWllc2NlbmNlKAogICAgICAgICAgICBiLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsCiAgICAgICAgICAgIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBxc0RlcHRoIC0gMSwgbmV4dEhhc2gKICAgICAgICApOwogICAgICAgIHVubWFrZU1vdmUoYiwgbW92ZS5mcm9tLCBtb3ZlLnRvLCBjYXB0dXJlZCk7CgogICAgICAgIGlmIChtYXhpbWl6aW5nKSB7CiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPiBiZXN0RXZhbCkgewogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7CiAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmUsIC4uLihyZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV07CiAgICAgICAgICAgIH0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGFscGhhKSB7CiAgICAgICAgICAgICAgICBhbHBoYSA9IHJlc3VsdC52YWx1ZTsKICAgICAgICAgICAgfQogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPCBiZXN0RXZhbCkgewogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7CiAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmUsIC4uLihyZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV07CiAgICAgICAgICAgIH0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA8IGJldGEpIHsKICAgICAgICAgICAgICAgIGJldGEgPSByZXN1bHQudmFsdWU7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIHsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgfQoKICAgIHJldHVybiB7IHZhbHVlOiBiZXN0RXZhbCwgbW92ZVNlcXVlbmNlOiBiZXN0TW92ZVNlcXVlbmNlIH07Cn07CgovLyBhbHBoYUJldGHvvJror4TkvLDlp4vnu4jku44gc2VhcmNoSW5pdGlhdG9yIOinkuW6pu+8m1RUICsga2lsbGVyL2hpc3RvcnkgKyDnqbrnnYDliarmnp0gKyBMTVIgKyBRUwovLyBib2FyZEhhc2jvvJrlop7ph48gWm9icmlzdCDlsYDpnaLlk4jluIzvvIjkuI3lkKvooYzmo4vmlrnvvInvvJvml6fmqKHlvI/kuIvlj6/kvKAgMApjb25zdCBhbHBoYUJldGEgPSAoCiAgICBiLCBkLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwKICAgIHNlYXJjaERlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gY3VycmVudFBsYXllciwgZ2FtZVN0YWdlID0gJ21pZCcsCiAgICBhbGxvd051bGwgPSB0cnVlLCBib2FyZEhhc2ggPSAwCikgPT4gewogICAgY29uc3Qgb3JpZ2luYWxBbHBoYSA9IGFscGhhOwogICAgY29uc3Qgb3JpZ2luYWxCZXRhID0gYmV0YTsKCiAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMrKzsKICAgIGlmICghcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0pIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdID0gMDsKICAgIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKys7CgogICAgLy8g5Y+26IqC54K577ya5a6M5pW05b2i5Yq/6K+E5LywICsg5ZCD5a2Q6Z2Z6buY5pCc57Si77yIUVPiiaQz77yJCiAgICBpZiAoZCA9PT0gMCkgewogICAgICAgIHJldHVybiBxdWllc2NlbmNlKAogICAgICAgICAgICBiLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwKICAgICAgICAgICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIDMsIGJvYXJkSGFzaAogICAgICAgICk7CiAgICB9CgogICAgLy8g572u5o2i6KGo5o6i5rWL77yIa2V5IOWQq+ihjOaji+aWue+8jOmBv+WFjeWQjOW9ouS4jeWQjOi1sOaWueWGsueqge+8iQogICAgY29uc3QgdHRLZXkgPSBtYWtlU2VhcmNoVFRLZXkoYiwgY3VycmVudFBsYXllciwgYm9hcmRIYXNoKTsKICAgIGNvbnN0IHR0RW50cnkgPSB0cmFuc3Bvc2l0aW9uVGFibGUucmV0cmlldmUodHRLZXkpOwogICAgbGV0IHR0TW92ZSA9IG51bGw7CiAgICBpZiAodHRFbnRyeSkgewogICAgICAgIHR0TW92ZSA9IHR0RW50cnkuYmVzdE1vdmUgfHwgbnVsbDsKICAgICAgICBpZiAodHRFbnRyeS5kZXB0aCA+PSBkKSB7CiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICdleGFjdCcpIHsKICAgICAgICAgICAgICAgIHJldHVybiB7CiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHR0RW50cnkudmFsdWUsCiAgICAgICAgICAgICAgICAgICAgbW92ZVNlcXVlbmNlOiB0dEVudHJ5Lm1vdmVTZXF1ZW5jZSB8fCAodHRNb3ZlID8gW3R0TW92ZV0gOiBbXSkKICAgICAgICAgICAgICAgIH07CiAgICAgICAgICAgIH0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ2xvd2VyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPj0gYmV0YSkgewogICAgICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHR0RW50cnkudmFsdWUsIG1vdmVTZXF1ZW5jZTogW10gfTsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAndXBwZXJib3VuZCcgJiYgdHRFbnRyeS52YWx1ZSA8PSBhbHBoYSkgewogICAgICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHR0RW50cnkudmFsdWUsIG1vdmVTZXF1ZW5jZTogW10gfTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KCiAgICBjb25zdCBzZWFyY2hJbmZvID0gcHJlcGFyZVNlYXJjaEluZm8oYiwgY3VycmVudFBsYXllciwgZ2FtZVN0YWdlLCBzZWFyY2hJbml0aWF0b3IsIGQpOwogICAgY29uc3QgYWJQaWVjZXNJbmZvID0gc2VhcmNoSW5mby5waWVjZXNJbmZvOwogICAgY29uc3QgYWJCb2FyZEluZm8gPSBzZWFyY2hJbmZvLmJvYXJkSW5mbzsKICAgIGNvbnN0IGN1cnJlbnRQbGF5ZXJDb2xvciA9IGN1cnJlbnRQbGF5ZXI7CiAgICBjb25zdCBpbkNoZWNrID0gc2VhcmNoSW5mby5pbkNoZWNrIHx8CiAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ3JlZCcgJiYgYWJCb2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fAogICAgICAgICAgICAgICAgICAgIChjdXJyZW50UGxheWVyQ29sb3IgPT09ICdibGFjaycgJiYgYWJCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOwoKICAgIGNvbnN0IHRlcm1pbmFsU2NvcmUgPSAobWF0ZUluQ2hlY2spID0+IHsKICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGN1cnJlbnRQbGF5ZXJDb2xvciAhPT0gc2VhcmNoSW5pdGlhdG9yOwogICAgICAgIGNvbnN0IGJhc2VTY29yZSA9IGlzSW5pdGlhdG9yV2lubmVyID8gMTAwMDAwIDogLTEwMDAwMDsKICAgICAgICByZXR1cm4gewogICAgICAgICAgICB2YWx1ZTogYmFzZVNjb3JlICsgKGlzSW5pdGlhdG9yV2lubmVyID8gZCA6IChzZWFyY2hEZXB0aCAtIGQpKSwKICAgICAgICAgICAgbW92ZVNlcXVlbmNlOiBbXSwKICAgICAgICAgICAgdGVybWluYWw6IG1hdGVJbkNoZWNrID8gJ2NoZWNrbWF0ZScgOiAnc3RhbGVtYXRlJwogICAgICAgIH07CiAgICB9OwoKICAgIC8vIOaXoOS8quWQiOazleedgO+8muebtOaOpee7iOWxgO+8iOaegeWwkeinge+8m+mAmuW4uOiHs+WwkeacieWwhueahOi1sOWKqO+8iQogICAgaWYgKCFzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3QgfHwgc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0Lmxlbmd0aCA9PT0gMCkgewogICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGFiQm9hcmRJbmZvLmdhbWVTdGF0ZTsKICAgICAgICBpZiAoZ2FtZVN0YXRlICYmIChnYW1lU3RhdGUuc3RhdHVzID09PSAnY2hlY2ttYXRlJyB8fCBnYW1lU3RhdGUuc3RhdHVzID09PSAnc3RhbGVtYXRlJykpIHsKICAgICAgICAgICAgY29uc3QgaXNJbml0aWF0b3JXaW5uZXIgPSBnYW1lU3RhdGUud2lubmVyID09PSBzZWFyY2hJbml0aWF0b3I7CiAgICAgICAgICAgIGNvbnN0IGJhc2VTY29yZSA9IGlzSW5pdGlhdG9yV2lubmVyID8gMTAwMDAwIDogLTEwMDAwMDsKICAgICAgICAgICAgY29uc3Qgc3RlcHNGcm9tUm9vdCA9IHNlYXJjaERlcHRoIC0gZDsKICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IGJhc2VTY29yZSArIChpc0luaXRpYXRvcldpbm5lciA/IGQgOiBzdGVwc0Zyb21Sb290KSwgbW92ZVNlcXVlbmNlOiBbXSB9OwogICAgICAgIH0KICAgICAgICByZXR1cm4gdGVybWluYWxTY29yZShpbkNoZWNrKTsKICAgIH0KCiAgICAvLyDnqbrnnYDliarmnp3vvJrku4UgbWF4aW1pemluZ++8m+WujOaVtOivhOS8sOS4i+S/neWuiOWQr+eUqAogICAgaWYgKAogICAgICAgIFNFQVJDSF9FTkFCTEVfTk1QICYmCiAgICAgICAgYWxsb3dOdWxsICYmCiAgICAgICAgbWF4aW1pemluZyAmJgogICAgICAgIGQgPj0gMyAmJgogICAgICAgICFpbkNoZWNrICYmCiAgICAgICAgY2FuRG9OdWxsTW92ZShiLCBjdXJyZW50UGxheWVyQ29sb3IpCiAgICApIHsKICAgICAgICBjb25zdCBudWxsUiA9IGQgPj0gNiA/IDMgOiAyOwogICAgICAgIGNvbnN0IG51bGxEZXB0aCA9IGQgLSAxIC0gbnVsbFI7CiAgICAgICAgaWYgKG51bGxEZXB0aCA+PSAwKSB7CiAgICAgICAgICAgIGNvbnN0IG51bGxQbGF5ZXIgPSBjdXJyZW50UGxheWVyQ29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgICAgICBjb25zdCBudWxsTWF4aW1pemluZyA9IG51bGxQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsKICAgICAgICAgICAgLy8g56m6552A5LiN5pS55Y+Y5bGA6Z2i5ZOI5biM77yM5LuF6KGM5qOL5pa55Y+Y5YyW77yIVFQga2V5IOWQqyBzaWRl77yJCiAgICAgICAgICAgIGNvbnN0IG51bGxSZXN1bHQgPSBhbHBoYUJldGEoCiAgICAgICAgICAgICAgICBiLCBudWxsRGVwdGgsIGJldGEgLSAxZS02LCBiZXRhLCBudWxsTWF4aW1pemluZywgbnVsbFBsYXllciwKICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgZmFsc2UsIGJvYXJkSGFzaAogICAgICAgICAgICApOwogICAgICAgICAgICBpZiAobnVsbFJlc3VsdC52YWx1ZSA+PSBiZXRhKSB7CiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogbnVsbFJlc3VsdC52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9OwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIGxldCBtb3ZlcyA9IHNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdDsKCiAgICBpZiAoIXBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSkgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdID0gMDsKICAgIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSArPSBtb3Zlcy5sZW5ndGg7CgogICAgY29uc3Qga2lsbGVyc0F0RGVwdGggPSAoa2lsbGVyTW92ZXNbZF0gfHwgW251bGwsIG51bGxdKTsKICAgIG1vdmVzID0gc29ydE1vdmVzKG1vdmVzLCBiLCBjdXJyZW50UGxheWVyQ29sb3IsIGFiUGllY2VzSW5mbywgZ2FtZVN0YWdlLCBhYkJvYXJkSW5mbywgewogICAgICAgIHR0TW92ZSwKICAgICAgICBraWxsZXJzOiBraWxsZXJzQXREZXB0aAogICAgfSk7CgogICAgY29uc3Qgc3RvcmVUVCA9ICh2YWx1ZSwgYmVzdE1vdmUsIG1vdmVTZXF1ZW5jZSkgPT4gewogICAgICAgIGxldCBmbGFnOwogICAgICAgIGlmICh2YWx1ZSA8PSBvcmlnaW5hbEFscGhhKSBmbGFnID0gJ3VwcGVyYm91bmQnOwogICAgICAgIGVsc2UgaWYgKHZhbHVlID49IG9yaWdpbmFsQmV0YSkgZmxhZyA9ICdsb3dlcmJvdW5kJzsKICAgICAgICBlbHNlIGZsYWcgPSAnZXhhY3QnOwogICAgICAgIHRyYW5zcG9zaXRpb25UYWJsZS5zdG9yZSh0dEtleSwgZCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlLCBtb3ZlU2VxdWVuY2UpOwogICAgfTsKCiAgICBsZXQgYmVzdEV2YWwgPSBtYXhpbWl6aW5nID8gLUluZmluaXR5IDogSW5maW5pdHk7CiAgICBsZXQgYmVzdE1vdmUgPSBudWxsOwogICAgbGV0IGJlc3RNb3ZlU2VxdWVuY2UgPSBbXTsKICAgIGxldCBsZWdhbE1vdmVzRm91bmQgPSAwOwoKICAgIGZvciAobGV0IG1vdmVJbmRleCA9IDA7IG1vdmVJbmRleCA8IG1vdmVzLmxlbmd0aDsgbW92ZUluZGV4KyspIHsKICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbbW92ZUluZGV4XTsKICAgICAgICBjb25zdCBpc0NhcHR1cmUgPSAhIWJbbW92ZS50by5yXVttb3ZlLnRvLmNdOwogICAgICAgIGNvbnN0IGlzVFRNb3ZlID0gdHRNb3ZlICYmIGlzU2FtZU1vdmUobW92ZSwgdHRNb3ZlKTsKICAgICAgICBjb25zdCBpc0tpbGxlciA9CiAgICAgICAgICAgIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc0F0RGVwdGhbMF0pIHx8CiAgICAgICAgICAgIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc0F0RGVwdGhbMV0pOwoKICAgICAgICAvLyBMTVLvvJrpnaDlkI7nmoTlronpnZnnnYDms5XpmY3mt7EgMe+8iOWujOaVtOivhOS8sOS4i+S/neWuiO+8iQogICAgICAgIC8vIG1vdmVJbmRleCDlkKvkvKrlkIjms5Xluo/vvJvpnZ7ms5XnnYDot7Pov4flkI7nlaXlgY/kv53lrojvvIjlsJHpmY3mt7HvvInvvIzkuI3lvbHlk43mraPnoa7mgKcKICAgICAgICBsZXQgcmVkdWN0aW9uID0gMDsKICAgICAgICBpZiAoCiAgICAgICAgICAgIFNFQVJDSF9FTkFCTEVfTE1SICYmCiAgICAgICAgICAgIGQgPj0gNCAmJgogICAgICAgICAgICBtb3ZlSW5kZXggPj0gNCAmJgogICAgICAgICAgICAhaW5DaGVjayAmJgogICAgICAgICAgICAhaXNDYXB0dXJlICYmCiAgICAgICAgICAgICFpc1RUTW92ZSAmJgogICAgICAgICAgICAhaXNLaWxsZXIKICAgICAgICApIHsKICAgICAgICAgICAgcmVkdWN0aW9uID0gMTsKICAgICAgICB9CgogICAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYlttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOwogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZU1vdmUoYiwgbW92ZS5mcm9tLCBtb3ZlLnRvKTsKICAgICAgICBpZiAoU0VBUkNIX0RFRkVSX0xFR0FMSVRZICYmIGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllckNvbG9yKSkgewogICAgICAgICAgICB1bm1ha2VNb3ZlKGIsIG1vdmUuZnJvbSwgbW92ZS50bywgY2FwdHVyZWQpOwogICAgICAgICAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCsrOwogICAgICAgICAgICBjb250aW51ZTsKICAgICAgICB9CiAgICAgICAgY29uc3QgbmV4dEhhc2ggPSBjaGlsZEJvYXJkSGFzaChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7CiAgICAgICAgdmVyaWZ5Qm9hcmRIYXNoKGIsIG5leHRIYXNoKTsKICAgICAgICBsZWdhbE1vdmVzRm91bmQrKzsKICAgICAgICBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkKys7CgogICAgICAgIGNvbnN0IG5leHRQbGF5ZXIgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgICAgICBjb25zdCBuZXh0TWF4aW1pemluZyA9IG5leHRQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsKCiAgICAgICAgbGV0IHJlc3VsdDsKICAgICAgICBpZiAocmVkdWN0aW9uID4gMCkgewogICAgICAgICAgICBjb25zdCByZWR1Y2VkRGVwdGggPSBNYXRoLm1heCgwLCBkIC0gMSAtIHJlZHVjdGlvbik7CiAgICAgICAgICAgIHJlc3VsdCA9IGFscGhhQmV0YSgKICAgICAgICAgICAgICAgIGIsIHJlZHVjZWREZXB0aCwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLAogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaAogICAgICAgICAgICApOwogICAgICAgICAgICBjb25zdCBuZWVkUmVzZWFyY2ggPSBtYXhpbWl6aW5nCiAgICAgICAgICAgICAgICA/IHJlc3VsdC52YWx1ZSA+IGFscGhhCiAgICAgICAgICAgICAgICA6IHJlc3VsdC52YWx1ZSA8IGJldGE7CiAgICAgICAgICAgIGlmIChuZWVkUmVzZWFyY2gpIHsKICAgICAgICAgICAgICAgIHJlc3VsdCA9IGFscGhhQmV0YSgKICAgICAgICAgICAgICAgICAgICBiLCBkIC0gMSwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLAogICAgICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgdHJ1ZSwgbmV4dEhhc2gKICAgICAgICAgICAgICAgICk7CiAgICAgICAgICAgIH0KICAgICAgICB9IGVsc2UgewogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoCiAgICAgICAgICAgICAgICBiLCBkIC0gMSwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLAogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaAogICAgICAgICAgICApOwogICAgICAgIH0KCiAgICAgICAgdW5tYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8sIGNhcHR1cmVkKTsKCiAgICAgICAgaWYgKG1heGltaXppbmcpIHsKICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7CiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsKICAgICAgICAgICAgICAgIGJlc3RNb3ZlID0gbW92ZTsKICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07CiAgICAgICAgICAgIH0KICAgICAgICAgICAgYWxwaGEgPSBNYXRoLm1heChhbHBoYSwgcmVzdWx0LnZhbHVlKTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmVzdEV2YWwpIHsKICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOwogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOwogICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlLCAuLi5yZXN1bHQubW92ZVNlcXVlbmNlXTsKICAgICAgICAgICAgfQogICAgICAgICAgICBiZXRhID0gTWF0aC5taW4oYmV0YSwgcmVzdWx0LnZhbHVlKTsKICAgICAgICB9CgogICAgICAgIGlmIChiZXRhIDw9IGFscGhhKSB7CiAgICAgICAgICAgIGlmICghcGVyZlN0YXRzLmN1dG9mZnNbZF0pIHBlcmZTdGF0cy5jdXRvZmZzW2RdID0gMDsKICAgICAgICAgICAgcGVyZlN0YXRzLmN1dG9mZnNbZF0rKzsKICAgICAgICAgICAgaWYgKCFpc0NhcHR1cmUpIHsKICAgICAgICAgICAgICAgIHN0b3JlS2lsbGVyTW92ZShkLCBtb3ZlKTsKICAgICAgICAgICAgICAgIGFkZEhpc3RvcnlTY29yZShtb3ZlLCBkKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICB9CgogICAgLy8g5bu26L+f5ZCI5rOV5oCn77ya5Lyq5ZCI5rOV6Z2e56m65L2G5peg5LiA5ZCI5rOVIOKGkiDlsIbmrbsv5Zuw5q+ZCiAgICBpZiAoU0VBUkNIX0RFRkVSX0xFR0FMSVRZICYmIGxlZ2FsTW92ZXNGb3VuZCA9PT0gMCkgewogICAgICAgIHJldHVybiB0ZXJtaW5hbFNjb3JlKGluQ2hlY2spOwogICAgfQoKICAgIHN0b3JlVFQoYmVzdEV2YWwsIGJlc3RNb3ZlLCBiZXN0TW92ZVNlcXVlbmNlKTsKICAgIHJldHVybiB7IHZhbHVlOiBiZXN0RXZhbCwgbW92ZVNlcXVlbmNlOiBiZXN0TW92ZVNlcXVlbmNlIH07Cn07CgovLyBleGFjdFJvb3RTY29yZXM6IHRydWU9QW5hbHlzaXMg5YWo5qC557K+56Gu5YiG77ybZmFsc2U95a+55byI5qCH5YeGIFBWU++8iGZhaWwtbG93IOS4jeWbnuaQnO+8iQpjb25zdCBnZXRCZXN0TW92ZSA9IChib2FyZCwgdHVybiwgZGVwdGggPSA2LCByYW5kb21uZXNzID0gMCwgcGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0ID0gZmFsc2UsIGV4YWN0Um9vdFNjb3JlcyA9IGZhbHNlKSA9PiB7CiAgY29uc3QgdGltZUxpbWl0ID0gNTAwMDsKCiAgLy8gRmlyc3QgdHJ5IHRvIGdldCBtb3ZlIGZyb20gb3BlbmluZyBib29rCiAgY29uc3QgYm9va01vdmUgPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShib2FyZCwgcGx5KTsKICAKICBpZiAoYm9va01vdmUpIHsKICAgIC8vIENoZWNrIGlmIGJvb2tNb3ZlIGlzIHZhbGlkIGZvciBjdXJyZW50IGJvYXJkCiAgICBpZiAoYm9va01vdmUuZnJvbSAmJiBib29rTW92ZS50byAmJiAKICAgICAgICB0eXBlb2YgYm9va01vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUuZnJvbS5jID09PSAnbnVtYmVyJyAmJgogICAgICAgIHR5cGVvZiBib29rTW92ZS50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUudG8uYyA9PT0gJ251bWJlcicpIHsKICAgICAgCiAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYm9hcmRbYm9va01vdmUuZnJvbS5yXVtib29rTW92ZS5mcm9tLmNdOwogICAgICAKICAgICAgaWYgKG1vdmluZ1BpZWNlICYmIG1vdmluZ1BpZWNlLmNvbG9yID09PSB0dXJuKSB7CiAgICAgICAgLy8gVmVyaWZ5IG1vdmUgaXMgdmFsaWQKICAgICAgICBjb25zdCB2YWxpZERlc3RpbmF0aW9ucyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIGJvb2tNb3ZlLmZyb20pOwogICAgICAgIGNvbnN0IGlzVmFsaWQgPSB2YWxpZERlc3RpbmF0aW9ucy5zb21lKGRlc3QgPT4gZGVzdC5yID09PSBib29rTW92ZS50by5yICYmIGRlc3QuYyA9PT0gYm9va01vdmUudG8uYyk7CiAgICAgICAgCiAgICAgICAgaWYgKGlzVmFsaWQpIHsKICAgICAgICAgIHJldHVybiB7IGJlc3RNb3ZlOiBib29rTW92ZSwgc2Vjb25kQmVzdE1vdmU6IG51bGwsIG1vdmVTZXF1ZW5jZTogW10sIHNlY29uZE1vdmVTZXF1ZW5jZTogW10sIGJlc3RNb3ZlU2NvcmU6IDAsIHNlY29uZEJlc3RNb3ZlU2NvcmU6IDAsIGFsbE1vdmVzV2l0aFNjb3JlczogW10gfTsKICAgICAgICB9CiAgICAgIH0KICAgIH0KICB9CgogIC8vIOagueiKgueCue+8mui/reS7o+WKoOa3sSArIFBWU++8m1RUL2tpbGxlci9oaXN0b3J5IOi3qOa3seW6puS/neeVme+8iOS7heW8gOWxgOa4heepuuS4gOasoe+8iQogIHJlc2V0UGVyZlN0YXRzKCk7CiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTsKICB0cmFuc3Bvc2l0aW9uVGFibGUucmVzZXRTdGF0cygpOwogIHRyYW5zcG9zaXRpb25UYWJsZS5jbGVhcigpOwogIGNsZWFyRXZhbENhY2hlKCk7CiAgY29uc3QgbWF4RGVwdGggPSBNYXRoLm1heCgxLCBkZXB0aCB8IDApOwogIHJlc2V0U2VhcmNoSGV1cmlzdGljcyhtYXhEZXB0aCk7CiAgc3luY0dlbmVyYWxQb3NDYWNoZShib2FyZCk7CgogIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKGJvYXJkKTsKICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsKCiAgY29uc3Qgcm9vdEV2YWxSZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGJvYXJkLCBmYWxzZSwgdHVybiwgMCwgdHVybiwgZ2FtZVN0YWdlKTsKICBjb25zdCByb290UGllY2VzSW5mbyA9IHJvb3RFdmFsUmVzdWx0LnBpZWNlc0luZm87CiAgY29uc3Qgcm9vdEJvYXJkSW5mbyA9IHJvb3RFdmFsUmVzdWx0LmJvYXJkSW5mbzsKCiAgLy8g5pS26ZuG5qC56IqC54K56LWw5rOV77yI5Y+q5YGa5LiA5qyh77yJ77yb5pyq6KKr5bCG5pe26L+H5ruk6YCB5ZCDCiAgbGV0IHJvb3RNb3ZlcyA9IFtdOwogIGNvbnN0IHJvb3RJbkNoZWNrID0gKHR1cm4gPT09ICdyZWQnICYmIHJvb3RCb2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fAogICAgICAgICAgICAgICAgICAgICAgKHR1cm4gPT09ICdibGFjaycgJiYgcm9vdEJvYXJkSW5mby5ibGFja0lzSW5DaGVjayk7CgogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7CiAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICBpZiAoYm9hcmRbcl1bY10/LmNvbG9yID09PSB0dXJuKSB7CiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsKICAgICAgICBjb25zdCB2YWxpZERlc3RpbmF0aW9ucyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIHsgciwgYyB9KTsKICAgICAgICB2YWxpZERlc3RpbmF0aW9ucy5mb3JFYWNoKHRvID0+IHsKICAgICAgICAgIGNvbnN0IGlzQWNjZXB0YWJsZSA9IHJvb3RJbkNoZWNrIHx8IGlzUG9zaXRpb25BY2NlcHRhYmxlKGJvYXJkLCB7IHIsIGMgfSwgdG8sIHR1cm4sIHJvb3RCb2FyZEluZm8sIHJvb3RQaWVjZXNJbmZvLCBwaWVjZSwgZ2FtZVN0YWdlKTsKICAgICAgICAgIGlmIChpc0FjY2VwdGFibGUpIHsKICAgICAgICAgICAgcm9vdE1vdmVzLnB1c2goeyBmcm9tOiB7IHIsIGMgfSwgdG8sIHNjb3JlOiAwLCBtb3ZlU2VxdWVuY2U6IFtdIH0pOwogICAgICAgICAgfQogICAgICAgIH0pOwogICAgICB9CiAgICB9CiAgfQoKICBpZiAocm9vdE1vdmVzLmxlbmd0aCA9PT0gMCkgewogICAgcmV0dXJuIHsKICAgICAgYmVzdE1vdmU6IG51bGwsCiAgICAgIHNlY29uZEJlc3RNb3ZlOiBudWxsLAogICAgICBtb3ZlU2VxdWVuY2U6IFtdLAogICAgICBzZWNvbmRNb3ZlU2VxdWVuY2U6IFtdLAogICAgICBiZXN0TW92ZVNjb3JlOiAwLAogICAgICBzZWNvbmRCZXN0TW92ZVNjb3JlOiAwLAogICAgICBhbGxNb3Zlc1dpdGhTY29yZXM6IFtdCiAgICB9OwogIH0KCiAgY29uc3Qgc29ydFJvb3RNb3Zlc0J5U2NvcmUgPSAobW92ZXMpID0+IHsKICAgIG1vdmVzLnNvcnQoKGEsIGIpID0+IHsKICAgICAgY29uc3Qgc2NvcmVEaWZmID0gYi5zY29yZSAtIGEuc2NvcmU7CiAgICAgIGlmIChNYXRoLmFicyhzY29yZURpZmYpIDwgMWUtNikgewogICAgICAgIGlmIChhLnNjb3JlID4gMCkgewogICAgICAgICAgcmV0dXJuIChhLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApIC0gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCk7CiAgICAgICAgfQogICAgICAgIGlmIChhLnNjb3JlIDwgMCkgewogICAgICAgICAgcmV0dXJuIChiLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApIC0gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCk7CiAgICAgICAgfQogICAgICAgIHJldHVybiAwOwogICAgICB9CiAgICAgIHJldHVybiBzY29yZURpZmY7CiAgICB9KTsKICB9OwoKICBjb25zdCBwcm9tb3RlUm9vdE1vdmUgPSAobW92ZXMsIHByZWZlcnJlZCkgPT4gewogICAgaWYgKCFwcmVmZXJyZWQpIHJldHVybjsKICAgIGNvbnN0IGlkeCA9IG1vdmVzLmZpbmRJbmRleCgobSkgPT4gaXNTYW1lTW92ZShtLCBwcmVmZXJyZWQpKTsKICAgIGlmIChpZHggPiAwKSB7CiAgICAgIGNvbnN0IFtoaXRdID0gbW92ZXMuc3BsaWNlKGlkeCwgMSk7CiAgICAgIG1vdmVzLnVuc2hpZnQoaGl0KTsKICAgIH0KICB9OwoKICBjb25zdCB3b3JrQm9hcmQgPSBib2FyZC5tYXAoKHJvdykgPT4gWy4uLnJvd10pOwogIGNvbnN0IE5VTExfV0lORE9XX0VQUyA9IDFlLTY7CiAgY29uc3QgbmV4dFR1cm4gPSB0dXJuID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAvLyDmoLnlsYDpnaLlk4jluIzlj6rnrpfkuIDmrKHvvJvlop7ph4/mqKHlvI/mlbTmo7XmkJzntKLmoJHnlLHmraTmtL7nlJ8KICBjb25zdCByb290SGFzaCA9IHpvYnJpc3RIYXNoZXIuaGFzaChib2FyZCk7CiAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsKICBjb25zdCByb290VFRLZXkgPSBTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVAogICAgPyB6b2JyaXN0SGFzaGVyLnR0S2V5RnJvbUhhc2gocm9vdEhhc2gsIHR1cm4pCiAgICA6IGAke3Jvb3RIYXNofToke3R1cm59YDsKCiAgY29uc29sZS5sb2coCiAgICBgU3RhcnRpbmcgaXRlcmF0aXZlIGRlZXBlbmluZyB8IHR1cm46ICR7dHVybn0sIG1heERlcHRoOiAke21heERlcHRofSwgaW5jclpvYnJpc3Q6ICR7U0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1R9LCBsZWFmQXR0YWNrQml0czogJHtTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUU30sIHJlbGF0aW9uTWFza3M6ICR7U0VBUkNIX1JFTEFUSU9OX01BU0tTfSwgdGltZUxpbWl0OiAke3RpbWVMaW1pdH1tcywgZW5hYmxlVGltZUxpbWl0OiAke2VuYWJsZVRpbWVMaW1pdH1gCiAgKTsKCiAgbGV0IGNvbXBsZXRlZERlcHRoID0gMDsKCiAgZm9yIChsZXQgY3VycmVudERlcHRoID0gMTsgY3VycmVudERlcHRoIDw9IG1heERlcHRoOyBjdXJyZW50RGVwdGgrKykgewogICAgaWYgKGVuYWJsZVRpbWVMaW1pdCAmJiBjb21wbGV0ZWREZXB0aCA+IDAgJiYgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA+IHRpbWVMaW1pdCkgewogICAgICBjb25zb2xlLmxvZyhgSUQgc3RvcHBlZCBiZWZvcmUgZGVwdGggJHtjdXJyZW50RGVwdGh9IGR1ZSB0byB0aW1lIGxpbWl0IChsYXN0IGNvbXBsZXRlZD0ke2NvbXBsZXRlZERlcHRofSlgKTsKICAgICAgYnJlYWs7CiAgICB9CgogICAgLy8g5rWF5bGC5pyA5L2z552AICsgVFQg552A5o6S5Yiw5pyA5YmN77yM5L6b5pys5bGCIFBWUyDnrKzkuIDnnYDlhajnqpfkvb/nlKgKICAgIGNvbnN0IHR0RW50cnkgPSB0cmFuc3Bvc2l0aW9uVGFibGUucmV0cmlldmUocm9vdFRUS2V5KTsKICAgIGNvbnN0IHR0TW92ZSA9IHR0RW50cnkgJiYgdHRFbnRyeS5iZXN0TW92ZSA/IHR0RW50cnkuYmVzdE1vdmUgOiBudWxsOwogICAgY29uc3QgcHJldkJlc3QgPSByb290TW92ZXNbMF07CiAgICBzb3J0TW92ZXMocm9vdE1vdmVzLCBib2FyZCwgdHVybiwgcm9vdFBpZWNlc0luZm8sIGdhbWVTdGFnZSwgcm9vdEJvYXJkSW5mbywgewogICAgICB0dE1vdmUsCiAgICAgIGtpbGxlcnM6IGtpbGxlck1vdmVzW01hdGgubWF4KDAsIGN1cnJlbnREZXB0aCAtIDEpXSB8fCBbbnVsbCwgbnVsbF0KICAgIH0pOwogICAgLy8g5LiK5LiA5bGC5pyA5L2z552A5pS+56ys5LiA77yI5pyA5ZCOIHByb21vdGXvvInvvIzkv53or4HmnKzlsYIgUFZTIOmmluedgOWFqOeql+WRveS4reeDrei3r+W+hAogICAgcHJvbW90ZVJvb3RNb3ZlKHJvb3RNb3ZlcywgdHRNb3ZlKTsKICAgIHByb21vdGVSb290TW92ZShyb290TW92ZXMsIHByZXZCZXN0KTsKCiAgICBjb25zdCB1c2VFeGFjdFJvb3QgPSBleGFjdFJvb3RTY29yZXMgJiYgY3VycmVudERlcHRoID09PSBtYXhEZXB0aDsKICAgIGxldCByb290QWxwaGEgPSAtSW5maW5pdHk7CgogICAgZm9yIChsZXQgaSA9IDA7IGkgPCByb290TW92ZXMubGVuZ3RoOyBpKyspIHsKICAgICAgY29uc3QgaXRlbSA9IHJvb3RNb3Zlc1tpXTsKICAgICAgY29uc3QgbW92aW5nUGllY2UgPSB3b3JrQm9hcmRbaXRlbS5mcm9tLnJdW2l0ZW0uZnJvbS5jXTsKICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlTW92ZSh3b3JrQm9hcmQsIGl0ZW0uZnJvbSwgaXRlbS50byk7CiAgICAgIGNvbnN0IGNoaWxkSGFzaCA9IGNoaWxkQm9hcmRIYXNoKHJvb3RIYXNoLCBpdGVtLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOwogICAgICB2ZXJpZnlCb2FyZEhhc2god29ya0JvYXJkLCBjaGlsZEhhc2gpOwoKICAgICAgbGV0IGFscGhhQmV0YVJlc3VsdDsKICAgICAgbGV0IHNjb3JlSXNFeGFjdCA9IHRydWU7CiAgICAgIGlmIChpID09PSAwIHx8IHJvb3RBbHBoYSA9PT0gLUluZmluaXR5KSB7CiAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gYWxwaGFCZXRhKAogICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LAogICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoCiAgICAgICAgKTsKICAgICAgfSBlbHNlIHsKICAgICAgICBjb25zdCBwcm9iZSA9IGFscGhhQmV0YSgKICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwKICAgICAgICAgIHJvb3RBbHBoYSwgcm9vdEFscGhhICsgTlVMTF9XSU5ET1dfRVBTLAogICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoCiAgICAgICAgKTsKICAgICAgICBpZiAocHJvYmUudmFsdWUgPiByb290QWxwaGEpIHsKICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgKICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCByb290QWxwaGEsIEluZmluaXR5LAogICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCB0cnVlLCBjaGlsZEhhc2gKICAgICAgICAgICk7CiAgICAgICAgfSBlbHNlIGlmICh1c2VFeGFjdFJvb3QpIHsKICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgKICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LAogICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCB0cnVlLCBjaGlsZEhhc2gKICAgICAgICAgICk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgIC8vIGZhaWwtbG9377ya5o6i5rWL5YiG5Y+q5piv5LiK55WM77yM5LiN6IO95b2T57K+56Gu5YiG5YaZ5YWl77yI5ZCm5YiZIElEIOS4i+WxguaOkuW6j+iiq+axoeafk++8jOaYk+WPjeWkjei1sOeCru+8iQogICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gcHJvYmU7CiAgICAgICAgICBzY29yZUlzRXhhY3QgPSBmYWxzZTsKICAgICAgICB9CiAgICAgIH0KCiAgICAgIHVubWFrZU1vdmUod29ya0JvYXJkLCBpdGVtLmZyb20sIGl0ZW0udG8sIGNhcHR1cmVkKTsKCiAgICAgIGlmIChzY29yZUlzRXhhY3QpIHsKICAgICAgICBpdGVtLnNjb3JlID0gYWxwaGFCZXRhUmVzdWx0LnZhbHVlOwogICAgICAgIGl0ZW0ubW92ZVNlcXVlbmNlID0gW3sgZnJvbTogaXRlbS5mcm9tLCB0bzogaXRlbS50byB9LCAuLi4oYWxwaGFCZXRhUmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldOwogICAgICAgIGlmIChpdGVtLnNjb3JlID4gcm9vdEFscGhhKSB7CiAgICAgICAgICByb290QWxwaGEgPSBpdGVtLnNjb3JlOwogICAgICAgIH0KICAgICAgfSBlbHNlIGlmIChpdGVtLnNjb3JlID4gcm9vdEFscGhhKSB7CiAgICAgICAgLy8g5L+d55WZ5LiK5LiA5bGC5YiG5pWw77yb6Iul5LuN6auY5LqO5b2T5YmNIM6x77yI5byC5bi477yJ77yM55Wl6ZmN5Lul5YWN5oyk5o6J55yf5pyA5LyYCiAgICAgICAgaXRlbS5zY29yZSA9IHJvb3RBbHBoYSAtIDFlLTM7CiAgICAgIH0KICAgIH0KCiAgICBzb3J0Um9vdE1vdmVzQnlTY29yZShyb290TW92ZXMpOwogICAgY29tcGxldGVkRGVwdGggPSBjdXJyZW50RGVwdGg7CgogICAgLy8g5oqK5pys5bGC5pyA5L2z552A5YaZ5YWlIFRU77yM5L6b5pu05rex5LiA5bGC5qC55o6S5bqPCiAgICB0cmFuc3Bvc2l0aW9uVGFibGUuc3RvcmUoCiAgICAgIHJvb3RUVEtleSwKICAgICAgY3VycmVudERlcHRoLAogICAgICByb290TW92ZXNbMF0uc2NvcmUsCiAgICAgICdleGFjdCcsCiAgICAgIHJvb3RNb3Zlc1swXSwKICAgICAgcm9vdE1vdmVzWzBdLm1vdmVTZXF1ZW5jZSB8fCBbXQogICAgKTsKCiAgICBjb25zb2xlLmxvZygKICAgICAgYElEIGRlcHRoICR7Y3VycmVudERlcHRofS8ke21heERlcHRofSBkb25lIHwgYmVzdD0ke0pTT04uc3RyaW5naWZ5KHJvb3RNb3Zlc1swXS5mcm9tKX0tPiR7SlNPTi5zdHJpbmdpZnkocm9vdE1vdmVzWzBdLnRvKX0gc2NvcmU9JHtyb290TW92ZXNbMF0uc2NvcmV9IGVsYXBzZWQ9JHtEYXRlLm5vdygpIC0gc3RhcnRUaW1lfW1zYAogICAgKTsKICB9CgogIGNvbnN0IGJlc3RNb3ZlID0gcm9vdE1vdmVzWzBdIHx8IG51bGw7CiAgY29uc3Qgc2Vjb25kQmVzdE1vdmUgPSByb290TW92ZXMubGVuZ3RoID4gMSA/IHJvb3RNb3Zlc1sxXSA6IG51bGw7CiAgY29uc3QgYmVzdE1vdmVTZXF1ZW5jZSA9IGJlc3RNb3ZlID8gKGJlc3RNb3ZlLm1vdmVTZXF1ZW5jZSB8fCBbXSkgOiBbXTsKICBjb25zdCBzZWNvbmRNb3ZlU2VxdWVuY2UgPSBzZWNvbmRCZXN0TW92ZSA/IChzZWNvbmRCZXN0TW92ZS5tb3ZlU2VxdWVuY2UgfHwgW10pIDogW107CiAgY29uc3QgYmVzdE1vdmVTY29yZSA9IGJlc3RNb3ZlID8gYmVzdE1vdmUuc2NvcmUgOiAwOwogIGNvbnN0IHNlY29uZEJlc3RNb3ZlU2NvcmUgPSBzZWNvbmRCZXN0TW92ZSA/IHNlY29uZEJlc3RNb3ZlLnNjb3JlIDogMDsKCiAgY29uc3QgYWxsTW92ZXNXaXRoU2NvcmVzID0gcm9vdE1vdmVzLm1hcCgobW92ZUluZm8pID0+ICh7CiAgICBtb3ZlOiB7CiAgICAgIGZyb206IG1vdmVJbmZvLmZyb20sCiAgICAgIHRvOiBtb3ZlSW5mby50bwogICAgfSwKICAgIHNjb3JlOiBtb3ZlSW5mby5zY29yZSwKICAgIG1vdmVTZXF1ZW5jZTogbW92ZUluZm8ubW92ZVNlcXVlbmNlIHx8IFtdCiAgfSkpOwoKICByZXR1cm4gewogICAgYmVzdE1vdmUsCiAgICBzZWNvbmRCZXN0TW92ZSwKICAgIG1vdmVTZXF1ZW5jZTogYmVzdE1vdmVTZXF1ZW5jZSwKICAgIHNlY29uZE1vdmVTZXF1ZW5jZSwKICAgIGJlc3RNb3ZlU2NvcmUsCiAgICBzZWNvbmRCZXN0TW92ZVNjb3JlLAogICAgYWxsTW92ZXNXaXRoU2NvcmVzLAogICAgY29tcGxldGVkRGVwdGgKICB9Owp9OwoKLy8gLS0tIFdPUktFUiBMSVNURU5FUiAo57uf5LiA5raI5oGv5aSE55CGKSAtLS0K';
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

