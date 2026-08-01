
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovDQoNCi8vIOaji+ebmOW4uOmHj+WumuS5iQ0KY29uc3QgUk9XUyA9IDEwOw0KY29uc3QgQ09MUyA9IDk7DQoNCi8vIOaji+WtkOexu+Wei+WumuS5iQ0KY29uc3QgUElFQ0VfVFlQRVMgPSB7DQogICAgR0VORVJBTDogJ2dlbmVyYWwnLA0KICAgIENIQVJJT1Q6ICdjaGFyaW90JywNCiAgICBDQU5OT046ICdjYW5ub24nLA0KICAgIEhPUlNFOiAnaG9yc2UnLA0KICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLA0KICAgIEFEVklTT1I6ICdhZHZpc29yJywNCiAgICBTT0xESUVSOiAnc29sZGllcicNCn07DQoNCi8vIOadkOaWmeWAvOadg+mHjemFjee9rg0KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGdlbmVyYWw6IDEwMDAwLCAgLy8g5bCGL+W4hQ0KICAgIGNoYXJpb3Q6IDkwMCwgICAgIC8vIOi9pg0KICAgIGNhbm5vbjogew0KICAgICAgICBlYXJseTogNDUwLCAgICAvLyDlvIDlsYDpmLbmrrUNCiAgICAgICAgbWlkOiA0MDAsICAgICAgLy8g5Lit5bGA6Zi25q61DQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQ0KICAgIH0sICAgICAgICAgICAgICAgIC8vIOeCrg0KICAgIGhvcnNlOiB7DQogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDQ1MCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsDQogICAgZWxlcGhhbnQ6IDIwMCwgICAgLy8g6LGhL+ebuA0KICAgIGFkdmlzb3I6IDIwMCwgICAgIC8vIOWjqy/ku5UNCiAgICBzb2xkaWVyOiB7DQogICAgICAgIGVhcmx5OiAxMDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDIwMCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSAgICAgICAgICAgICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIOaji+WtkOS7t+WAvOadg+mHjemFjee9rg0KbGV0IFZBTFVFX1dFSUdIVFMgPSB7DQogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQ0KICAgIC8vcG9zaXRpb246IDAuMiwgICAvLyDkvY3nva7lgLzmnYPph40NCiAgICAvL3RocmVhdDogMC4xNSwgICAgLy8g5aiB6IOB5YC85p2D6YeNDQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQ0KICAgIC8vc2FmZXR5OiAwLjEsICAgICAvLyDlronlhajlgLzmnYPph40NCiAgICAvL21vYmlsaXR5OiAwLjA1ICAgLy8g5py65Yqo5YC85p2D6YeNDQoNCiAgICBtYXRlcmlhbDogMSwgICAgLy8g5p2Q5paZ5YC85p2D6YeNDQogICAgcG9zaXRpb246IDEsICAgIC8vIOS9jee9ruWAvOadg+mHjQ0KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQ0KICAgIHRhY3RpYzogMSwgICAgICAvLyDmiJjmnK/lgLzmnYPph40NCiAgICBzYWZldHk6IDEsICAgICAgLy8g5a6J5YWo5YC85p2D6YeNDQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQ0KfTsNCg0KLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XDQpjb25zdCBFVkFMVUFUSU9OX1BBUkFNRVRFUlMgPSB7DQogICAgLy8g5py65Yqo5YC85Y+C5pWwDQogICAgbW9iaWxpdHk6IHsNCiAgICAgICAgYmFzZU1vdmVWYWx1ZTogMSwgICAgICAvLyDln7rnoYDnp7vliqjku7flgLwNCiAgICB9LA0KICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQ0KICAgIGNoZWNrOiB7DQogICAgICAgIGJvbnVzOiA4MA0KICAgIH0sDQogICAgLy8g5biu5Yqp5YWz57O75Y+C5pWwDQogICAgYXNzaXN0OiB7DQogICAgICAgIC8vY2Fubm9uU2NyZWVuVmFsdWU6IDQwICAvLyDngq7mnrbku7flgLwNCiAgICAgICAgY2Fubm9uU2NyZWVuVmFsdWU6IDAgIC8vIOeCruaetuS7t+WAvA0KICAgIH0sDQogICAgLy8g6Zi75oyh5YWz57O75Y+C5pWwDQogICAgYmxvY2s6IHsNCiAgICAgICAgLy9lbmVteUNoYXJpb3RCbG9ja1ZhbHVlOiAyMCwgICAgIC8vIOmYu+aMoeWvueaWuei9puS7t+WAvA0KICAgICAgICAvL2VuZW15SG9yc2VCbG9ja1ZhbHVlOiAxNSwgICAgICAgLy8g5Yir5a+55pa56ams6IW/5Lu35YC8DQogICAgICAgIC8vZW5lbXlFbGVwaGFudEJsb2NrVmFsdWU6IDEwLCAgICAvLyDloLXloZ7lr7nmlrnosaHnnLzku7flgLwNCiAgICAgICAgLy9hbGx5Q2hhcmlvdEJsb2NrUGVuYWx0eTogMjAsICAgIC8vIOmYu+aMoeW3seaWuei9puaDqee9mg0KICAgICAgICAvL2FsbHlIb3JzZUJsb2NrUGVuYWx0eTogMTUsICAgICAgLy8g5Yir5bex5pa56ams6IW/5oOp572aDQogICAgICAgIC8vYWxseUVsZXBoYW50QmxvY2tQZW5hbHR5OiAxMCAgICAvLyDloLXloZ7lt7HmlrnosaHnnLzmg6nnvZoNCg0KICAgICAgICBlbmVteUNoYXJpb3RCbG9ja1ZhbHVlOiAwLCAgICAgLy8g6Zi75oyh5a+55pa56L2m5Lu35YC8DQogICAgICAgIGVuZW15SG9yc2VCbG9ja1ZhbHVlOiAwLCAgICAgICAvLyDliKvlr7nmlrnpqazohb/ku7flgLwNCiAgICAgICAgZW5lbXlFbGVwaGFudEJsb2NrVmFsdWU6IDAsICAgIC8vIOWgteWhnuWvueaWueixoeecvOS7t+WAvA0KICAgICAgICBhbGx5Q2hhcmlvdEJsb2NrUGVuYWx0eTogMCwgICAgLy8g6Zi75oyh5bex5pa56L2m5oOp572aDQogICAgICAgIGFsbHlIb3JzZUJsb2NrUGVuYWx0eTogMCwgICAgICAvLyDliKvlt7Hmlrnpqazohb/mg6nnvZoNCiAgICAgICAgYWxseUVsZXBoYW50QmxvY2tQZW5hbHR5OiAwICAgIC8vIOWgteWhnuW3seaWueixoeecvOaDqee9mg0KICAgIH0NCn07DQoNCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rg0KY29uc3QgUE9TSVRJT05fVEFCTEVTID0gew0KICAgIC8vIOWFtS/ljZLkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBzb2xkaWVyOiBbDQogICAgICAgIFswLCA1LCAxMCwgMTUsIDIwLCAxNSwgMTAsIDUsIDBdLA0KICAgICAgICBbNSwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgY2hhcmlvdDogWw0KICAgICAgICBbNSwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDEwLCA1LCAxNSwgMCwgMTUsIDUsIDEwLCAxMF0sDQogICAgICAgIFswLCAxMCwgNSwgNSwgNSwgNSwgMTAsIDUsIDBdDQogICAgXSwNCiAgICAvLyDpqazkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBob3JzZTogWw0KICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgICAgICAgWzAsIDUsIDI1LCAxMCwgMTAsIDEwLCAyNSwgNSwgMF0sDQogICAgICAgIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sDQogICAgICAgIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMjUsIDIwLCAwLCAyMCwgMjUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgICAgICAgWzUsIDAsIDUsIDUsIDAsIDUsIDUsIDAsIDVdLA0KICAgICAgICBbMCwgMCwgMCwgNSwgLTIwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDngq7kvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBjYW5ub246IFsNCiAgICAgICAgWzEwLCAyMCwgMTUsIDEwLCAwLCAxMCwgMTUsIDIwLCAxMF0sDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLA0KICAgICAgICBbNSwgNSwgMTUsIDUsIDI1LCA1LCAxNSwgNSwgNV0sDQogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLA0KICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogICAgICAgIFsxMCwgMTAsIDE1LCAyMCwgMzAsIDIwLCAxNSwgMTAsIDEwXSwgDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBlbGVwaGFudDogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g5aOr5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgYWR2aXNvcjogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCA1LCAwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDEwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0NCiAgICBdDQp9Ow0KDQovLyDojrflj5bmo4vlrZDnmoTmnZDmlpnlgLwNCmNvbnN0IGdldE1hdGVyaWFsVmFsdWUgPSAocGllY2UsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOw0KICAgIA0KICAgIC8vIOmSiOWvueacieWIhumYtuauteadkOaWmeWAvOeahOWFteenje+8iOWFteOAgeeCruOAgemprO+8ieiwg+aVtOadkOaWmeWAvA0KICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7DQogICAgICAgIHZhbHVlID0gdmFsdWVbZ2FtZVN0YWdlXSB8fCB2YWx1ZS5taWQ7DQogICAgfQ0KICAgIA0KICAgIHJldHVybiB2YWx1ZTsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOS9jee9ruWAvA0KY29uc3QgZ2V0UG9zaXRpb25WYWx1ZSA9IChwaWVjZSwgciwgYykgPT4gew0KICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOw0KICAgIGlmICghdGFibGUpIHJldHVybiAwOw0KICAgIA0KICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqA0KICAgIGNvbnN0IHJvd0lkeCA9IHBpZWNlLmNvbG9yID09PSAncmVkJyA/ICg5LSByKSA6IHI7DQogICAgcmV0dXJuIHRhYmxlW3Jvd0lkeF1bY10gfHwgMDsNCn07DQoNCi8vIOS4u+ivhOS8sOWHveaVsCAtIOivpue7huivhOS8sOaji+ebmOWxgOWKv++8iFVJIC8g54K55qOL5YWz57O7IC8g5pCc57Si5Y+2IC8g5qC56IqC54K577yJDQovLyBvcHRpb25zLmZvclNlYXJjaExlYWY6IOS7hei3s+i/h+e7iOWxgCBnZXRWYWxpZE1vdmVz77yI5peg552A5bey5Zyo54i26IqC54K55aSE55CG77yJ77yM5LuN566X5a6M5pW05b2i5Yq/DQpjb25zdCBldmFsdWF0ZUJvYXJkID0gKGJvYXJkLCBpc1JlcGxheSA9IGZhbHNlLCBjdXJyZW50UGxheWVyID0gbnVsbCwgZGVwdGggPSAwLCBzZWFyY2hJbml0aWF0b3IgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJywgb3B0aW9ucyA9IG51bGwpID0+IHsNCiAgICAvLyDnu5/orqENCiAgICBpZiAoY3VycmVudFBsYXllcikgew0KICAgICAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQogICAgfQ0KICAgIGNvbnN0IGZvclNlYXJjaExlYWYgPSAhIShvcHRpb25zICYmIG9wdGlvbnMuZm9yU2VhcmNoTGVhZik7DQoNCiAgICBjb25zdCBvdXRwdXRQaGFzZSA9IGdhbWVTdGFnZTsNCg0KICAgIC8vIOmBjeWOhuaji+ebmO+8muWPquaUtumbhuWtkOWKmy9QU1TvvJvnnYDms5Ur5YWz57O757uf5LiA5ZyoIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zIOS4gOasoeWHoOS9leeUn+aIkO+8iOWvuem9kOeCru+8iQ0KICAgIGxldCBwaWVjZXNJbmZvID0gW107DQogICAgbGV0IHJlZE1hdGVyaWFsID0gMCwgcmVkUG9zaXRpb24gPSAwOw0KICAgIGxldCBibGFja01hdGVyaWFsID0gMCwgYmxhY2tQb3NpdGlvbiA9IDA7DQogICAgDQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAoIXBpZWNlKSBjb250aW51ZTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvblZhbHVlID0gZ2V0UG9zaXRpb25WYWx1ZShwaWVjZSwgciwgYyk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICByZWRNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgIHJlZFBvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGJsYWNrTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgICAgICBibGFja1Bvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7DQogICAgICAgICAgICAgICAgcGllY2UsDQogICAgICAgICAgICAgICAgciwNCiAgICAgICAgICAgICAgICBjLA0KICAgICAgICAgICAgICAgIG1vdmVzOiBbXSwNCiAgICAgICAgICAgICAgICBhbGx5R3VhcmRzOiBbXSwNCiAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlLA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uVmFsdWUsDQogICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDAsDQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLA0KICAgICAgICAgICAgICAgIHByb3RlY3Q6IFtdDQogICAgICAgICAgICB9KTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICBjb25zdCBib2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCiAgICBjYWxjdWxhdGVEZXJpdmVkVmFsdWVzKGJvYXJkLCBwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyLCBkZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGJvYXJkSW5mbywgZm9yU2VhcmNoTGVhZik7DQogICAgDQogICAgLy8g56ys5LiJ5q2l77ya6K6h566X5oC75YiG77yI5Y+q6K6h566X5Ymp5L2Z5YiG5pWw77yM5Z+656GA5YiG5pWw5bey5Zyo5qOL55uY6YGN5Y6G5pe26K6h566X77yJDQogICAgbGV0IHJlZFRocmVhdCA9IDAsIHJlZFRhY3RpYyA9IDAsIHJlZFNhZmV0eSA9IDAsIHJlZE1vYmlsaXR5ID0gMDsNCiAgICBsZXQgYmxhY2tUaHJlYXQgPSAwLCBibGFja1RhY3RpYyA9IDAsIGJsYWNrU2FmZXR5ID0gMCwgYmxhY2tNb2JpbGl0eSA9IDA7DQogICAgDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgY29uc3QgeyBwaWVjZSwgdGhyZWF0VmFsdWUsIHRhY3RpY1ZhbHVlLCBzYWZldHlWYWx1ZSwgbW9iaWxpdHlWYWx1ZSB9ID0gaW5mbzsNCiAgICAgICAgDQogICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgIHJlZFRocmVhdCArPSB0aHJlYXRWYWx1ZTsNCiAgICAgICAgICAgIHJlZFRhY3RpYyArPSB0YWN0aWNWYWx1ZTsNCiAgICAgICAgICAgIHJlZFNhZmV0eSArPSBzYWZldHlWYWx1ZTsNCiAgICAgICAgICAgIHJlZE1vYmlsaXR5ICs9IG1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBibGFja1RocmVhdCArPSB0aHJlYXRWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrVGFjdGljICs9IHRhY3RpY1ZhbHVlOw0KICAgICAgICAgICAgYmxhY2tTYWZldHkgKz0gc2FmZXR5VmFsdWU7DQogICAgICAgICAgICBibGFja01vYmlsaXR5ICs9IG1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g6K6h566X5bGA5Yq/5oC75YiGDQogICAgY29uc3QgcmVkVG90YWwgPSANCiAgICAgICAgcmVkTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgcmVkUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsNCiAgICAgICAgcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKw0KICAgICAgICByZWRUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArDQogICAgICAgIHJlZFNhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsNCiAgICAgICAgcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5OyANCiAgICANCiAgICBjb25zdCBibGFja1RvdGFsID0gDQogICAgICAgIGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgYmxhY2tQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24gKw0KICAgICAgICBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsNCiAgICAgICAgYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArDQogICAgICAgIGJsYWNrU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHkgKw0KICAgICAgICBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsNCiAgICANCiAgICAvLyDov5Tlm57or6bnu4bor4TkvLDnu5PmnpwNCiAgICByZXR1cm4gew0KICAgICAgICByZWQ6IHsNCiAgICAgICAgICAgIHRvdGFsOiByZWRUb3RhbCwNCiAgICAgICAgICAgIG1hdGVyaWFsOiByZWRNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICBwb3NpdGlvbjogcmVkUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLA0KICAgICAgICAgICAgdGhyZWF0OiByZWRUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCwNCiAgICAgICAgICAgIHRhY3RpYzogcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMsDQogICAgICAgICAgICBzYWZldHk6IHJlZFNhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LA0KICAgICAgICAgICAgbW9iaWxpdHk6IHJlZE1vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eSwNCiAgICAgICAgICAgIHBoYXNlOiBvdXRwdXRQaGFzZSwNCiAgICAgICAgICAgIHdlaWdodHM6IHsNCiAgICAgICAgICAgICAgICBtYXRlcmlhbDogMC40LA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLjIsDQogICAgICAgICAgICAgICAgdGFjdGljOiAwLjEsDQogICAgICAgICAgICAgICAgc2FmZXR5OiAwLjEsDQogICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAuMDUsDQogICAgICAgICAgICAgICAgdGhyZWF0OiAwLjE1DQogICAgICAgICAgICB9DQogICAgICAgIH0sDQogICAgICAgIGJsYWNrOiB7DQogICAgICAgICAgICB0b3RhbDogYmxhY2tUb3RhbCwNCiAgICAgICAgICAgIG1hdGVyaWFsOiBibGFja01hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwNCiAgICAgICAgICAgIHBvc2l0aW9uOiBibGFja1Bvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgIHRocmVhdDogYmxhY2tUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCwNCiAgICAgICAgICAgIHRhY3RpYzogYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYywNCiAgICAgICAgICAgIHNhZmV0eTogYmxhY2tTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgIG1vYmlsaXR5OiBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eSwNCiAgICAgICAgICAgIHBoYXNlOiBvdXRwdXRQaGFzZSwNCiAgICAgICAgICAgIHdlaWdodHM6IHsNCiAgICAgICAgICAgICAgICBtYXRlcmlhbDogMC40LA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLjIsDQogICAgICAgICAgICAgICAgdGFjdGljOiAwLjEsDQogICAgICAgICAgICAgICAgc2FmZXR5OiAwLjEsDQogICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAuMDUsDQogICAgICAgICAgICAgICAgdGhyZWF0OiAwLjE1DQogICAgICAgICAgICB9DQogICAgICAgIH0sDQogICAgICAgIHBpZWNlc0luZm86IHBpZWNlc0luZm8sDQogICAgICAgIGdhbWVTdGFnZTogZ2FtZVN0YWdlLA0KICAgICAgICBib2FyZEluZm86IGJvYXJkSW5mbw0KICAgIH07DQp9Ow0KDQovLyDlsIYv5biF5L2N572u57yT5a2Y77ya5L6bIHBvc3QtbW92ZSBpc0NoZWNrIC8g6aOe5bCG5b+r6YCf5p+l6K+i77yM55SxIG1ha2UvdW5tYWtlIOe7tOaKpA0KbGV0IGdlbmVyYWxQb3NDYWNoZSA9IHsgcmVkOiBudWxsLCBibGFjazogbnVsbCB9Ow0KDQovLyDlsIbluIXku4XlnKjkuZ3lrqvlhoXvvIzmjInkuZ3lrqvmiavmj4/ljbPlj68NCmNvbnN0IGZpbmRHZW5lcmFsUG9zID0gKGJvYXJkLCBjb2xvcikgPT4gew0KICAgIGNvbnN0IHJvd1N0YXJ0ID0gY29sb3IgPT09ICdyZWQnID8gMCA6IDc7DQogICAgY29uc3Qgcm93RW5kID0gY29sb3IgPT09ICdyZWQnID8gMiA6IDk7DQogICAgZm9yIChsZXQgciA9IHJvd1N0YXJ0OyByIDw9IHJvd0VuZDsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAzOyBjIDw9IDU7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyByLCBjIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgcmV0dXJuIG51bGw7DQp9Ow0KDQpjb25zdCBzeW5jR2VuZXJhbFBvc0NhY2hlID0gKGJvYXJkKSA9PiB7DQogICAgZ2VuZXJhbFBvc0NhY2hlLnJlZCA9IGZpbmRHZW5lcmFsUG9zKGJvYXJkLCAncmVkJyk7DQogICAgZ2VuZXJhbFBvc0NhY2hlLmJsYWNrID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsICdibGFjaycpOw0KfTsNCg0KY29uc3QgZ2V0R2VuZXJhbFBvcyA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBjb25zdCBjYWNoZWQgPSBnZW5lcmFsUG9zQ2FjaGVbY29sb3JdOw0KICAgIGlmIChjYWNoZWQpIHsNCiAgICAgICAgY29uc3QgcCA9IGJvYXJkW2NhY2hlZC5yXT8uW2NhY2hlZC5jXTsNCiAgICAgICAgaWYgKHAgJiYgcC50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgIHJldHVybiBjYWNoZWQ7DQogICAgICAgIH0NCiAgICB9DQogICAgY29uc3QgcG9zID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsIGNvbG9yKTsNCiAgICBnZW5lcmFsUG9zQ2FjaGVbY29sb3JdID0gcG9zOw0KICAgIHJldHVybiBwb3M7DQp9Ow0KDQovLyDmkJzntKLnlKjljp/lnLDotbDlrZAgLyDmgaLlpI3vvIjpgb/lhY3mr4/mrKHpgJLlvZIgYm9hcmQubWFw77yJ77yb5ZCM5q2l57u05oqk5bCG5L2N57yT5a2YDQpjb25zdCBtYWtlTW92ZSA9IChib2FyZCwgZnJvbSwgdG8pID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsNCiAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW3RvLnJdW3RvLmNdOw0KICAgIGJvYXJkW3RvLnJdW3RvLmNdID0gcGllY2U7DQogICAgYm9hcmRbZnJvbS5yXVtmcm9tLmNdID0gbnVsbDsNCiAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtwaWVjZS5jb2xvcl0gPSB7IHI6IHRvLnIsIGM6IHRvLmMgfTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0gbnVsbDsNCiAgICB9DQogICAgcmV0dXJuIGNhcHR1cmVkOw0KfTsNCg0KY29uc3QgdW5tYWtlTW92ZSA9IChib2FyZCwgZnJvbSwgdG8sIGNhcHR1cmVkKSA9PiB7DQogICAgY29uc3QgcGllY2UgPSBib2FyZFt0by5yXVt0by5jXTsNCiAgICBib2FyZFtmcm9tLnJdW2Zyb20uY10gPSBwaWVjZTsNCiAgICBib2FyZFt0by5yXVt0by5jXSA9IGNhcHR1cmVkOw0KICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogZnJvbS5yLCBjOiBmcm9tLmMgfTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0geyByOiB0by5yLCBjOiB0by5jIH07DQogICAgfQ0KfTsNCg0KLy8g6LWw5a2Q5ZCO5piv5ZCm5L2/5bex5pa55bCG5LiN5a6J5YWo77yI6aOe5bCG5oiW6KKr5bCG77yJ44CC6LCD55So5YmN6aG75beyIG1ha2VNb3Zl44CCDQpjb25zdCBsZWF2ZXNPd25LaW5nVW5zYWZlID0gKGJvYXJkLCBjb2xvcikgPT4gew0KICAgIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcysrOw0KICAgIHJldHVybiBpc0ZseWluZ0dlbmVyYWwoYm9hcmQpIHx8IGlzQ2hlY2tSYXcoYm9hcmQsIGNvbG9yKTsNCn07DQoNCi8vIOS7juS8quWQiOazleedgOazleS4rei/h+a7pOWHuuS4jemAgeWwhi/kuI3po57lsIbnmoTlkIjms5XnnYDms5XvvIhVSS/moLnoioLngrkv5byA5bGA5bqT5qCh6aqM77yJDQovLyDmkJzntKLng63ot6/lvoTkvb/nlKjlu7bov5/lkIjms5XmgKfvvIjor5XotbDml7bmo4DmtYvvvInvvIzpgb/lhY3lr7nliarmnp3mnKrop6blj4rnmoTnnYDms5XlgZrlhajph4/ov4fmu6QNCmNvbnN0IGZpbHRlckxlZ2FsTW92ZXMgPSAoYm9hcmQsIGZyb20sIHBpZWNlLCBwc2V1ZG9Nb3ZlcykgPT4gew0KICAgIGNvbnN0IHZhbGlkTW92ZXMgPSBbXTsNCiAgICBmb3IgKGNvbnN0IHRvIG9mIHBzZXVkb01vdmVzKSB7DQogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZU1vdmUoYm9hcmQsIGZyb20sIHRvKTsNCiAgICAgICAgY29uc3QgaWxsZWdhbCA9IGxlYXZlc093bktpbmdVbnNhZmUoYm9hcmQsIHBpZWNlLmNvbG9yKTsNCiAgICAgICAgdW5tYWtlTW92ZShib2FyZCwgZnJvbSwgdG8sIGNhcHR1cmVkKTsNCiAgICAgICAgaWYgKCFpbGxlZ2FsKSB2YWxpZE1vdmVzLnB1c2godG8pOw0KICAgIH0NCiAgICByZXR1cm4gdmFsaWRNb3ZlczsNCn07DQoNCi8vIOaQnOe0oueUqOedgOazleWHhuWkh++8iOi9u+mHj++8ie+8muS4jeW7uuWFs+ezu+Wbvi/lqIHog4Ev5py65Yqo5oCnDQovLyBTRUFSQ0hfREVGRVJfTEVHQUxJVFk9dHJ1Ze+8muWPqueUn+aIkOS8quWQiOazle+8jOWQiOazleaAp+WcqOivlei1sOaXtuajgOa1iw0KLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPWZhbHNl77ya6aKE6L+H5ruk5ZCI5rOV552A77yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQ0KLy8g54K55qOL5YWz57O75LuN6LWw5a6M5pW0IGV2YWx1YXRlQm9hcmTvvIzkuI3lj5flvbHlk40NCmNvbnN0IHByZXBhcmVTZWFyY2hJbmZvID0gKGJvYXJkLCBjdXJyZW50UGxheWVyLCBnYW1lU3RhZ2UsIHNlYXJjaEluaXRpYXRvciA9IG51bGwsIGRlcHRoID0gMCkgPT4gew0KICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQoNCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVja1Jhdyhib2FyZCwgY3VycmVudFBsYXllcik7DQogICAgY29uc3QgcGllY2VzSW5mbyA9IFtdOw0KICAgIGNvbnN0IGxlZ2FsTW92ZUxpc3QgPSBbXTsNCiAgICBjb25zdCBkZWZlciA9IFNFQVJDSF9ERUZFUl9MRUdBTElUWTsNCg0KICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKCFwaWVjZSB8fCBwaWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7DQoNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlKTsNCiAgICAgICAgICAgIGNvbnN0IHVzZU1vdmVzID0gZGVmZXIgPyBtb3ZlcyA6IGZpbHRlckxlZ2FsTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSwgbW92ZXMpOw0KICAgICAgICAgICAgcGllY2VzSW5mby5wdXNoKHsNCiAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICByLA0KICAgICAgICAgICAgICAgIGMsDQogICAgICAgICAgICAgICAgbW92ZXMsDQogICAgICAgICAgICAgICAgbGVnYWxNb3ZlczogdXNlTW92ZXMNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB1c2VNb3Zlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHRvID0gdXNlTW92ZXNbaV07DQogICAgICAgICAgICAgICAgbGVnYWxNb3ZlTGlzdC5wdXNoKHsgZnJvbTogeyByLCBjIH0sIHRvLCBzY29yZTogMCB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCArPSBtb3Zlcy5sZW5ndGg7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDovbvph48gYm9hcmRJbmZv77ya5LuF6KKr5bCG5qCH5b+XDQogICAgY29uc3QgYm9hcmRJbmZvID0gew0KICAgICAgICByZWRJc0luQ2hlY2s6IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gaW5DaGVjayA6IGZhbHNlLA0KICAgICAgICBibGFja0lzSW5DaGVjazogY3VycmVudFBsYXllciA9PT0gJ2JsYWNrJyA/IGluQ2hlY2sgOiBmYWxzZSwNCiAgICAgICAgZ2FtZVN0YXRlOiBudWxsDQogICAgfTsNCg0KICAgIGlmIChsZWdhbE1vdmVMaXN0Lmxlbmd0aCA9PT0gMCkgew0KICAgICAgICBjb25zdCBvcHBvbmVudCA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0gaW5DaGVjaw0KICAgICAgICAgICAgPyB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfQ0KICAgICAgICAgICAgOiB7IHN0YXR1czogJ3N0YWxlbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICB9IGVsc2Ugew0KICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdwbGF5aW5nJyB9Ow0KICAgIH0NCg0KICAgIHJldHVybiB7IHBpZWNlc0luZm8sIGJvYXJkSW5mbywgbGVnYWxNb3ZlTGlzdCwgaW5DaGVjaywgZGVmZXJyZWRMZWdhbGl0eTogZGVmZXIgfTsNCn07DQoNCi8vIOiuoeeul+ihjeeUn+WAvO+8muWogeiDgeWAvOOAgeWuieWFqOWAvOOAgeaImOacr+WAvOOAgeacuuWKqOWAvA0KY29uc3QgY2FsY3VsYXRlRGVyaXZlZFZhbHVlcyA9IChib2FyZCwgcGllY2VzSW5mbywgY3VycmVudFBsYXllciA9IG51bGwsIGRlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcsIGJvYXJkSW5mbyA9IG51bGwsIGZvclNlYXJjaExlYWYgPSBmYWxzZSkgPT4gew0KICAgIC8vIOmHjee9ruaJgOacieihjeeUn+WAvO+8jOmZpOS6huacuuWKqOWAvO+8iOW3suWcqOaUtumbhuaji+WtkOS/oeaBr+aXtuiuoeeul++8iQ0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGluZm8udGhyZWF0VmFsdWUgPSAwOw0KICAgICAgICBpbmZvLnNhZmV0eVZhbHVlID0gMDsNCiAgICAgICAgaW5mby50YWN0aWNWYWx1ZSA9IDA7DQogICAgICAgIC8vIOS/neeVmeacuuWKqOWAvO+8jOWboOS4uuW3suWcqOaUtumbhuaji+WtkOS/oeaBr+aXtuiuoeeulw0KICAgIH0NCiAgICANCiAgICAvLyAxLiDorqHnrpfmo4vlrZDlhbPns7vvvIjlqIHog4HogIXjgIHooqvlqIHog4HogIXjgIHkv53miqTogIXjgIHooqvkv53miqTogIXvvIkNCiAgICBpZiAoIWJvYXJkSW5mbykgew0KICAgICAgICBib2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCiAgICB9DQogICAgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMoYm9hcmQsIHBpZWNlc0luZm8sIGJvYXJkSW5mbyk7DQogICAgDQogICAgLy8gMi4g6K6h566X5aiB6IOB5YC877yI5oyJ6KKr5aiB6IOB5a2Q6IGa5ZCI77yMU0VFIOavj+ebruagh+S4gOasoe+8iQ0KICAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlcyhwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyLCBib2FyZEluZm8pOw0KICAgIA0KICAgIC8vIDMuIOiuoeeul+aImOacr+WAvOeahOWFtuS7lumDqOWIhu+8iOW4ruWKqeWFs+ezu+WSjOmYu+aMoeWFs+ezu++8iQ0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIC8vaW5mby50YWN0aWNWYWx1ZSArPSBjYWxjdWxhdGVBc3Npc3RWYWx1ZShwaWVjZXNJbmZvLCBpbmZvKTsNCiAgICAgICAgLy9pbmZvLnRhY3RpY1ZhbHVlICs9IGNhbGN1bGF0ZUJsb2NrVmFsdWUoYm9hcmQsIHBpZWNlc0luZm8sIGluZm8pOw0KICAgIH0NCiAgICANCiAgICAvLyA0LiDmnIDlkI7orqHnrpflronlhajlgLzvvIzkvKDpgJJib2FyZEluZm/kvZzkuLrlj4LmlbANCiAgICBjYWxjdWxhdGVTYWZldHlWYWx1ZXMocGllY2VzSW5mbywgYm9hcmRJbmZvKTsNCiAgICANCiAgICAvLyA1LiDorqHnrpfmuLjmiI/nirbmgIHlubbkv53lrZjliLBib2FyZEluZm8NCiAgICAvLyDmkJzntKLlj7boioLngrnot7Pov4fvvJrml6DnnYAv5bCG5q275bey5Zyo54i26IqC54K55aSE55CG77yM5q2k5aSE5Y+q6ZyA6Z2Z5oCB5YiGDQogICAgaWYgKGN1cnJlbnRQbGF5ZXIgJiYgIWZvclNlYXJjaExlYWYpIHsNCiAgICAgICAgLy8g5qOA5p+l5b2T5YmN546p5a625piv5ZCm5pyJ5ZCI5rOV6LWw5rOVDQogICAgICAgIGxldCBoYXNNb3ZlcyA9IGZhbHNlOw0KICAgICAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICAgICAgaWYgKGluZm8ucGllY2UuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgICAgICAgICAvLyDojrflj5blvZPliY3mo4vlrZDnmoTmnInmlYjotbDms5UNCiAgICAgICAgICAgICAgICBjb25zdCBtb3ZlcyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIHsgcjogaW5mby5yLCBjOiBpbmZvLmMgfSk7DQogICAgICAgICAgICAgICAgaWYgKG1vdmVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICAgICAgaGFzTW92ZXMgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIOWIpOaWrea4uOaIj+eKtuaAgQ0KICAgICAgICBsZXQgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdwbGF5aW5nJyB9Ow0KICAgICAgICBpZiAoIWhhc01vdmVzKSB7DQogICAgICAgICAgICAvLyDmsqHmnInlkIjms5XotbDms5XvvIzmo4Dmn6XmmK/lkKbooqvlsIblhpsNCiAgICAgICAgICAgIGNvbnN0IGluQ2hlY2sgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRJc0luQ2hlY2sgOiBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2s7DQogICAgICAgICAgICBjb25zdCBvcHBvbmVudCA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoaW5DaGVjaykgew0KICAgICAgICAgICAgICAgIGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAnY2hlY2ttYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ3N0YWxlbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy8g5L+d5a2Y5ri45oiP54q25oCB5YiwYm9hcmRJbmZvDQogICAgICAgIGJvYXJkSW5mby5nYW1lU3RhdGUgPSBnYW1lU3RhdGU7DQogICAgfQ0KfTsNCg0KLy8g6Z2e54Ku77ya5LiA5qyh5Yeg5L2V5omr5o+P5ZCM5pe25aGr5YWFIG1vdmVzICsgY29udHJvbCAvIHRocmVhdCAvIGd1YXJkIC8gbW9iaWxpdHnvvIjlr7npvZAgZmlsbENhbm5vblJlbGF0aW9uc++8iQ0KLy8g6K+t5LmJ5LiOIGdldFBpZWNlTW92ZXMgKyBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyDml6fmi4bliIbot6/lvoTkuIDoh7TvvJtnZXRQaWVjZU1vdmVzIOS7jeS+m+edgOazleeUn+aIkOS9v+eUqA0KY29uc3QgZmlsbE5vbkNhbm5vblJlbGF0aW9ucyA9IChib2FyZCwgaW5mbywgcG9zQnlLZXkpID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGluZm8ucGllY2U7DQogICAgY29uc3QgeyByLCBjIH0gPSBpbmZvOw0KICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICAgIGNvbnN0IHsgYmFzZU1vdmVWYWx1ZSB9ID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5Ow0KICAgIGluZm8ubW92ZXMgPSBbXTsNCiAgICBpbmZvLmNvbnRyb2wgPSBbXTsNCiAgICBpbmZvLmFsbHlHdWFyZHMgPSBbXTsNCiAgICBsZXQgbW9iaWxpdHlWYWx1ZSA9IDA7DQoNCiAgICBjb25zdCBsaW5rVGhyZWF0ID0gKHRyLCB0YykgPT4gew0KICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcG9zQnlLZXkuZ2V0KHRyICogOSArIHRjKTsNCiAgICAgICAgaWYgKHRhcmdldEluZm8pIHsNCiAgICAgICAgICAgIGluZm8udGhyZWF0LnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICB0YXJnZXRJbmZvLnRocmVhdGVuZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICB9DQogICAgfTsNCg0KICAgIGNvbnN0IGxpbmtHdWFyZCA9ICh0ciwgdGMpID0+IHsNCiAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBvc0J5S2V5LmdldCh0ciAqIDkgKyB0Yyk7DQogICAgICAgIGlmICh0YXJnZXRJbmZvICYmIHRhcmdldEluZm8gIT09IGluZm8pIHsNCiAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgIHRhcmdldEluZm8uZ3VhcmRlZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICBpbmZvLmFsbHlHdWFyZHMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgfQ0KICAgIH07DQoNCiAgICBjb25zdCBhZGRTcXVhcmUgPSAodHIsIHRjKSA9PiB7DQogICAgICAgIGlmICghaXNWYWxpZFBvcyh0ciwgdGMpKSByZXR1cm47DQogICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW3RyXVt0Y107DQogICAgICAgIGlmICghdGFyZ2V0KSB7DQogICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgICAgICAgICBpbmZvLmNvbnRyb2wucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgfSBlbHNlIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlLmNvbG9yKSB7DQogICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgICAgICAgICBsaW5rVGhyZWF0KHRyLCB0Yyk7DQogICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgbGlua0d1YXJkKHRyLCB0Yyk7DQogICAgICAgIH0NCiAgICB9Ow0KDQogICAgc3dpdGNoIChwaWVjZS50eXBlKSB7DQogICAgICAgIGNhc2UgJ2dlbmVyYWwnOg0KICAgICAgICAgICAgZm9yIChjb25zdCBbZHIsIGRjXSBvZiBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dKSB7DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIGlmIChuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkICYmIG5yID49IDAgJiYgbnIgPD0gMikgYWRkU3F1YXJlKG5yLCBuYyk7DQogICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA3ICYmIG5yIDw9IDkpIGFkZFNxdWFyZShuciwgbmMpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICBjYXNlICdhZHZpc29yJzoNCiAgICAgICAgICAgIGZvciAoY29uc3QgW2RyLCBkY10gb2YgW1sxLCAxXSwgWzEsIC0xXSwgWy0xLCAxXSwgWy0xLCAtMV1dKSB7DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIGlmIChuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkICYmIG5yID49IDAgJiYgbnIgPD0gMikgYWRkU3F1YXJlKG5yLCBuYyk7DQogICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA3ICYmIG5yIDw9IDkpIGFkZFNxdWFyZShuciwgbmMpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICBjYXNlICdlbGVwaGFudCc6DQogICAgICAgICAgICBmb3IgKGNvbnN0IFtkciwgZGNdIG9mIFtbMiwgMl0sIFsyLCAtMl0sIFstMiwgMl0sIFstMiwgLTJdXSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICBjb25zdCBleWVSID0gciArIGRyIC8gMiwgZXllQyA9IGMgKyBkYyAvIDI7DQogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobnIsIG5jKSAmJiBib2FyZFtleWVSXVtleWVDXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPD0gNCkgYWRkU3F1YXJlKG5yLCBuYyk7DQogICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA1KSBhZGRTcXVhcmUobnIsIG5jKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgY2FzZSAnaG9yc2UnOg0KICAgICAgICAgICAgZm9yIChjb25zdCBbZHIsIGRjXSBvZiBbWzIsIDFdLCBbMiwgLTFdLCBbLTIsIDFdLCBbLTIsIC0xXSwgWzEsIDJdLCBbMSwgLTJdLCBbLTEsIDJdLCBbLTEsIC0yXV0pIHsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgICAgICAgICAgY29uc3QgbGVnUiA9IHIgKyAoTWF0aC5hYnMoZHIpID09PSAyID8gTWF0aC5zaWduKGRyKSA6IDApOw0KICAgICAgICAgICAgICAgIGNvbnN0IGxlZ0MgPSBjICsgKE1hdGguYWJzKGRjKSA9PT0gMiA/IE1hdGguc2lnbihkYykgOiAwKTsNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhsZWdSLCBsZWdDKSAmJiBib2FyZFtsZWdSXVtsZWdDXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgICAgICBhZGRTcXVhcmUobnIsIG5jKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgY2FzZSAnY2hhcmlvdCc6DQogICAgICAgICAgICBmb3IgKGNvbnN0IFtkciwgZGNdIG9mIFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV0pIHsNCiAgICAgICAgICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldCA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5jb250cm9sLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0LmNvbG9yICE9PSBwaWVjZS5jb2xvcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rVGhyZWF0KG5yLCBuYyk7DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rR3VhcmQobnIsIG5jKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIG5yICs9IGRyOw0KICAgICAgICAgICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgY2FzZSAnc29sZGllcic6IHsNCiAgICAgICAgICAgIGNvbnN0IGZvcndhcmQgPSBpc1JlZCA/IDEgOiAtMTsNCiAgICAgICAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGlzUmVkID8gciA+PSA1IDogciA8PSA0Ow0KICAgICAgICAgICAgYWRkU3F1YXJlKHIgKyBmb3J3YXJkLCBjKTsNCiAgICAgICAgICAgIGlmIChjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICBhZGRTcXVhcmUociwgYyAtIDEpOw0KICAgICAgICAgICAgICAgIGFkZFNxdWFyZShyLCBjICsgMSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBkZWZhdWx0Og0KICAgICAgICAgICAgYnJlYWs7DQogICAgfQ0KICAgIGluZm8ubW9iaWxpdHlWYWx1ZSA9IG1vYmlsaXR5VmFsdWU7DQp9Ow0KDQovLyDngq7vvJrkuIDmrKHlm5vlkJHlsITnur/lkIzml7bloavlhYUgbW92ZXMgKyB0aHJlYXQgLyBndWFyZCAvIGNvbnRyb2zvvIjpgb/lhY0gZ2V0UGllY2VNb3ZlcyDlho3miavkuIDpgY3vvIkNCmNvbnN0IGZpbGxDYW5ub25SZWxhdGlvbnMgPSAoYm9hcmQsIGluZm8sIHBvc0J5S2V5KSA9PiB7DQogICAgY29uc3QgcGllY2UgPSBpbmZvLnBpZWNlOw0KICAgIGNvbnN0IHsgciwgYyB9ID0gaW5mbzsNCiAgICBjb25zdCB7IGJhc2VNb3ZlVmFsdWUgfSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eTsNCiAgICBpbmZvLm1vdmVzID0gW107DQogICAgaW5mby5jb250cm9sID0gW107DQogICAgbGV0IG1vYmlsaXR5VmFsdWUgPSAwOw0KDQogICAgZm9yIChjb25zdCBbZHIsIGRjXSBvZiBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dKSB7DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGxldCBzY3JlZW5Gb3VuZENvdW50ID0gMDsNCiAgICAgICAgd2hpbGUgKGlzVmFsaWRQb3MobnIsIG5jKSAmJiBzY3JlZW5Gb3VuZENvdW50IDwgMikgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICBpZiAocCAhPT0gbnVsbCkgew0KICAgICAgICAgICAgICAgIHNjcmVlbkZvdW5kQ291bnQrKzsNCiAgICAgICAgICAgICAgICBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMikgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcG9zQnlLZXkuZ2V0KG5yICogOSArIG5jKTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldEluZm8gJiYgdGFyZ2V0SW5mbyAhPT0gaW5mbykgew0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHAuY29sb3IgIT09IHBpZWNlLmNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLnRocmVhdGVuZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLmd1YXJkLnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwLmNvbG9yICE9PSBwaWVjZS5jb2xvcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g55uu5qCH5LiN5ZyoIHBpZWNlc0luZm8g5pe25LuN5L+d55WZ5Y+v6LWw5qC8DQogICAgICAgICAgICAgICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIGlmIChzY3JlZW5Gb3VuZENvdW50ID09PSAwKSB7DQogICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMSkgew0KICAgICAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOw0KfTsNCg0KLy8g6K6h566X5qOL5a2Q5YWz57O777yI5aiB6IOB6ICF44CB6KKr5aiB6IOB6ICF44CB5L+d5oqk6ICF44CB6KKr5L+d5oqk6ICF77yJDQovLyDlkIzml7borqHnrpdib2FyZEluZm/vvJrkuLrmo4vnm5jmr4/kuKrkvY3nva7nmbvorrDmjqfliLbogIUNCi8vIOWkjeeUqCBpbmZvLm1vdmVzICsgYWxseUd1YXJkc++8m+eCrueUqOS4gOasoeWwhOe6vw0KY29uc3QgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMgPSAoYm9hcmQsIHBpZWNlc0luZm8sIGJvYXJkSW5mbykgPT4gew0KICAgIC8vIOWIneWni+WMluaji+WtkOWFs+ezu+aVsOe7hA0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGluZm8udGhyZWF0ID0gW107ICAgICAgICAgICAvLyDmo4Dmn6Xov5nkuKrmo4vlrZDlj6/ku6XlqIHog4Hlk6rkupvmo4vlrZANCiAgICAgICAgaW5mby50aHJlYXRlbmVkQnkgPSBbXTsgICAgIC8vIOajgOafpei/meS4quaji+WtkOiiq+WTquS6m+aji+WtkOWogeiDgQ0KICAgICAgICBpbmZvLmd1YXJkID0gW107ICAgICAgIC8vIOajgOafpei/meS4quaji+WtkOWPr+S7peS/neaKpOWTquS6m+aji+WtkA0KICAgICAgICBpbmZvLmd1YXJkZWRCeSA9IFtdOyAgICAgIC8vIOajgOafpei/meS4quaji+WtkOiiq+WTquS6m+aji+WtkOS/neaKpA0KICAgICAgICBpbmZvLmNvbnRyb2wgPSBbXTsgICAgICAvLyDmo4Dmn6Xov5nkuKrmo4vlrZDlj6/ku6XmjqfliLbnmoTlk6rkupvkvY3nva4NCiAgICB9DQogICAgDQogICAgLy8g5aaC5p6cYm9hcmRJbmZv5Li656m677yM5YiZ5Yid5aeL5YyWDQogICAgaWYgKCFib2FyZEluZm8pIHsNCiAgICAgICAgYm9hcmRJbmZvID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7DQogICAgfQ0KDQogICAgY29uc3QgcG9zQnlLZXkgPSBuZXcgTWFwKCk7DQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgcG9zQnlLZXkuc2V0KGluZm8uciAqIDkgKyBpbmZvLmMsIGluZm8pOw0KICAgIH0NCiAgICANCiAgICAvLyDlpITnkIbmr4/kuKrmo4vlrZDvvJrkuIDmrKHlh6DkvZXlkIzml7bloasgbW92ZXMgKyDlhbPns7vvvIjngq4v6Z2e54Ku57uf5LiA5qih5byP77yJDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gJ2Nhbm5vbicpIHsNCiAgICAgICAgICAgIGZpbGxDYW5ub25SZWxhdGlvbnMoYm9hcmQsIGluZm8sIHBvc0J5S2V5KTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGZpbGxOb25DYW5ub25SZWxhdGlvbnMoYm9hcmQsIGluZm8sIHBvc0J5S2V5KTsNCiAgICAgICAgfQ0KDQogICAgICAgIGNvbnN0IGNvbnRyb2wgPSBpbmZvLmNvbnRyb2w7DQogICAgICAgIA0KICAgICAgICAvLyDmjqfliLbogIXliJfooajnm7TmjqXlvJXnlKggcGllY2VzSW5mbyDmnaHnm67vvIzpgb/lhY3mr4/moLwgbmV3IHtyLGMsY29sb3IsdHlwZX0NCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb250cm9sLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBwb3MgPSBjb250cm9sW2ldOw0KICAgICAgICAgICAgYm9hcmRJbmZvW3Bvcy5yXVtwb3MuY10ucHVzaChpbmZvKTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDpooTorqHnrpflsIblhpvnirbmgIENCiAgICBsZXQgcmVkSXNJbkNoZWNrID0gZmFsc2U7DQogICAgbGV0IGJsYWNrSXNJbkNoZWNrID0gZmFsc2U7DQogICAgDQogICAgbGV0IHJlZEdlbmVyYWxJbmZvID0gbnVsbDsNCiAgICBsZXQgYmxhY2tHZW5lcmFsSW5mbyA9IG51bGw7DQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICBpZiAoaW5mby5waWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICByZWRHZW5lcmFsSW5mbyA9IGluZm87DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGJsYWNrR2VuZXJhbEluZm8gPSBpbmZvOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIGlmIChyZWRHZW5lcmFsSW5mbykgew0KICAgICAgICBmb3IgKGNvbnN0IHRocmVhdGVuZXIgb2YgcmVkR2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7DQogICAgICAgICAgICBpZiAodGhyZWF0ZW5lci5waWVjZS5jb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgIHJlZElzSW5DaGVjayA9IHRydWU7DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgaWYgKGJsYWNrR2VuZXJhbEluZm8pIHsNCiAgICAgICAgZm9yIChjb25zdCB0aHJlYXRlbmVyIG9mIGJsYWNrR2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7DQogICAgICAgICAgICBpZiAodGhyZWF0ZW5lci5waWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICBibGFja0lzSW5DaGVjayA9IHRydWU7DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgaWYgKHJlZEdlbmVyYWxJbmZvICYmIGJsYWNrR2VuZXJhbEluZm8gJiYgcmVkR2VuZXJhbEluZm8uYyA9PT0gYmxhY2tHZW5lcmFsSW5mby5jKSB7DQogICAgICAgIGxldCBoYXNQaWVjZUJldHdlZW4gPSBmYWxzZTsNCiAgICAgICAgY29uc3Qgc3RhcnRSID0gTWF0aC5taW4ocmVkR2VuZXJhbEluZm8uciwgYmxhY2tHZW5lcmFsSW5mby5yKSArIDE7DQogICAgICAgIGNvbnN0IGVuZFIgPSBNYXRoLm1heChyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpIC0gMTsNCiAgICAgICAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtyXVtyZWRHZW5lcmFsSW5mby5jXSkgew0KICAgICAgICAgICAgICAgIGhhc1BpZWNlQmV0d2VlbiA9IHRydWU7DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKCFoYXNQaWVjZUJldHdlZW4pIHsNCiAgICAgICAgICAgIHJlZElzSW5DaGVjayA9IHRydWU7DQogICAgICAgICAgICBibGFja0lzSW5DaGVjayA9IHRydWU7DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgYm9hcmRJbmZvLnJlZElzSW5DaGVjayA9IHJlZElzSW5DaGVjazsNCiAgICBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2sgPSBibGFja0lzSW5DaGVjazsNCn07DQoNCi8vIOedgOazleaOkuW6j+WHveaVsO+8muagueaNruS8mOWFiOe6p+aOkuW6j+edgOazlQ0KLy8g6KKr5bCG5pe277ya5ZCD5bCG5a2QID4g5Y+N5bCGID4g5YW25a6D5ZCD5a2QID4g6LWw5bCG6YCD6YC4ID4g5Z6r5bCGL+WFtuS9mQ0KLy8g5pyq6KKr5bCG5pe277yaDQovLyAxLiDkvJjlhYjlpITnkIbmiJHmlrnml6Dkv53miqTnmoTooqvljZXlkJHlqIHog4HnmoTmo4vlrZDmiafooYzpgIPot5HnnYDms5XvvIzlpoLmnInlpJrkuKrmo4vlrZDmjInmnZDmlpnlgLzku47pq5jliLDkvY7mjpLluo8NCi8vIDIuIOWFtuasoeWkhOeQhuaIkeaWueWNleWQkeWogeiDgeWvueaWueaXoOS/neaKpOaji+WtkOeahOaji+WtkOaJp+ihjOWQg+WtkOedgOazle+8jOWmguacieWkmuS4quaji+WtkOaMieaji+WtkOadkOaWmeWAvOS7jumrmOWIsOS9juaOkuW6jw0KLy8gMy4g5pyA5ZCO5aSE55CG5LiN5raJ5Y+K5ZCD5ZKM6KKr5ZCD55qE552A5rOV77yM6KaB5rGC6YG/5YWN56e75Yqo5Yiw6KKr5ZCD55qE5L2N572uDQpjb25zdCBzb3J0TW92ZXMgPSAobW92ZXMsIGJvYXJkLCBjdXJyZW50UGxheWVyLCBwaWVjZXNJbmZvLCBnYW1lU3RhZ2UgPSAnbWlkJywgYm9hcmRJbmZvID0gbnVsbCwgc2VhcmNoSGV1cmlzdGljcyA9IG51bGwpID0+IHsNCiAgICAvLyDkvb/nlKjkvKDlhaXnmoRnYW1lU3RhZ2Xlj4LmlbDvvIzpgb/lhY3ph43lpI3osIPnlKhnZXRHYW1lUGhhc2UNCiAgICANCiAgICAvLyDnlKjpooTorqHnrpfnmoTooqvlsIbnirbmgIHvvIjkuI3og73nlKggYm9hcmRJbmZvLmNoZWNrc++8mumCo+aYr+KAnOiwgeWcqOWwhuWGm+KAne+8jOS4jeaYr+KAnOiwgeiiq+WwhuKAne+8iQ0KICAgIGNvbnN0IGN1cnJlbnRJc0luQ2hlY2sgPSBib2FyZEluZm8NCiAgICAgICAgPyAoKGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnICYmIGJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8DQogICAgICAgICAgIChjdXJyZW50UGxheWVyID09PSAnYmxhY2snICYmIGJvYXJkSW5mby5ibGFja0lzSW5DaGVjaykpDQogICAgICAgIDogaXNDaGVjayhib2FyZCwgY3VycmVudFBsYXllcik7DQoNCiAgICAvLyDooqvlsIbml7bmlLbpm4bmraPlnKjlsIblhpvnmoTmlYzmlrnmo4vlrZDkvY3nva7vvIznlKjkuo7kvJjlhYjlkIPlsIblrZANCiAgICBsZXQgY2hlY2tlcktleXMgPSBudWxsOw0KICAgIGlmIChjdXJyZW50SXNJbkNoZWNrICYmIHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7DQogICAgICAgIGNvbnN0IGdlbmVyYWxJbmZvID0gcGllY2VzSW5mby5maW5kKA0KICAgICAgICAgICAgcCA9PiBwLnBpZWNlICYmIHAucGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnICYmIHAucGllY2UuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXINCiAgICAgICAgKTsNCiAgICAgICAgaWYgKGdlbmVyYWxJbmZvICYmIGdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgew0KICAgICAgICAgICAgY2hlY2tlcktleXMgPSBuZXcgU2V0KA0KICAgICAgICAgICAgICAgIGdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeQ0KICAgICAgICAgICAgICAgICAgICAuZmlsdGVyKHQgPT4gdC5waWVjZSAmJiB0LnBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKQ0KICAgICAgICAgICAgICAgICAgICAubWFwKHQgPT4gYCR7dC5yfSwke3QuY31gKQ0KICAgICAgICAgICAgKTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGNvbnN0IHR0TW92ZSA9IHNlYXJjaEhldXJpc3RpY3M/LnR0TW92ZSB8fCBudWxsOw0KICAgIGNvbnN0IGtpbGxlcnMgPSBzZWFyY2hIZXVyaXN0aWNzPy5raWxsZXJzIHx8IG51bGw7DQogICAgDQogICAgLy8g5Li65q+P5Liq552A5rOV6K6h566X5LyY5YWI57qn5YiG5pWw5bm25L+d5a2Y5Y6f5aeL57Si5byVDQogICAgLy8g5o6S5bqP5bGC57qn77yaVFQtbW92ZSA+IOW6lOWwhi/lkIPlrZDnrYnpnZnmgIHkvJjlhYjnuqcgPiBraWxsZXIgPiBoaXN0b3J5DQogICAgbW92ZXMuZm9yRWFjaCgobW92ZSwgaW5kZXgpID0+IHsNCiAgICAgICAgY29uc3QgeyBmcm9tLCB0byB9ID0gbW92ZTsNCiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtmcm9tLnJdW2Zyb20uY107DQogICAgICAgIGNvbnN0IHBpZWNlVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOw0KDQogICAgICAgIGNvbnN0IHRhcmdldFBpZWNlID0gYm9hcmRbdG8ucl1bdG8uY107DQogICAgICAgIGNvbnN0IHRhcmdldFBpZWNlVmFsdWUgPSB0YXJnZXRQaWVjZSA/IGdldE1hdGVyaWFsVmFsdWUodGFyZ2V0UGllY2UsIGdhbWVTdGFnZSkgOiAwOw0KICAgICAgICANCiAgICAgICAgbGV0IHByaW9yaXR5ID0gNDsNCiAgICAgICAgbGV0IHNjb3JlID0gMDsNCg0KICAgICAgICBpZiAodHRNb3ZlICYmIGlzU2FtZU1vdmUobW92ZSwgdHRNb3ZlKSkgew0KICAgICAgICAgICAgcHJpb3JpdHkgPSAtMTsNCiAgICAgICAgICAgIHNjb3JlID0gMTAwMDAwMDsNCiAgICAgICAgfSBlbHNlIGlmIChjdXJyZW50SXNJbkNoZWNrKSB7DQogICAgICAgICAgICAvLyDooqvlsIbvvJrlkIjms5XnnYDms5XlnYflt7Lop6PpmaTlsIblhpvvvJvkvJjlhYjlkIPlsIblrZDvvIzlhbbmrKHlkIPlrZAv5Yqo5bCG77yI5LiN5o6i5rWL5Y+N5bCG77yJDQogICAgICAgICAgICBjb25zdCBjYXB0dXJlc0NoZWNrZXIgPSB0YXJnZXRQaWVjZSAmJiBjaGVja2VyS2V5cyAmJiBjaGVja2VyS2V5cy5oYXMoYCR7dG8ucn0sJHt0by5jfWApOw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVzQ2hlY2tlcikgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMDsNCiAgICAgICAgICAgICAgICBzY29yZSA9IDEwMDAwICsgdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgICAgICAvLyBNVlYtTFZB77ya6LS15a2Q5LyY5YWI5ZCD44CB5L6/5a6c5a2Q5LyY5YWI5Y675ZCDDQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZSAqIDE2IC0gcGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gcGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSA0Ow0KICAgICAgICAgICAgICAgIHNjb3JlID0gMDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMgJiYgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgY29uc3QgaXNUaHJlYXRlbmVkUGllY2UgPSBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5zb21lKHAgPT4gcC5yID09PSBmcm9tLnIgJiYgcC5jID09PSBmcm9tLmMpOw0KICAgICAgICAgICAgaWYgKGlzVGhyZWF0ZW5lZFBpZWNlKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAxOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gcGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBpc0NhbkNhcHR1cmUgPSBib2FyZEluZm8uY2FuQ2FwdHVyZSAmJiBib2FyZEluZm8uY2FuQ2FwdHVyZS5zb21lKHAgPT4gcC5yID09PSB0by5yICYmIHAuYyA9PT0gdG8uYyk7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBpc0NhbkNhcHR1cmUgPyAyIDogMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gNDsNCiAgICAgICAgICAgICAgICBzY29yZSA9IDA7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoYm9hcmRJbmZvICYmIGJvYXJkSW5mby5jYW5DYXB0dXJlICYmIGJvYXJkSW5mby5jYW5DYXB0dXJlLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgIGNvbnN0IGlzQ2FuQ2FwdHVyZSA9IGJvYXJkSW5mby5jYW5DYXB0dXJlLnNvbWUocCA9PiBwLnIgPT09IHRvLnIgJiYgcC5jID09PSB0by5jKTsNCiAgICAgICAgICAgIGlmIChpc0NhbkNhcHR1cmUpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDI7DQogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gNDsNCiAgICAgICAgICAgICAgICBzY29yZSA9IDA7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgIC8vIOaXoOWogeiDgeihqOaXtu+8iOaQnOe0oui9u+mHj+i3r+W+hO+8ie+8mk1WVi1MVkEg5ZCD5a2Q5o6S5bqPDQogICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWUgKiAxNiAtIHBpZWNlVmFsdWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBwcmlvcml0eSA9IDQ7DQogICAgICAgICAgICBzY29yZSA9IDA7DQogICAgICAgIH0NCg0KICAgICAgICAvLyBraWxsZXIgLyBoaXN0b3J577ya5LiN6KaG55uWIFRUIOS4jumrmOS8mOWFiOe6p+WQg+WtkC/lupTlsIYNCiAgICAgICAgaWYgKHByaW9yaXR5ID49IDApIHsNCiAgICAgICAgICAgIGlmICghdGFyZ2V0UGllY2UgJiYga2lsbGVycyAmJiBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNbMF0pKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7DQogICAgICAgICAgICAgICAgc2NvcmUgKz0gODAwMDsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoIXRhcmdldFBpZWNlICYmIGtpbGxlcnMgJiYgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzWzFdKSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gTWF0aC5taW4ocHJpb3JpdHksIDIpOw0KICAgICAgICAgICAgICAgIHNjb3JlICs9IDcwMDA7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBzY29yZSArPSBnZXRIaXN0b3J5U2NvcmUobW92ZSk7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIG1vdmUucHJpb3JpdHkgPSBwcmlvcml0eTsNCiAgICAgICAgbW92ZS5zb3J0U2NvcmUgPSBzY29yZTsNCiAgICAgICAgbW92ZS5vcmlnaW5hbEluZGV4ID0gaW5kZXg7DQogICAgfSk7DQogICAgDQogICAgLy8g5qC55o2u5LyY5YWI57qn44CB5YiG5pWw5ZKM5Y6f5aeL57Si5byV5o6S5bqP552A5rOVDQogICAgbW92ZXMuc29ydCgoYSwgYikgPT4gew0KICAgICAgICAvLyDpppblhYjmjInkvJjlhYjnuqfmjpLluo/vvIzkvJjlhYjnuqcwID4gMSA+IDIgPiAzID4gNA0KICAgICAgICBpZiAoYS5wcmlvcml0eSAhPT0gYi5wcmlvcml0eSkgew0KICAgICAgICAgICAgcmV0dXJuIGEucHJpb3JpdHkgLSBiLnByaW9yaXR5Ow0KICAgICAgICB9DQogICAgICAgIC8vIOS8mOWFiOe6p+ebuOWQjOaXtu+8jOaMieWIhuaVsOS7jumrmOWIsOS9juaOkuW6jw0KICAgICAgICBpZiAoYS5zb3J0U2NvcmUgIT09IGIuc29ydFNjb3JlKSB7DQogICAgICAgICAgICByZXR1cm4gYi5zb3J0U2NvcmUgLSBhLnNvcnRTY29yZTsNCiAgICAgICAgfQ0KICAgICAgICAvLyDkvJjlhYjnuqflkozliIbmlbDpg73nm7jlkIzml7bvvIzmjInljp/lp4vntKLlvJXmjpLluo/vvIzkv53mjIHnqLPlrpoNCiAgICAgICAgcmV0dXJuIGEub3JpZ2luYWxJbmRleCAtIGIub3JpZ2luYWxJbmRleDsNCiAgICB9KTsNCiAgICANCiAgICByZXR1cm4gbW92ZXM7DQp9Ow0KDQovLyDlpITnkIbljZXkuKrmo4vlrZDnmoTmiYDmnIltb3Zlc++8jOiuoeeul+acuuWKqOaAp+OAgeWogeiDgeWSjOS/neaKpA0KY29uc3QgcHJvY2Vzc1BpZWNlTW92ZXMgPSAoYm9hcmQsIHBpZWNlc0luZm8sIGluZm8pID0+IHsNCiAgICBjb25zdCB7IHBpZWNlLCBtb3ZlcyB9ID0gaW5mbzsNCiAgICBjb25zdCB7IGJhc2VNb3ZlVmFsdWUgfSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eTsNCiAgICANCiAgICAvLyAxLiDorqHnrpfmnLrliqjmgKfvvJrnqbrkvY3nva7nmoTnp7vliqjmlbDph48NCiAgICBmb3IgKGNvbnN0IG1vdmUgb2YgbW92ZXMpIHsNCiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbbW92ZS5yXVttb3ZlLmNdOw0KICAgICAgICBpZiAoIXRhcmdldCkgew0KICAgICAgICAgICAgLy8g55uu5qCH5L2N572u5Li656m677yM6K6h566X5py65Yqo5oCnDQogICAgICAgICAgICBpbmZvLm1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgfQ0KICAgIH0NCn07DQoNCi8vIOajgOafpeebruagh+S9jee9ruaYr+WQpuWPr+aOpeWPl++8iOmBv+WFjeaYjuaYvumAgeWQgy/kuo/mjaLvvIkNCi8vIOS8mOWMlueJiO+8muaOpeWPl+mihOiuoeeul+eahGJvYXJkSW5mb+WSjHBpZWNlc0luZm/vvIzpgb/lhY3ph43lpI3orqHnrpcNCmNvbnN0IGlzUG9zaXRpb25BY2NlcHRhYmxlID0gKGJvYXJkLCBmcm9tLCB0bywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvID0gbnVsbCwgcGllY2VzSW5mbyA9IG51bGwsIHRyeU1vdmVQaWVjZSA9IG51bGwsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgY29uc3QgbW92aW5nUGllY2UgPSB0cnlNb3ZlUGllY2UgfHwgYm9hcmRbZnJvbS5yXVtmcm9tLmNdOw0KICAgIGNvbnN0IHRhcmdldFBpZWNlID0gYm9hcmRbdG8ucl1bdG8uY107DQogICAgY29uc3QgaXNDYXB0dXJlID0gdGFyZ2V0UGllY2UgJiYgdGFyZ2V0UGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXI7DQoNCiAgICAvLyDmlLbpm4bmiYDmnInmo4vlrZDkv6Hmga/vvIzlj6rlnKjmsqHmnInmj5Dkvpvml7borqHnrpcNCiAgICBsZXQgbG9jYWxQaWVjZXNJbmZvID0gcGllY2VzSW5mbzsNCiAgICBpZiAoIWxvY2FsUGllY2VzSW5mbykgew0KICAgICAgICBsb2NhbFBpZWNlc0luZm8gPSBbXTsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgYWxseUd1YXJkcyA9IFtdOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBtb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSwgYWxseUd1YXJkcyk7DQogICAgICAgICAgICAgICAgICAgIGxvY2FsUGllY2VzSW5mby5wdXNoKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlLA0KICAgICAgICAgICAgICAgICAgICAgICAgciwgYywgbW92ZXMsIGFsbHlHdWFyZHMsDQogICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlOiBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeTogW10sDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZDogW10sDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZGVkQnk6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdFZhbHVlOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICB0YWN0aWNWYWx1ZTogMA0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDorqHnrpfmo4vlrZDlhbPns7vlkozmjqfliLbkv6Hmga/vvIzlj6rlnKjmsqHmnInmj5Dkvpvml7borqHnrpcNCiAgICBsZXQgbG9jYWxCb2FyZEluZm8gPSBib2FyZEluZm87DQogICAgaWYgKCFsb2NhbEJvYXJkSW5mbykgew0KICAgICAgICBsb2NhbEJvYXJkSW5mbyA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpLm1hcCgoKSA9PiBbXSkpOw0KICAgICAgICBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyhib2FyZCwgbG9jYWxQaWVjZXNJbmZvLCBsb2NhbEJvYXJkSW5mbyk7DQogICAgfQ0KDQogICAgY29uc3QgY29udHJvbGxlcnMgPSBsb2NhbEJvYXJkSW5mb1t0by5yXVt0by5jXSB8fCBbXTsNCiAgICBsZXQgaGFzQWxseUNvbnRyb2xsZXIgPSBmYWxzZTsNCiAgICBsZXQgaGFzRW5lbXlDb250cm9sbGVyID0gZmFsc2U7DQoNCiAgICAvLyDmjqfliLbogIXlj6/og73mmK8gcGllY2VzSW5mbyDlvJXnlKgge3BpZWNlLHIsY30g5oiW5pen57uT5p6EIHtjb2xvcix0eXBlLHIsY30NCiAgICBjb25zdCBjb250cm9sbGVyQ29sb3IgPSAoY29udHJvbGxlcikgPT4NCiAgICAgICAgY29udHJvbGxlci5waWVjZSA/IGNvbnRyb2xsZXIucGllY2UuY29sb3IgOiBjb250cm9sbGVyLmNvbG9yOw0KDQogICAgZm9yIChjb25zdCBjb250cm9sbGVyIG9mIGNvbnRyb2xsZXJzKSB7DQogICAgICAgIC8vIOaOkumZpOato+WcqOenu+WKqOeahOaji+WtkOacrOi6q++8iOi1sOWQjuWug+S4jeWGjeS7juWOn+S9jeaOp+WItuebruagh++8iQ0KICAgICAgICBpZiAobW92aW5nUGllY2UgJiYgY29udHJvbGxlci5yID09PSBmcm9tLnIgJiYgY29udHJvbGxlci5jID09PSBmcm9tLmMpIHsNCiAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICB9DQogICAgICAgIGlmIChjb250cm9sbGVyQ29sb3IoY29udHJvbGxlcikgPT09IGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgICAgIGhhc0FsbHlDb250cm9sbGVyID0gdHJ1ZTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbGxlciA9IHRydWU7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBpZiAoaXNDYXB0dXJlKSB7DQogICAgICAgIC8vIOeZveWQg++8muebruagh+acquiiq+aVjOaWueS/neaKpA0KICAgICAgICBpZiAoIWhhc0VuZW15Q29udHJvbGxlcikgew0KICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgIH0NCiAgICAgICAgLy8g566A5Y2VIFNFRe+8muWFiOW+l+ebruagh+WIhu+8jOiLpeS8muiiq+WPjeWQg+WImeWGjeWkseW3seaWueaji+WtkA0KICAgICAgICBjb25zdCB0YXJnZXRWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUodGFyZ2V0UGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgIGNvbnN0IG91clZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZShtb3ZpbmdQaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgbGV0IHNlZSA9IHRhcmdldFZhbHVlIC0gb3VyVmFsdWU7DQogICAgICAgIC8vIOiLpeacieW3seaWuee7p+e7reS/neaKpO+8jOeyl+eVpeiupOS4uuWPr+iDveWGjeWQg+WbnuacgOS9juS7t+WAvOeahOaVjOaWueS/neaKpOiAhQ0KICAgICAgICBpZiAoaGFzQWxseUNvbnRyb2xsZXIpIHsNCiAgICAgICAgICAgIGNvbnN0IGVuZW15R3VhcmRWYWx1ZXMgPSBjb250cm9sbGVycw0KICAgICAgICAgICAgICAgIC5maWx0ZXIoYyA9PiBjb250cm9sbGVyQ29sb3IoYykgIT09IGN1cnJlbnRQbGF5ZXIgJiYgIShjLnIgPT09IGZyb20uciAmJiBjLmMgPT09IGZyb20uYykpDQogICAgICAgICAgICAgICAgLm1hcChjID0+IHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW2Mucl1bYy5jXTsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHAgPyBnZXRNYXRlcmlhbFZhbHVlKHAsIGdhbWVTdGFnZSkgOiAwOw0KICAgICAgICAgICAgICAgIH0pDQogICAgICAgICAgICAgICAgLmZpbHRlcih2ID0+IHYgPiAwKQ0KICAgICAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBhIC0gYik7DQogICAgICAgICAgICBpZiAoZW5lbXlHdWFyZFZhbHVlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgc2VlICs9IGVuZW15R3VhcmRWYWx1ZXNbMF07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgLy8g5piO5pi+5LqP5o2i77yI5aaC6L2m5o2i5peg5qC55YW15LiU5Lya6KKr5Y+N5ZCD77yJ5YiZ6L+H5ruk77yb5bmz5o2iL+i1muaNoueVmee7meaQnOe0og0KICAgICAgICByZXR1cm4gc2VlID49IDA7DQogICAgfQ0KDQogICAgLy8g6Z2e5ZCD5a2Q77ya55uu5qCH5LuF6KKr5pWM5pa55o6n5Yi25YiZ6KeG5Li66YCB5ZCDDQogICAgaWYgKGNvbnRyb2xsZXJzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICB9DQogICAgcmV0dXJuICFoYXNFbmVteUNvbnRyb2xsZXIgfHwgaGFzQWxseUNvbnRyb2xsZXI7DQp9Ow0KDQovLyDorqHnrpflronlhajlgLwNCi8vIOS5neWuq+S9jee9ruWumuS5ie+8mlvotbflp4vooYwsIOe7k+adn+ihjCwg6LW35aeL5YiXLCDnu5PmnZ/liJddIC0g56e75Yiw5Ye95pWw5aSW6YOo77yM6YG/5YWN6YeN5aSN5Yib5bu6DQpjb25zdCBQQUxBQ0VfUE9TSVRJT05TID0gew0KICAgIHJlZDogeyBzdGFydFJvdzogMCwgZW5kUm93OiAyLCBzdGFydENvbDogMywgZW5kQ29sOiA1IH0sIC8vIOe6ouaWueS5neWuq++8iOWwhueahOS9jee9ru+8iQ0KICAgIGJsYWNrOiB7IHN0YXJ0Um93OiA3LCBlbmRSb3c6IDksIHN0YXJ0Q29sOiAzLCBlbmRDb2w6IDUgfSAgLy8g6buR5pa55Lmd5a6r77yI5biF55qE5L2N572u77yJDQp9Ow0KDQovLyDljZLmnpfnur/lrprkuYkgLSDnp7vliLDlh73mlbDlpJbpg6jvvIzpgb/lhY3ph43lpI3liJvlu7oNCmNvbnN0IExJTkVMSU5FX1BPU0lUSU9OUyA9IHsNCiAgICByZWQ6IDMsICAvLyDnuqLmlrnljZLmnpfnur/vvIjpu5HlhbXpnIDopoHotoXov4fnmoTnur/vvIkNCiAgICBibGFjazogNiAgLy8g6buR5pa55Y2S5p6X57q/77yI57qi5YW16ZyA6KaB6LaF6L+H55qE57q/77yJDQp9Ow0KDQovLyDku45waWVjZXNJbmZv55Sf5oiQ5L2N572u5o6n5Yi25pig5bCE6KGoDQpjb25zdCBidWlsZFBvc2l0aW9uQ29udHJvbE1hcCA9IChwaWVjZXNJbmZvKSA9PiB7DQogICAgY29uc3QgcG9zaXRpb25Db250cm9sTWFwID0gbmV3IE1hcCgpOw0KICAgIA0KICAgIC8vIOmBjeWOhuaJgOacieaji+WtkO+8jOiusOW9leavj+S4quS9jee9rueahOaOp+WItuiAhQ0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIC8vIOajgOafpWNvbnRyb2zlsZ7mgKfmmK/lkKblrZjlnKjkuJTkuLrmlbDnu4QNCiAgICAgICAgaWYgKCFpbmZvLmNvbnRyb2wgfHwgIUFycmF5LmlzQXJyYXkoaW5mby5jb250cm9sKSkgew0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIOmBjeWOhuivpeaji+WtkOeahOaJgOacieaOp+WItueCuQ0KICAgICAgICBmb3IgKGNvbnN0IGNvbnRyb2xQb3Mgb2YgaW5mby5jb250cm9sKSB7DQogICAgICAgICAgICAvLyDmo4Dmn6Vjb250cm9sUG9z5piv5ZCm5pyJ5pWIDQogICAgICAgICAgICBpZiAoIWNvbnRyb2xQb3MgfHwgdHlwZW9mIGNvbnRyb2xQb3MuciAhPT0gJ251bWJlcicgfHwgdHlwZW9mIGNvbnRyb2xQb3MuYyAhPT0gJ251bWJlcicpIHsNCiAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7Y29udHJvbFBvcy5yfSwke2NvbnRyb2xQb3MuY31gOw0KICAgICAgICAgICAgaWYgKCFwb3NpdGlvbkNvbnRyb2xNYXAuaGFzKGtleSkpIHsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbkNvbnRyb2xNYXAuc2V0KGtleSwgW10pOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgLy8g6K6w5b2V5o6n5Yi26ICF55qE6aKc6Imy5ZKM5qOL5a2Q57G75Z6LDQogICAgICAgICAgICBwb3NpdGlvbkNvbnRyb2xNYXAuZ2V0KGtleSkucHVzaCh7DQogICAgICAgICAgICAgICAgY29sb3I6IGluZm8ucGllY2UuY29sb3IsDQogICAgICAgICAgICAgICAgdHlwZTogaW5mby5waWVjZS50eXBlDQogICAgICAgICAgICB9KTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICByZXR1cm4gcG9zaXRpb25Db250cm9sTWFwOw0KfTsNCg0KLy8gU0VFIOaOkuW6j+WkjeeUqOe8k+WGsu+8jOmZjeS9juWPtuivhOS8sCBHQw0KY29uc3Qgc2VlQXR0YWNrZXJTY3JhdGNoID0gW107DQpjb25zdCBzZWVHdWFyZFNjcmF0Y2ggPSBbXTsNCg0KLy8g5pyJ5qC55a2Q566A5YyWIFNFRe+8iOS4juaXp+WunueOsOmAkOihjOetieS7t++8ie+8m+avj+S4quebruagh+WPquW6lOiwg+eUqOS4gOasoQ0KY29uc3QgY2FsY3VsYXRlU3RhdGljRXhjaGFuZ2VTY29yZSA9ICh0aHJlYXRlbmVkUGllY2UpID0+IHsNCiAgICBjb25zdCBhdHRhY2tlcnMgPSBzZWVBdHRhY2tlclNjcmF0Y2g7DQogICAgY29uc3QgZ3VhcmRzID0gc2VlR3VhcmRTY3JhdGNoOw0KICAgIGF0dGFja2Vycy5sZW5ndGggPSAwOw0KICAgIGd1YXJkcy5sZW5ndGggPSAwOw0KICAgIGNvbnN0IHJhd0F0dGFja2VycyA9IHRocmVhdGVuZWRQaWVjZS50aHJlYXRlbmVkQnk7DQogICAgY29uc3QgcmF3R3VhcmRzID0gdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJhd0F0dGFja2Vycy5sZW5ndGg7IGkrKykgYXR0YWNrZXJzLnB1c2gocmF3QXR0YWNrZXJzW2ldKTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJhd0d1YXJkcy5sZW5ndGg7IGkrKykgZ3VhcmRzLnB1c2gocmF3R3VhcmRzW2ldKTsNCiAgICBhdHRhY2tlcnMuc29ydCgoYSwgYikgPT4gYS5tYXRlcmlhbFZhbHVlIC0gYi5tYXRlcmlhbFZhbHVlKTsNCiAgICBndWFyZHMuc29ydCgoYSwgYikgPT4gYS5tYXRlcmlhbFZhbHVlIC0gYi5tYXRlcmlhbFZhbHVlKTsNCg0KICAgIGxldCBleGNoYW5nZVNjb3JlID0gMDsNCiAgICBsZXQgYXR0YWNrZXJJbmRleCA9IDA7DQogICAgbGV0IGd1YXJkSW5kZXggPSAwOw0KICAgIGNvbnN0IHRhcmdldFZhbHVlID0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7DQoNCiAgICB3aGlsZSAoYXR0YWNrZXJJbmRleCA8IGF0dGFja2Vycy5sZW5ndGggJiYgZ3VhcmRJbmRleCA8IGd1YXJkcy5sZW5ndGgpIHsNCiAgICAgICAgaWYgKGd1YXJkSW5kZXggPT09IDApIHsNCiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gdGFyZ2V0VmFsdWU7DQogICAgICAgIH0NCiAgICAgICAgZXhjaGFuZ2VTY29yZSAtPSBhdHRhY2tlcnNbYXR0YWNrZXJJbmRleF0ubWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgaWYgKGF0dGFja2VySW5kZXggKyAxIDwgYXR0YWNrZXJzLmxlbmd0aCkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSBndWFyZHNbZ3VhcmRJbmRleF0ubWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgfQ0KICAgICAgICBhdHRhY2tlckluZGV4Kys7DQogICAgICAgIGd1YXJkSW5kZXgrKzsNCiAgICB9DQogICAgcmV0dXJuIGV4Y2hhbmdlU2NvcmU7DQp9Ow0KDQovLyDorqHnrpflqIHog4HlgLzvvIjln7rkuo7lrozmlbTnmoTlqIHog4HlhbPns7vvvIkNCi8vIOaMieiiq+WogeiDgeWtkOiBmuWQiO+8muavj+S4quebruagh+acgOWkmuS4gOasoSBTRUXvvJvliIblgLzliqDnu5kgdGhyZWF0ZW5lZEJ5WzBdDQovLyDvvIjlhbPns7vmnoTlu7rmjIkgcGllY2VzSW5mbyDpobrluo8gcHVzaO+8jOaVheS4juaXp+KAnOaUu+WHu+aWueWkluWxgumBjeWOhummluasoeiuoeWIhuKAneW9kuWxnuS4gOiHtO+8iQ0KY29uc3QgY2FsY3VsYXRlVGhyZWF0VmFsdWVzID0gKHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbyA9IG51bGwpID0+IHsNCiAgICAvLyDnu5/orqENCiAgICBpZiAoY3VycmVudFBsYXllcikgew0KICAgICAgICBwZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnRbY3VycmVudFBsYXllcl0rKzsNCiAgICB9DQoNCiAgICAvLyDliJ3lp4vljJblqIHog4Hnsbvlnovnu5/orqHkv6Hmga8NCiAgICBpZiAoYm9hcmRJbmZvKSB7DQogICAgICAgIGJvYXJkSW5mby5jaGVja3MgPSBbXTsgICAgICAvLyDlsIblhpvkv6Hmga8NCiAgICAgICAgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMgPSBbXTsgIC8vIOiiq+aNieeahOaji+WtkA0KICAgICAgICBib2FyZEluZm8uY2FuQ2FwdHVyZSA9IFtdOyAgLy8g5Y+v5ZCD55qE5qOL5a2QDQogICAgfQ0KDQogICAgY29uc3QgY2hlY2tCb251cyA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5jaGVjay5ib251czsNCiAgICBjb25zdCBjYW5DYXB0dXJlU2VlbiA9IG5ldyBTZXQoKTsNCg0KICAgIGZvciAobGV0IHRpID0gMDsgdGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgdGkrKykgew0KICAgICAgICBjb25zdCB0aHJlYXRlbmVkUGllY2UgPSBwaWVjZXNJbmZvW3RpXTsNCiAgICAgICAgY29uc3QgYXR0YWNrZXJzID0gdGhyZWF0ZW5lZFBpZWNlLnRocmVhdGVuZWRCeTsNCiAgICAgICAgaWYgKCFhdHRhY2tlcnMgfHwgYXR0YWNrZXJzLmxlbmd0aCA9PT0gMCkgY29udGludWU7DQoNCiAgICAgICAgLy8gdGhyZWF0ZW5lZEJ5WzBdID0gcGllY2VzSW5mbyDpobrluo/kuIvmnIDlhYjmjILkuIrlqIHog4HnmoTmlLvlh7vmlrnvvIjkuI7ml6fpppbmrKHorqHliIbkuIDoh7TvvIkNCiAgICAgICAgY29uc3QgZmlyc3RBdHRhY2tlciA9IGF0dGFja2Vyc1swXTsNCg0KICAgICAgICAvLyDlsIblhpvvvJrlj6rnu5nlsI/pop3lhYjmiYvliIbvvIznu53kuI3mjInlsIYv5biF5p2Q5paZ5YC85YGaIFNFRQ0KICAgICAgICBpZiAodGhyZWF0ZW5lZFBpZWNlLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkdFTkVSQUwpIHsNCiAgICAgICAgICAgIGlmIChib2FyZEluZm8pIHsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBhaSA9IDA7IGFpIDwgYXR0YWNrZXJzLmxlbmd0aDsgYWkrKykgew0KICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2hlY2tzLnB1c2goew0KICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrZXI6IGF0dGFja2Vyc1thaV0sDQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHRocmVhdGVuZWRQaWVjZSwNCiAgICAgICAgICAgICAgICAgICAgICAgIGlzQ2hlY2s6IHRydWUNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSBjaGVja0JvbnVzOw0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCg0KICAgICAgICBjb25zdCBoYXNHdWFyZCA9IHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnkgJiYgdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeS5sZW5ndGggPiAwOw0KDQogICAgICAgIC8vIOWPquaKiuWvueaUu+WHu+aWueacieWIqeeahOWogeiDgeiuoeWFpSB0aHJlYXRWYWx1Ze+8iOWNleWQkeiuoeWFpe+8jOS4jeWBmiBzYWZldHkg5a+556ew5omj5YiG77yJDQogICAgICAgIGlmICghaGFzR3VhcmQpIHsNCiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICBpZiAoYm9hcmRJbmZvKSB7DQogICAgICAgICAgICAgICAgLy8g5pS75Ye75pa55ZCM6Imy77ya6KaB5LmI5YWo5pivIGN1cnJlbnRQbGF5ZXLvvIjorrAgY2FuQ2FwdHVyZe+8ie+8jOimgeS5iOWFqOS4jeaYr++8iOiusCB0aHJlYXRlbmVkUGllY2Vz77yJDQogICAgICAgICAgICAgICAgaWYgKGZpcnN0QXR0YWNrZXIucGllY2UuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgYWkgPSAwOyBhaSA8IGF0dGFja2Vycy5sZW5ndGg7IGFpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBhdHRhY2tlcnNbYWldOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5DYXB0dXJlU2Vlbi5oYXMoaW5mbykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYW5DYXB0dXJlU2Vlbi5hZGQoaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLnB1c2godGhyZWF0ZW5lZFBpZWNlKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAvLyBTRUUg5q+P55uu5qCH5LiA5qyh77yb5pyJ5qC55LiU5Lqk5o2i5LuN6LWa5YiZ5oqY5Y2K6K6h5YWlDQogICAgICAgICAgICBjb25zdCBzc2VTY29yZSA9IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmUodGhyZWF0ZW5lZFBpZWNlKTsNCiAgICAgICAgICAgIGlmIChzc2VTY29yZSA+IDApIHsNCiAgICAgICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IHNzZVNjb3JlICogMC41Ow0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgLy8gc3NlU2NvcmUgPD0gMO+8muS6j+aNoi/lubPmjaLvvIzkuI3orrDlqIHog4HliIYNCiAgICAgICAgfQ0KICAgIH0NCn07DQoNCi8vIOiuoeeul+WuieWFqOWAvCAtIOmHjeaehOeJiO+8muWfuuS6jmJvYXJkSW5mb+eahOaOp+WItuWFs+ezuw0KY29uc3QgY2FsY3VsYXRlU2FmZXR5VmFsdWVzID0gKHBpZWNlc0luZm8sIGJvYXJkSW5mbykgPT4gew0KICAgIC8vIDEuIOaJvuWIsOWwhuWSjOW4hQ0KICAgIGNvbnN0IGdlbmVyYWxJbmZvID0gW107DQogICAgcGllY2VzSW5mby5mb3JFYWNoKGluZm8gPT4gew0KICAgICAgICBpZiAoaW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5HRU5FUkFMKSB7DQogICAgICAgICAgICBnZW5lcmFsSW5mby5wdXNoKGluZm8pOw0KICAgICAgICB9DQogICAgfSk7DQogICAgDQogICAgZm9yIChjb25zdCBnZW5lcmFsIG9mIGdlbmVyYWxJbmZvKSB7DQogICAgICAgIGNvbnN0IGdlbmVyYWxDb2xvciA9IGdlbmVyYWwucGllY2UuY29sb3I7DQogICAgICAgIGNvbnN0IGVuZW15Q29sb3IgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICANCiAgICAgICAgLy8g5qOA5p+l5bCG5biF55qE5o6n5Yi254K55piv5ZCm6KKr5pWM5pa55qOL5a2Q5o6n5Yi2DQogICAgICAgIGZvciAoY29uc3QgY29udHJvbFBvcyBvZiBnZW5lcmFsLmNvbnRyb2wpIHsNCiAgICAgICAgICAgIC8vIOiOt+WPluivpeaOp+WItueCueeahOaOp+WItuiAhQ0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBjb250cm9sUG9zOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25Db250cm9sbGVycyA9IGJvYXJkSW5mb1tyXVtjXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5qOA5p+l5piv5ZCm5pyJ5pWM5pa55qOL5a2Q5o6n5Yi26K+l5L2N572u77yI5YW85a65IHBpZWNlc0luZm8g5byV55So5LiO5penIHtjb2xvcn0g57uT5p6E77yJDQogICAgICAgICAgICBjb25zdCBoYXNFbmVteUNvbnRyb2wgPSBwb3NpdGlvbkNvbnRyb2xsZXJzLnNvbWUoY29udHJvbGxlciA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgY29sb3IgPSBjb250cm9sbGVyLnBpZWNlID8gY29udHJvbGxlci5waWVjZS5jb2xvciA6IGNvbnRyb2xsZXIuY29sb3I7DQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSBlbmVteUNvbG9yOw0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOWmguaenOS9jee9ruacieaVjOaWueaji+WtkOaOp+WItu+8jOaJozUw55qE5a6J5YWo5YC8DQogICAgICAgICAgICBpZiAoaGFzRW5lbXlDb250cm9sKSB7DQogICAgICAgICAgICAgICAgZ2VuZXJhbC5zYWZldHlWYWx1ZSAtPSA1MDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCn07DQoNCi8vIOW4ruWKqeWFs+ezu+aImOacr+WAvOiuoeeulw0KY29uc3QgY2FsY3VsYXRlQXNzaXN0VmFsdWUgPSAocGllY2VzSW5mbywgaW5mbykgPT4gew0KICAgIGNvbnN0IHsgcGllY2UsIHIsIGMgfSA9IGluZm87DQogICAgbGV0IGFzc2lzdFZhbHVlID0gMDsNCiAgICANCiAgICAvLyAxLiDmo4Dmn6XmmK/lkKbkuLrlt7Hmlrnngq7nmoTngq7mnrbvvIjliqDliIbvvIkNCiAgICBmb3IgKGNvbnN0IGFsbHlJbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGFsbHlJbmZvLnBpZWNlLmNvbG9yID09PSBwaWVjZS5jb2xvciAmJiBhbGx5SW5mbyAhPT0gaW5mbyAmJiBhbGx5SW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5DQU5OT04pIHsNCiAgICAgICAgICAgIC8vIOajgOafpeeCruWSjOW9k+WJjeaji+WtkOaYr+WQpuWcqOWQjOS4gOebtOe6v+S4ig0KICAgICAgICAgICAgaWYgKGFsbHlJbmZvLnIgPT09IHIgfHwgYWxseUluZm8uYyA9PT0gYykgew0KICAgICAgICAgICAgICAgIC8vIOajgOafpeeCruWSjOW9k+WJjeaji+WtkOS5i+mXtOaYr+WQpuayoeacieWFtuS7luaji+WtkA0KICAgICAgICAgICAgICAgIGxldCBoYXNTY3JlZW4gPSB0cnVlOw0KICAgICAgICAgICAgICAgIGlmIChhbGx5SW5mby5yID09PSByKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOihjA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKGFsbHlJbmZvLmMsIGMpICsgMTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoYWxseUluZm8uYywgYykgLSAxOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBjb2wgPSBzdGFydDsgY29sIDw9IGVuZDsgY29sKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJldHdlZW5QaWVjZSA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gciAmJiBwLmMgPT09IGNvbCk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYmV0d2VlblBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFzU2NyZWVuID0gZmFsc2U7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDliJcNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbihhbGx5SW5mby5yLCByKSArIDE7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KGFsbHlJbmZvLnIsIHIpIC0gMTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgcm93ID0gc3RhcnQ7IHJvdyA8PSBlbmQ7IHJvdysrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiZXR3ZWVuUGllY2UgPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHJvdyAmJiBwLmMgPT09IGMpOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJldHdlZW5QaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhc1NjcmVlbiA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChoYXNTY3JlZW4pIHsNCiAgICAgICAgICAgICAgICAgICAgYXNzaXN0VmFsdWUgKz0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmFzc2lzdC5jYW5ub25TY3JlZW5WYWx1ZTsgLy8g5Li65bex5pa554Ku5o+Q5L6b54Ku5p6277yM5aKe5Yqg5oiY5pyv5YC8DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIDIuIOajgOafpeaYr+WQpuS4uuaVjOaWueeCrueahOeCruaetu+8iOaJo+WIhu+8iQ0KICAgIGZvciAoY29uc3QgZW5lbXlJbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGVuZW15SW5mby5waWVjZS5jb2xvciAhPT0gcGllY2UuY29sb3IgJiYgZW5lbXlJbmZvLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkNBTk5PTikgew0KICAgICAgICAgICAgLy8g5qOA5p+l5pWM5pa554Ku5ZKM5b2T5YmN5qOL5a2Q5piv5ZCm5Zyo5ZCM5LiA55u057q/5LiKDQogICAgICAgICAgICBpZiAoZW5lbXlJbmZvLnIgPT09IHIgfHwgZW5lbXlJbmZvLmMgPT09IGMpIHsNCiAgICAgICAgICAgICAgICAvLyDmo4Dmn6XmlYzmlrnngq7lkozlvZPliY3mo4vlrZDkuYvpl7TmmK/lkKbmsqHmnInlhbbku5bmo4vlrZANCiAgICAgICAgICAgICAgICBsZXQgaXNFbmVteVNjcmVlbiA9IHRydWU7DQogICAgICAgICAgICAgICAgaWYgKGVuZW15SW5mby5yID09PSByKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOihjA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKGVuZW15SW5mby5jLCBjKSArIDE7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KGVuZW15SW5mby5jLCBjKSAtIDE7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGNvbCA9IHN0YXJ0OyBjb2wgPD0gZW5kOyBjb2wrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmV0d2VlblBpZWNlID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSByICYmIHAuYyA9PT0gY29sKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiZXR3ZWVuUGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0VuZW15U2NyZWVuID0gZmFsc2U7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDliJcNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbihlbmVteUluZm8uciwgcikgKyAxOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heChlbmVteUluZm8uciwgcikgLSAxOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCByb3cgPSBzdGFydDsgcm93IDw9IGVuZDsgcm93KyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJldHdlZW5QaWVjZSA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gcm93ICYmIHAuYyA9PT0gYyk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYmV0d2VlblBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNFbmVteVNjcmVlbiA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChpc0VuZW15U2NyZWVuKSB7DQogICAgICAgICAgICAgICAgICAgIGFzc2lzdFZhbHVlIC09IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5hc3Npc3QuY2Fubm9uU2NyZWVuVmFsdWU7IC8vIOS4uuaVjOaWueeCruaPkOS+m+eCruaetu+8jOWHj+WwkeaImOacr+WAvO+8iOaJo+WIhu+8iQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICByZXR1cm4gYXNzaXN0VmFsdWU7DQp9Ow0KDQovLyDpmLvmjKHlhbPns7vmiJjmnK/lgLzorqHnrpcNCmNvbnN0IGNhbGN1bGF0ZUJsb2NrVmFsdWUgPSAoYm9hcmQsIHBpZWNlc0luZm8sIGluZm8pID0+IHsNCiAgICBjb25zdCB7IHBpZWNlLCByLCBjIH0gPSBpbmZvOw0KICAgIGxldCBibG9ja1ZhbHVlID0gMDsNCiAgICBjb25zdCBlbmVteUNvbG9yID0gcGllY2UuY29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgIA0KICAgIC8vIDEuIOmYu+aMoeaVjOS6ug0KICAgIC8vIDEuMSDmo4Dmn6XmmK/lkKbpmLvmjKHlr7nmlrnovabnmoTpgZPot68NCiAgICBmb3IgKGNvbnN0IGVuZW15SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChlbmVteUluZm8ucGllY2UuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgZW5lbXlJbmZvLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkNIQVJJT1QpIHsNCiAgICAgICAgICAgIC8vIOajgOafpei9puWSjOW9k+WJjeaji+WtkOaYr+WQpuWcqOWQjOS4gOebtOe6v+S4ig0KICAgICAgICAgICAgaWYgKGVuZW15SW5mby5yID09PSByIHx8IGVuZW15SW5mby5jID09PSBjKSB7DQogICAgICAgICAgICAgICAgLy8g5qOA5p+l5Lik6ICF5LmL6Ze05piv5ZCm5rKh5pyJ5YW25a6D5qOL5a2QDQogICAgICAgICAgICAgICAgbGV0IGlzQmxvY2tpbmcgPSB0cnVlOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChlbmVteUluZm8uciA9PT0gcikgew0KICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDooYwNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbihlbmVteUluZm8uYywgYykgKyAxOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heChlbmVteUluZm8uYywgYykgLSAxOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBjb2wgPSBzdGFydDsgY29sIDw9IGVuZDsgY29sKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJldHdlZW5QaWVjZSA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gciAmJiBwLmMgPT09IGNvbCk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYmV0d2VlblBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNCbG9ja2luZyA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA5YiXDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oZW5lbXlJbmZvLnIsIHIpICsgMTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoZW5lbXlJbmZvLnIsIHIpIC0gMTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgcm93ID0gc3RhcnQ7IHJvdyA8PSBlbmQ7IHJvdysrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiZXR3ZWVuUGllY2UgPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHJvdyAmJiBwLmMgPT09IGMpOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJldHdlZW5QaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQmxvY2tpbmcgPSBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoaXNCbG9ja2luZykgew0KICAgICAgICAgICAgICAgICAgICAvLyDmo4Dmn6XmmK/lkKbpmLvmjKHkuobovabnmoTnp7vliqgNCiAgICAgICAgICAgICAgICAgICAgYmxvY2tWYWx1ZSArPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuYmxvY2suZW5lbXlDaGFyaW90QmxvY2tWYWx1ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8gMS4yIOajgOafpeaYr+WQpuWIq+WvueaWuemprOeahOmprOiFvw0KICAgIGZvciAoY29uc3QgZW5lbXlJbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGVuZW15SW5mby5waWVjZS5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBlbmVteUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuSE9SU0UpIHsNCiAgICAgICAgICAgIGNvbnN0IGhvcnNlUiA9IGVuZW15SW5mby5yOw0KICAgICAgICAgICAgY29uc3QgaG9yc2VDID0gZW5lbXlJbmZvLmM7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOmprOiFv+S9jee9ru+8mumprOeahOWRqOWbtDjkuKrmlrnlkJHnmoTohb/nmoTkvY3nva4NCiAgICAgICAgICAgIGNvbnN0IGxlZ1Bvc2l0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IHI6IGhvcnNlUiArIDEsIGM6IGhvcnNlQyB9LCAvLyDkuIvmlrnohb8NCiAgICAgICAgICAgICAgICB7IHI6IGhvcnNlUiAtIDEsIGM6IGhvcnNlQyB9LCAvLyDkuIrmlrnohb8NCiAgICAgICAgICAgICAgICB7IHI6IGhvcnNlUiwgYzogaG9yc2VDICsgMSB9LCAvLyDlj7Pmlrnohb8NCiAgICAgICAgICAgICAgICB7IHI6IGhvcnNlUiwgYzogaG9yc2VDIC0gMSB9ICAvLyDlt6bmlrnohb8NCiAgICAgICAgICAgIF07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOajgOafpeW9k+WJjeaji+WtkOaYr+WQpuWcqOmprOiFv+S9jee9rg0KICAgICAgICAgICAgZm9yIChjb25zdCBsZWdQb3Mgb2YgbGVnUG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgaWYgKGxlZ1Bvcy5yID09PSByICYmIGxlZ1Bvcy5jID09PSBjKSB7DQogICAgICAgICAgICAgICAgICAgIGJsb2NrVmFsdWUgKz0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmJsb2NrLmVuZW15SG9yc2VCbG9ja1ZhbHVlOyAvLyDliKvpqazohb/vvIzlop7liqDmiJjmnK/lgLwNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8gMS4zIOajgOafpeaYr+WQpuWgteWhnuWvueaWueixoeeahOixoeecvA0KICAgIGZvciAoY29uc3QgZW5lbXlJbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGVuZW15SW5mby5waWVjZS5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBlbmVteUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuRUxFUEhBTlQpIHsNCiAgICAgICAgICAgIGNvbnN0IGVsZXBoYW50UiA9IGVuZW15SW5mby5yOw0KICAgICAgICAgICAgY29uc3QgZWxlcGhhbnRDID0gZW5lbXlJbmZvLmM7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOixoeecvOS9jee9ru+8muixoeeahOWRqOWbtDTkuKrmlrnlkJHnmoTosaHnnLzkvY3nva4NCiAgICAgICAgICAgIGNvbnN0IGV5ZVBvc2l0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IHI6IGVsZXBoYW50UiArIDEsIGM6IGVsZXBoYW50QyArIDEgfSwgLy8g5Y+z5LiL6LGh55y8DQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgKyAxLCBjOiBlbGVwaGFudEMgLSAxIH0sIC8vIOW3puS4i+ixoeecvA0KICAgICAgICAgICAgICAgIHsgcjogZWxlcGhhbnRSIC0gMSwgYzogZWxlcGhhbnRDICsgMSB9LCAvLyDlj7PkuIrosaHnnLwNCiAgICAgICAgICAgICAgICB7IHI6IGVsZXBoYW50UiAtIDEsIGM6IGVsZXBoYW50QyAtIDEgfSAgLy8g5bem5LiK6LGh55y8DQogICAgICAgICAgICBdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmo4Dmn6XlvZPliY3mo4vlrZDmmK/lkKblnKjosaHnnLzkvY3nva4NCiAgICAgICAgICAgIGZvciAoY29uc3QgZXllUG9zIG9mIGV5ZVBvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGlmIChleWVQb3MuciA9PT0gciAmJiBleWVQb3MuYyA9PT0gYykgew0KICAgICAgICAgICAgICAgICAgICBibG9ja1ZhbHVlICs9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5ibG9jay5lbmVteUVsZXBoYW50QmxvY2tWYWx1ZTsgLy8g5aC15aGe6LGh55y877yM5aKe5Yqg5oiY5pyv5YC8DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIDIuIOmYu+aMoeW3seaWue+8iOaJo+WIhu+8iQ0KICAgIC8vIDIuMSDmo4Dmn6XmmK/lkKbpmLvmjKHlt7HmlrnovabnmoTpgZPot68NCiAgICBmb3IgKGNvbnN0IGFsbHlJbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGFsbHlJbmZvLnBpZWNlLmNvbG9yID09PSBwaWVjZS5jb2xvciAmJiBhbGx5SW5mbyAhPT0gaW5mbyAmJiBhbGx5SW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5DSEFSSU9UKSB7DQogICAgICAgICAgICAvLyDmo4Dmn6XovablkozlvZPliY3mo4vlrZDmmK/lkKblnKjlkIzkuIDnm7Tnur/kuIoNCiAgICAgICAgICAgIGlmIChhbGx5SW5mby5yID09PSByIHx8IGFsbHlJbmZvLmMgPT09IGMpIHsNCiAgICAgICAgICAgICAgICAvLyDmo4Dmn6XkuKTogIXkuYvpl7TmmK/lkKbmsqHmnInlhbblroPmo4vlrZANCiAgICAgICAgICAgICAgICBsZXQgaXNCbG9ja2luZyA9IHRydWU7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGFsbHlJbmZvLnIgPT09IHIpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA6KGMDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oYWxseUluZm8uYywgYykgKyAxOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heChhbGx5SW5mby5jLCBjKSAtIDE7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGNvbCA9IHN0YXJ0OyBjb2wgPD0gZW5kOyBjb2wrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmV0d2VlblBpZWNlID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSByICYmIHAuYyA9PT0gY29sKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiZXR3ZWVuUGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0Jsb2NraW5nID0gZmFsc2U7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDliJcNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbihhbGx5SW5mby5yLCByKSArIDE7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KGFsbHlJbmZvLnIsIHIpIC0gMTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgcm93ID0gc3RhcnQ7IHJvdyA8PSBlbmQ7IHJvdysrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiZXR3ZWVuUGllY2UgPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHJvdyAmJiBwLmMgPT09IGMpOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJldHdlZW5QaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQmxvY2tpbmcgPSBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoaXNCbG9ja2luZykgew0KICAgICAgICAgICAgICAgICAgICAvLyDpmLvmjKHlt7HmlrnovabpgZPot6/vvIzmiaPliIYNCiAgICAgICAgICAgICAgICAgICAgYmxvY2tWYWx1ZSAtPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuYmxvY2suYWxseUNoYXJpb3RCbG9ja1BlbmFsdHk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIDIuMiDmo4Dmn6XmmK/lkKbliKvlt7HmlrnpqaznmoTpqazohb8NCiAgICBmb3IgKGNvbnN0IGFsbHlJbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGFsbHlJbmZvLnBpZWNlLmNvbG9yID09PSBwaWVjZS5jb2xvciAmJiBhbGx5SW5mbyAhPT0gaW5mbyAmJiBhbGx5SW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5IT1JTRSkgew0KICAgICAgICAgICAgY29uc3QgaG9yc2VSID0gYWxseUluZm8ucjsNCiAgICAgICAgICAgIGNvbnN0IGhvcnNlQyA9IGFsbHlJbmZvLmM7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOmprOiFv+S9jee9ru+8mumprOeahOWRqOWbtDjkuKrmlrnlkJHnmoTohb/nmoTkvY3nva4NCiAgICAgICAgICAgIGNvbnN0IGxlZ1Bvc2l0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IHI6IGhvcnNlUiArIDEsIGM6IGhvcnNlQyB9LCAvLyDkuIvmlrnohb8NCiAgICAgICAgICAgICAgICB7IHI6IGhvcnNlUiAtIDEsIGM6IGhvcnNlQyB9LCAvLyDkuIrmlrnohb8NCiAgICAgICAgICAgICAgICB7IHI6IGhvcnNlUiwgYzogaG9yc2VDICsgMSB9LCAvLyDlj7Pmlrnohb8NCiAgICAgICAgICAgICAgICB7IHI6IGhvcnNlUiwgYzogaG9yc2VDIC0gMSB9ICAvLyDlt6bmlrnohb8NCiAgICAgICAgICAgIF07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOajgOafpeW9k+WJjeaji+WtkOaYr+WQpuWcqOmprOiFv+S9jee9rg0KICAgICAgICAgICAgZm9yIChjb25zdCBsZWdQb3Mgb2YgbGVnUG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgaWYgKGxlZ1Bvcy5yID09PSByICYmIGxlZ1Bvcy5jID09PSBjKSB7DQogICAgICAgICAgICAgICAgICAgIGJsb2NrVmFsdWUgLT0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmJsb2NrLmFsbHlIb3JzZUJsb2NrUGVuYWx0eTsgLy8g5Yir5bex5pa56ams6IW/77yM5omj5YiGDQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIDIuMyDmo4Dmn6XmmK/lkKbloLXloZ7lt7HmlrnosaHnmoTosaHnnLwNCiAgICBmb3IgKGNvbnN0IGFsbHlJbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGFsbHlJbmZvLnBpZWNlLmNvbG9yID09PSBwaWVjZS5jb2xvciAmJiBhbGx5SW5mbyAhPT0gaW5mbyAmJiBhbGx5SW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5FTEVQSEFOVCkgew0KICAgICAgICAgICAgY29uc3QgZWxlcGhhbnRSID0gYWxseUluZm8ucjsNCiAgICAgICAgICAgIGNvbnN0IGVsZXBoYW50QyA9IGFsbHlJbmZvLmM7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOixoeecvOS9jee9ru+8muixoeeahOWRqOWbtDTkuKrmlrnlkJHnmoTosaHnnLzkvY3nva4NCiAgICAgICAgICAgIGNvbnN0IGV5ZVBvc2l0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IHI6IGVsZXBoYW50UiArIDEsIGM6IGVsZXBoYW50QyArIDEgfSwgLy8g5Y+z5LiL6LGh55y8DQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgKyAxLCBjOiBlbGVwaGFudEMgLSAxIH0sIC8vIOW3puS4i+ixoeecvA0KICAgICAgICAgICAgICAgIHsgcjogZWxlcGhhbnRSIC0gMSwgYzogZWxlcGhhbnRDICsgMSB9LCAvLyDlj7PkuIrosaHnnLwNCiAgICAgICAgICAgICAgICB7IHI6IGVsZXBoYW50UiAtIDEsIGM6IGVsZXBoYW50QyAtIDEgfSAgLy8g5bem5LiK6LGh55y8DQogICAgICAgICAgICBdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmo4Dmn6XlvZPliY3mo4vlrZDmmK/lkKblnKjosaHnnLzkvY3nva4NCiAgICAgICAgICAgIGZvciAoY29uc3QgZXllUG9zIG9mIGV5ZVBvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGlmIChleWVQb3MuciA9PT0gciAmJiBleWVQb3MuYyA9PT0gYykgew0KICAgICAgICAgICAgICAgICAgICBibG9ja1ZhbHVlIC09IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5ibG9jay5hbGx5RWxlcGhhbnRCbG9ja1BlbmFsdHk7IC8vIOWgteWhnuW3seaWueixoeecvO+8jOaJo+WIhg0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICByZXR1cm4gYmxvY2tWYWx1ZTsNCn07DQoNCg0KLy8gLS0tIFR5cGVzIChJbmxpbmVkIHRvIGF2b2lkIGltcG9ydCBpc3N1ZXMgaW4gV29ya2VyKSAtLS0NCi8vIC8vIHR5cGUgQ29sb3IgLSBUeXBlU2NyaXB0IHR5cGUgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5ICdyZWQnIHwgJ2JsYWNrJzsNCi8vIC8vIHR5cGUgUGllY2VUeXBlIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAnZ2VuZXJhbCcgfCAnYWR2aXNvcicgfCAnZWxlcGhhbnQnIHwgJ2hvcnNlJyB8ICdjaGFyaW90JyB8ICdjYW5ub24nIHwgJ3NvbGRpZXInOw0KLy8gLy8gaW50ZXJmYWNlIFBpZWNlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQovLyAvLyBpbnRlcmZhY2UgUG9zaXRpb24gLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkNCi8vIC8vIGludGVyZmFjZSBNb3ZlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQovLyAvLyB0eXBlIEJvYXJkIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAoUGllY2UgfCBudWxsKVtdW107DQoNCi8vIC0tLSBPcGVuaW5nIEJvb2sgVHlwZXMgLS0tDQovLyBPcGVuaW5nIEJvb2sgRW50cnkgLSByZXByZXNlbnRzIHBvc3NpYmxlIG1vdmVzIGZvciBhIHBvc2l0aW9uDQovLyBpbnRlcmZhY2UgQm9va0VudHJ5IC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQoNCi8vIEluZGl2aWR1YWwgbW92ZSBpbiBvcGVuaW5nIGJvb2sgd2l0aCBtZXRhZGF0YQ0KLy8gaW50ZXJmYWNlIEJvb2tNb3ZlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQoNCi8vIC0tLSBab2JyaXN0IEhhc2hpbmcgZm9yIE9wZW5pbmcgQm9vayAtLS0NCi8vIEVhY2ggcGllY2UgdHlwZS9jb2xvci9wb3NpdGlvbiBnZXRzIGEgdW5pcXVlIHJhbmRvbSA1My1iaXQgaW50ZWdlcg0KLy8gVXNlcyBzZWVkZWQgUk5HIGZvciBkZXRlcm1pbmlzdGljIGhhc2hpbmcNCmNsYXNzIFpvYnJpc3RIYXNoZXIgew0KICAgIGhhc2hUYWJsZTsgIC8vIFtyb3ddW2NvbF1bcGllY2VJbmRleF0NCiAgICBwaWVjZVRvSW5kZXg7DQoNCiAgICBjb25zdHJ1Y3RvcigpIHsNCiAgICAgICAgdGhpcy5waWVjZVRvSW5kZXggPSBuZXcgTWFwKFsNCiAgICAgICAgICAgIFsncmVkLWdlbmVyYWwnLCAwXSwNCiAgICAgICAgICAgIFsncmVkLWFkdmlzb3InLCAxXSwNCiAgICAgICAgICAgIFsncmVkLWVsZXBoYW50JywgMl0sDQogICAgICAgICAgICBbJ3JlZC1ob3JzZScsIDNdLA0KICAgICAgICAgICAgWydyZWQtY2hhcmlvdCcsIDRdLA0KICAgICAgICAgICAgWydyZWQtY2Fubm9uJywgNV0sDQogICAgICAgICAgICBbJ3JlZC1zb2xkaWVyJywgNl0sDQogICAgICAgICAgICBbJ2JsYWNrLWdlbmVyYWwnLCA3XSwNCiAgICAgICAgICAgIFsnYmxhY2stYWR2aXNvcicsIDhdLA0KICAgICAgICAgICAgWydibGFjay1lbGVwaGFudCcsIDldLA0KICAgICAgICAgICAgWydibGFjay1ob3JzZScsIDEwXSwNCiAgICAgICAgICAgIFsnYmxhY2stY2hhcmlvdCcsIDExXSwNCiAgICAgICAgICAgIFsnYmxhY2stY2Fubm9uJywgMTJdLA0KICAgICAgICAgICAgWydibGFjay1zb2xkaWVyJywgMTNdLA0KICAgICAgICBdKTsNCg0KICAgICAgICAvLyBJbml0aWFsaXplIHJhbmRvbSBoYXNoIHZhbHVlcyB1c2luZyBzZWVkZWQgUk5HICg1My1iaXQgaW50ZWdlcnMgdG8gYXZvaWQgcHJlY2lzaW9uIGlzc3VlcykNCiAgICAgICAgdGhpcy5oYXNoVGFibGUgPSBbXTsNCiAgICAgICAgY29uc3QgTUFYX1NBRkUgPSAweDFGRkZGRkZGRkZGRkZGOyAvLyAyXjUzIC0gMQ0KICAgICAgICANCiAgICAgICAgLy8gU2ltcGxlIHNlZWRlZCBSTkcgKExDRyAtIExpbmVhciBDb25ncnVlbnRpYWwgR2VuZXJhdG9yKQ0KICAgICAgICBsZXQgc2VlZCA9IDEyMzQ1Njc4OTsgLy8gRml4ZWQgc2VlZCBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nDQogICAgICAgIGNvbnN0IHNlZWRlZFJhbmRvbSA9ICgpID0+IHsNCiAgICAgICAgICAgIHNlZWQgPSAoc2VlZCAqIDExMDM1MTUyNDUgKyAxMjM0NSkgJiAweDdmZmZmZmZmOw0KICAgICAgICAgICAgcmV0dXJuIHNlZWQgLyAweDdmZmZmZmZmOw0KICAgICAgICB9Ow0KDQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl0gPSBbXTsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY10gPSBbXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBwID0gMDsgcCA8IDE0OyBwKyspIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgZGV0ZXJtaW5pc3RpYyA1My1iaXQgaW50ZWdlcg0KICAgICAgICAgICAgICAgICAgICB0aGlzLmhhc2hUYWJsZVtyXVtjXVtwXSA9IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgLy8g5Y+26K+E5Lyw57yT5a2Y6ZSu77yaYm9hcmRIYXNoIF4gaW5pdGlhdG9yS2V5IF4gc3RhZ2VLZXkNCiAgICAgICAgdGhpcy5ldmFsSW5pdGlhdG9yS2V5cyA9IHsNCiAgICAgICAgICAgIHJlZDogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwNCiAgICAgICAgICAgIGJsYWNrOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpDQogICAgICAgIH07DQogICAgICAgIHRoaXMuZXZhbFN0YWdlS2V5cyA9IHsNCiAgICAgICAgICAgIGVhcmx5OiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpLA0KICAgICAgICAgICAgbWlkOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpLA0KICAgICAgICAgICAgbGF0ZTogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIHBpZWNlSW5kZXgocGllY2VPcktleSkgew0KICAgICAgICBpZiAocGllY2VPcktleSA9PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkOw0KICAgICAgICBpZiAodHlwZW9mIHBpZWNlT3JLZXkgPT09ICdzdHJpbmcnKSByZXR1cm4gdGhpcy5waWVjZVRvSW5kZXguZ2V0KHBpZWNlT3JLZXkpOw0KICAgICAgICByZXR1cm4gdGhpcy5waWVjZVRvSW5kZXguZ2V0KGAke3BpZWNlT3JLZXkuY29sb3J9LSR7cGllY2VPcktleS50eXBlfWApOw0KICAgIH0NCg0KICAgIGV2YWxDYWNoZUtleShib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpIHsNCiAgICAgICAgY29uc3Qgc3RhZ2VLZXkgPSB0aGlzLmV2YWxTdGFnZUtleXNbZ2FtZVN0YWdlXSB8fCB0aGlzLmV2YWxTdGFnZUtleXMubWlkOw0KICAgICAgICByZXR1cm4gdGhpcy5oYXNoKGJvYXJkKSBeIHRoaXMuZXZhbEluaXRpYXRvcktleXNbc2VhcmNoSW5pdGlhdG9yXSBeIHN0YWdlS2V5Ow0KICAgIH0NCg0KICAgIGV2YWxDYWNoZUtleUZyb21IYXNoKGJvYXJkSGFzaCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpIHsNCiAgICAgICAgY29uc3Qgc3RhZ2VLZXkgPSB0aGlzLmV2YWxTdGFnZUtleXNbZ2FtZVN0YWdlXSB8fCB0aGlzLmV2YWxTdGFnZUtleXMubWlkOw0KICAgICAgICByZXR1cm4gYm9hcmRIYXNoIF4gdGhpcy5ldmFsSW5pdGlhdG9yS2V5c1tzZWFyY2hJbml0aWF0b3JdIF4gc3RhZ2VLZXk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICog5pWw5YC8IFRUIGtlee+8muaKiuihjOaji+aWuee8lueggei/m+acgOS9juS9je+8jOmBv+WFjSBgaGFzaCBeIHNpZGVLZXlgIOWcqCBKUyBUb0ludDMyDQogICAgICog5LiL5Lqn55Sf6Leo57qi6buR56Kw5pKe77yI6YKj5Lya5L2/IFRUIOivr+WRveS4reW5tuaUueWPmOaQnOe0ouagkS/mo4vlipvvvInjgIINCiAgICAgKiDnrYnku7fkuo7ml6flrZfnrKbkuLIga2V5IGAke2hhc2h9OiR7c2lkZX1gIOeahOWMuuWIhuiDveWKm+OAgg0KICAgICAqLw0KICAgIHR0S2V5RnJvbUhhc2goYm9hcmRIYXNoLCBzaWRlKSB7DQogICAgICAgIGNvbnN0IGggPSBib2FyZEhhc2ggfCAwOyAvLyBePSDpk77nu5Pmnpzlt7LmmK8gSW50MzINCiAgICAgICAgcmV0dXJuIGggKiAyICsgKHNpZGUgPT09ICdyZWQnID8gMCA6IDEpOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENvbXB1dGUgaGFzaCBmb3IgYSBib2FyZCBwb3NpdGlvbg0KICAgICAqLw0KICAgIGhhc2goYm9hcmQpIHsNCiAgICAgICAgbGV0IGggPSAwOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGllY2VJZHggPSB0aGlzLnBpZWNlSW5kZXgocGllY2UpOw0KICAgICAgICAgICAgICAgICAgICBpZiAocGllY2VJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgaCBePSB0aGlzLmhhc2hUYWJsZVtyXVtjXVtwaWVjZUlkeF07DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIGg7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogTWlycm9yIGEgYm9hcmQgaG9yaXpvbnRhbGx5IChmb3Igc3ltbWV0cnkgZGV0ZWN0aW9uKQ0KICAgICAqLw0KICAgIG1pcnJvckJvYXJkKGJvYXJkKSB7DQogICAgICAgIGNvbnN0IG1pcnJvcmVkID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkpOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgbWlycm9yZWRbcl1bOCAtIGNdID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIG1pcnJvcmVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIE1pcnJvciBhIG1vdmUgaG9yaXpvbnRhbGx5DQogICAgICovDQogICAgbWlycm9yTW92ZShtb3ZlKSB7DQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiA4IC0gbW92ZS5mcm9tLmMgfSwNCiAgICAgICAgICAgIHRvOiB7IHI6IG1vdmUudG8uciwgYzogOCAtIG1vdmUudG8uYyB9DQogICAgICAgIH07DQogICAgfQ0KDQogICAgLyoqDQogICAgICogSW5jcmVtZW50YWxseSB1cGRhdGUgaGFzaCBhZnRlciBhIG1vdmUgKFhPUiDoh6rpgIbvvJrlho3osIPnlKjkuIDmrKHlj6/ov5jljp8pLg0KICAgICAqIG1vdmluZ1BpZWNlIC8gY2FwdHVyZWRQaWVjZSDlj6/kuLrmo4vlrZDlr7nosaHmiJYgJ2NvbG9yLXR5cGUnIOWtl+espuS4suOAgg0KICAgICAqIOmhu+WcqCBtYWtlTW92ZSDkuYvliY3lj5blvpcgbW92aW5nUGllY2XvvIxjYXB0dXJlZCDnlKggbWFrZU1vdmUg6L+U5Zue5YC844CCDQogICAgICovDQogICAgdXBkYXRlSGFzaChjdXJyZW50SGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgbGV0IG5ld0hhc2ggPSBjdXJyZW50SGFzaDsNCiAgICAgICAgY29uc3QgbW92aW5nSWR4ID0gdGhpcy5waWVjZUluZGV4KG1vdmluZ1BpZWNlKTsNCiAgICAgICAgaWYgKG1vdmluZ0lkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY11bbW92aW5nSWR4XTsNCiAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS50by5yXVttb3ZlLnRvLmNdW21vdmluZ0lkeF07DQogICAgICAgIH0NCiAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkSWR4ID0gdGhpcy5waWVjZUluZGV4KGNhcHR1cmVkUGllY2UpOw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUudG8ucl1bbW92ZS50by5jXVtjYXB0dXJlZElkeF07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIG5ld0hhc2g7DQogICAgfQ0KfQ0KDQovKioNCiAqIE9wZW5pbmcgQm9vayBNYW5hZ2VyDQogKi8NCmNsYXNzIE9wZW5pbmdCb29rIHsNCiAgICBib29rOyAgLy8gWm9icmlzdCBoYXNoIC0+IG1vdmVzDQogICAgaGFzaGVyOw0KICAgIGVuYWJsZWQ7DQogICAgbWF4UGx5OyAgLy8gTWF4aW11bSBwbHkgdG8gdXNlIG9wZW5pbmcgYm9vayAoZS5nLiwgMjApDQoNCiAgICBjb25zdHJ1Y3RvcihtYXhQbHkgPSAxMikgew0KICAgICAgICB0aGlzLmJvb2sgPSBuZXcgTWFwKCk7DQogICAgICAgIHRoaXMuaGFzaGVyID0gbmV3IFpvYnJpc3RIYXNoZXIoKTsNCiAgICAgICAgdGhpcy5lbmFibGVkID0gdHJ1ZTsNCiAgICAgICAgdGhpcy5tYXhQbHkgPSBtYXhQbHk7DQogICAgICAgIHRoaXMuaW5pdGlhbGl6ZUJvb2soKTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBJbml0aWFsaXplIHdpdGggY29tbW9uIENoaW5lc2UgQ2hlc3Mgb3BlbmluZ3MNCiAgICAgKi8NCiAgICBpbml0aWFsaXplQm9vaygpIHsNCiAgICAgICAgLy8gQWRkIGNsYXNzaWMgQ2hpbmVzZSBDaGVzcyBvcGVuaW5ncyBtYW51YWxseQ0KICAgICAgICANCiAgICAgICAgLyoNCiAgICAgICAgLy8gMS4g5Lit54Ku6L+H5rKz6L2m5a+55bGP6aOO6ams5bmz54Ku5a+56L2mIChDZW50cmFsIENhbm5vbiB2cyBTY3JlZW4gSG9yc2VzKQ0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lKFsNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA3LCBjOiA3IH0sIHRvOiB7IHI6IDcsIGM6IDQgfSB9LCAgLy8gMS4g54Ku5LqM5bmz5LqUDQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogNyB9LCB0bzogeyByOiAyLCBjOiA2IH0gfSwgIC8vIDEuLi4g6amsOOi/mzcNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA3IH0sIHRvOiB7IHI6IDcsIGM6IDYgfSB9LCAgLy8gMi4g6ams5LqM6L+b5LiJDQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogOCB9LCB0bzogeyByOiAwLCBjOiA3IH0gfSwgIC8vIDIuLi4g6L2mOeW5szggICAgICAgICAgIA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDggfSwgdG86IHsgcjogOSwgYzogNyB9IH0sICAvLyAzLiDovabkuIDlubPkuowNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAzLCBjOiA2IH0sIHRvOiB7IHI6IDQsIGM6IDYgfSB9LCAgLy8gMy4uLiDljZI36L+bMQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDcgfSwgdG86IHsgcjogMywgYzogNyB9IH0sICAvLyA0LiDovabkuozov5vlha0NCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiAxIH0sIHRvOiB7IHI6IDIsIGM6IDIgfSB9LCAgLy8gNC4uLiDpqawy6L+bMw0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDYsIGM6IDIgfSwgdG86IHsgcjogNSwgYzogMiB9IH0sICAvLyA1LiDlhbXkuIPov5vkuIANCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAyLCBjOiA3IH0sIHRvOiB7IHI6IDIsIGM6IDggfSB9LCAgLy8gNS4uLiDngq445bmzOQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDMsIGM6IDcgfSwgdG86IHsgcjogMywgYzogNiB9IH0sICAvLyA2LiDovabkuozlubPkuIkNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAyLCBjOiA4IH0sIHRvOiB7IHI6IDEsIGM6IDggfSB9LCAgLy8gNi4uLiDngq456YCAMSAgICAgICAgICANCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCg0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKFsNCiAgICAgICAgICAgICfngq7kuozlubPkupQnLCAn6amsOOi/mzcnLCAn6ams5LqM6L+b5LiJJywgJ+i9pjnlubM4JywgJ+i9puS4gOW5s+S6jCcsICfljZI36L+bMScsDQogICAgICAgICAgICAn6L2m5LqM6L+b5YWtJywgJ+mprDLov5szJywgJ+WFteS4g+i/m+S4gCcsICfngq445bmzOScsICfovabkuozlubPkuIknLCAn54KuOemAgDEnLA0KICAgICAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCg0KICAgICAgICAgICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKFsNCiAgICAgICAgICAgICfngq7kuozlubPkupQg6amsOOi/mzcg6ams5LqM6L+b5LiJIOi9pjnlubM4IOi9puS4gOW5s+S6jCDljZI36L+bMSDovabkuozov5vlha0g6amsMui/mzMg5YW15LiD6L+b5LiAIOeCrjjlubM5IOi9puS6jOW5s+S4iSDngq456YCAMScNCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCiAgICAgICAgKi8NCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBBZGQgYW4gb3BlbmluZyBsaW5lIHRvIHRoZSBib29rDQogICAgICogQHBhcmFtIG1vdmVzIEFycmF5IG9mIG1vdmVzIHJlcHJlc2VudGluZyBhbiBvcGVuaW5nIGxpbmUNCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCB3ZWlnaHRzIGZvciBlYWNoIG1vdmUgKGRlZmF1bHQgMTAwIGZvciBhbGwpDQogICAgICovDQogICAgYWRkT3BlbmluZ0xpbmUobW92ZXMsIHdlaWdodHMpIHsNCiAgICAgICAgLy8gU3RhcnQgd2l0aCBpbml0aWFsIGJvYXJkIHBvc2l0aW9uDQogICAgICAgIGNvbnN0IGJvYXJkID0gdGhpcy5jcmVhdGVJbml0aWFsQm9hcmQoKTsNCiAgICAgICAgbGV0IGN1cnJlbnRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChib2FyZCk7DQoNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtb3Zlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2ldOw0KICAgICAgICAgICAgY29uc3Qgd2VpZ2h0ID0gd2VpZ2h0cz8uW2ldID8/IDEwMDsNCg0KICAgICAgICAgICAgLy8gR2V0IG9yIGNyZWF0ZSBib29rIGVudHJ5IGZvciB0aGlzIHBvc2l0aW9uDQogICAgICAgICAgICBsZXQgZW50cnkgPSB0aGlzLmJvb2suZ2V0KGN1cnJlbnRIYXNoKTsNCiAgICAgICAgICAgIGlmICghZW50cnkpIHsNCiAgICAgICAgICAgICAgICBlbnRyeSA9IHsgbW92ZXM6IFtdIH07DQogICAgICAgICAgICAgICAgdGhpcy5ib29rLnNldChjdXJyZW50SGFzaCwgZW50cnkpOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBBZGQgbW92ZSBpZiBub3QgYWxyZWFkeSBwcmVzZW50DQogICAgICAgICAgICBjb25zdCBleGlzdGluZ01vdmUgPSBlbnRyeS5tb3Zlcy5maW5kKA0KICAgICAgICAgICAgICAgIG0gPT4gbS5mcm9tLnIgPT09IG1vdmUuZnJvbS5yICYmIG0uZnJvbS5jID09PSBtb3ZlLmZyb20uYyAmJg0KICAgICAgICAgICAgICAgICAgICAgbS50by5yID09PSBtb3ZlLnRvLnIgJiYgbS50by5jID09PSBtb3ZlLnRvLmMNCiAgICAgICAgICAgICk7DQoNCiAgICAgICAgICAgIGlmICghZXhpc3RpbmdNb3ZlKSB7DQogICAgICAgICAgICAgICAgZW50cnkubW92ZXMucHVzaCh7DQogICAgICAgICAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sDQogICAgICAgICAgICAgICAgICAgIHRvOiB7IHI6IG1vdmUudG8uciwgYzogbW92ZS50by5jIH0sDQogICAgICAgICAgICAgICAgICAgIHdlaWdodDogd2VpZ2h0DQogICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSB3ZWlnaHQgaWYgbW92ZSBhbHJlYWR5IGV4aXN0cyAodGFrZSBtYXhpbXVtKQ0KICAgICAgICAgICAgICAgIGV4aXN0aW5nTW92ZS53ZWlnaHQgPSBNYXRoLm1heChleGlzdGluZ01vdmUud2VpZ2h0LCB3ZWlnaHQpOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBNYWtlIHRoZSBtb3ZlIG9uIHRoZSBib2FyZA0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBib2FyZFttb3ZlLnRvLnJdW21vdmUudG8uY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghcGllY2UpIGJyZWFrOyAvLyBJbnZhbGlkIGxpbmUNCg0KICAgICAgICAgICAgY29uc3QgcGllY2VLZXkgPSBgJHtwaWVjZS5jb2xvcn0tJHtwaWVjZS50eXBlfWA7DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGNhcHR1cmVkID8gYCR7Y2FwdHVyZWQuY29sb3J9LSR7Y2FwdHVyZWQudHlwZX1gIDogdW5kZWZpbmVkOw0KDQogICAgICAgICAgICAvLyBVcGRhdGUgaGFzaCBpbmNyZW1lbnRhbGx5DQogICAgICAgICAgICBjdXJyZW50SGFzaCA9IHRoaXMuaGFzaGVyLnVwZGF0ZUhhc2goY3VycmVudEhhc2gsIG1vdmUsIHBpZWNlS2V5LCBjYXB0dXJlZEtleSk7DQoNCiAgICAgICAgICAgIC8vIEFwcGx5IG1vdmUNCiAgICAgICAgICAgIGJvYXJkW21vdmUudG8ucl1bbW92ZS50by5jXSA9IHBpZWNlOw0KICAgICAgICAgICAgYm9hcmRbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXSA9IG51bGw7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBHZXQgYmVzdCBtb3ZlIGZyb20gb3BlbmluZyBib29rIGZvciBjdXJyZW50IHBvc2l0aW9uDQogICAgICogQHBhcmFtIGJvYXJkIEN1cnJlbnQgYm9hcmQgc3RhdGUNCiAgICAgKiBAcGFyYW0gcGx5IEN1cnJlbnQgcGx5IG51bWJlciAoMCA9IHN0YXJ0IG9mIGdhbWUpDQogICAgICogQHJldHVybnMgTW92ZSBmcm9tIGJvb2ssIG9yIG51bGwgaWYgcG9zaXRpb24gbm90IGluIGJvb2sNCiAgICAgKi8NCiAgICBnZXRCb29rTW92ZShib2FyZCwgcGx5KXsNCiAgICAgICAgLy8gRG9uJ3QgdXNlIGJvb2sgaWYgZGlzYWJsZWQgb3IgcGFzdCBtYXggcGx5DQogICAgICAgIGlmICghdGhpcy5lbmFibGVkIHx8IHBseSA+PSB0aGlzLm1heFBseSkgew0KICAgICAgICAgICAgY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBkaXNhYmxlZCBvciBwYXN0IG1heCBwbHknLCB7IGVuYWJsZWQ6IHRoaXMuZW5hYmxlZCwgbWF4UGx5OiB0aGlzLm1heFBseSwgcGx5OiBwbHkgfSk7DQogICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy9jb25zb2xlLmxvZygnT3BlbmluZyBib29rIGdldEJvb2tNb3ZlIGNhbGxlZCcsIHsgcGx5IH0pOw0KICAgICAgICANCiAgICAgICAgLy8gVHJ5IHRvIGZpbmQgbW92ZSBmb3IgY3VycmVudCBwb3NpdGlvbg0KICAgICAgICBjb25zdCBoYXNoID0gdGhpcy5oYXNoZXIuaGFzaChib2FyZCk7DQogICAgICAgIC8vY29uc29sZS5sb2coJ0N1cnJlbnQgcG9zaXRpb24gaGFzaDonLCBoYXNoKTsNCiAgICAgICAgDQogICAgICAgIGxldCBlbnRyeSA9IHRoaXMuYm9vay5nZXQoaGFzaCk7DQogICAgICAgIC8vY29uc29sZS5sb2coJ0VudHJ5IGZvdW5kIGZvciBjdXJyZW50IGhhc2g6JywgZW50cnkgPyBlbnRyeS5tb3Zlcy5sZW5ndGggKyAnIG1vdmVzJyA6ICdudWxsJyk7DQogICAgICAgIGlmIChlbnRyeSAmJiBlbnRyeS5tb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnQWxsIHBvc3NpYmxlIGJvb2sgbW92ZXMgd2l0aCB3ZWlnaHRzOicsIEpTT04uc3RyaW5naWZ5KGVudHJ5Lm1vdmVzKSk7DQogICAgICAgICAgICAvLyBDYWxjdWxhdGUgdG90YWwgd2VpZ2h0DQogICAgICAgICAgICBjb25zdCB0b3RhbFdlaWdodCA9IGVudHJ5Lm1vdmVzLnJlZHVjZSgoc3VtLCBtb3ZlKSA9PiBzdW0gKyBtb3ZlLndlaWdodCwgMCk7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnVG90YWwgd2VpZ2h0OicsIHRvdGFsV2VpZ2h0KTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgbGV0IG1pcnJvcmVkTW92ZSA9IGZhbHNlOw0KDQogICAgICAgIC8vIElmIG5vdCBmb3VuZCwgdHJ5IG1pcnJvcmVkIHBvc2l0aW9uDQogICAgICAgIGlmICghZW50cnkgfHwgZW50cnkubW92ZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICBjb25zdCBtaXJyb3JlZEJvYXJkID0gdGhpcy5oYXNoZXIubWlycm9yQm9hcmQoYm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgbWlycm9yZWRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChtaXJyb3JlZEJvYXJkKTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdObyBlbnRyeSBmb3VuZCwgdHJ5aW5nIG1pcnJvcmVkIHBvc2l0aW9uOicsIG1pcnJvcmVkSGFzaCk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGVudHJ5ID0gdGhpcy5ib29rLmdldChtaXJyb3JlZEhhc2gpOw0KICAgICAgICAgICAgaWYgKGVudHJ5ICYmIGVudHJ5Lm1vdmVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdFbnRyeSBmb3VuZCBmb3IgbWlycm9yZWQgaGFzaDonLCBlbnRyeS5tb3Zlcy5sZW5ndGggKyAnIG1vdmVzJyk7DQogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnT3JpZ2luYWwgbWlycm9yIG1vdmVzOicsIEpTT04uc3RyaW5naWZ5KGVudHJ5Lm1vdmVzKSk7DQogICAgICAgICAgICAgICAgbWlycm9yZWRNb3ZlID0gdHJ1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnTm8gZW50cnkgZm91bmQgZm9yIG1pcnJvcmVkIGhhc2gnKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIGlmICghZW50cnkgfHwgZW50cnkubW92ZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgbW92ZSBub3QgZm91bmQgZm9yIGN1cnJlbnQgcG9zaXRpb24nKTsNCiAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICB9DQoNCiAgICAgICAgLy8gU2VsZWN0IG1vdmUgYmFzZWQgb24gd2VpZ2h0cw0KICAgICAgICBjb25zdCBzZWxlY3RlZE1vdmUgPSB0aGlzLnNlbGVjdFdlaWdodGVkTW92ZShlbnRyeS5tb3Zlcyk7DQogICAgICAgIGNvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgbW92ZSBzZWxlY3RlZDonLCBzZWxlY3RlZE1vdmUpOw0KICAgICAgICANCiAgICAgICAgLy8gSWYgd2UgdXNlZCBtaXJyb3JlZCBwb3NpdGlvbiwgbWlycm9yIHRoZSBtb3ZlIGJhY2sNCiAgICAgICAgaWYgKHNlbGVjdGVkTW92ZSAmJiBtaXJyb3JlZE1vdmUpIHsNCiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdTZWxlY3RlZCBtaXJyb3IgbW92ZSBiZWZvcmUgY29udmVyc2lvbjonLCBKU09OLnN0cmluZ2lmeShzZWxlY3RlZE1vdmUpKTsNCiAgICAgICAgICAgIGNvbnN0IG1pcnJvcmVkTW92ZUNvbnZlcnRlZCA9IHRoaXMuaGFzaGVyLm1pcnJvck1vdmUoc2VsZWN0ZWRNb3ZlKTsNCiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdDb252ZXJ0ZWQgbWlycm9yIG1vdmU6JywgSlNPTi5zdHJpbmdpZnkobWlycm9yZWRNb3ZlQ29udmVydGVkKSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBtaXJyb3JlZCBtb3ZlIGhhcyB2YWxpZCBzdHJ1Y3R1cmUNCiAgICAgICAgICAgIGlmIChtaXJyb3JlZE1vdmVDb252ZXJ0ZWQgJiYgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20gJiYgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50by5jID09PSAnbnVtYmVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQ7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdNaXJyb3JlZCBtb3ZlIGhhcyBpbnZhbGlkIHN0cnVjdHVyZSwgcmV0dXJuaW5nIG51bGwnKTsNCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmIChzZWxlY3RlZE1vdmUpIHsNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBzZWxlY3RlZCBtb3ZlIGhhcyB2YWxpZCBzdHJ1Y3R1cmUNCiAgICAgICAgICAgIGlmIChzZWxlY3RlZE1vdmUuZnJvbSAmJiBzZWxlY3RlZE1vdmUudG8gJiYNCiAgICAgICAgICAgICAgICB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLmZyb20uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIHNlbGVjdGVkTW92ZS5mcm9tLmMgPT09ICdudW1iZXInICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIHNlbGVjdGVkTW92ZS50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHNlbGVjdGVkTW92ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlbGVjdGVkIG1vdmUgaGFzIGludmFsaWQgc3RydWN0dXJlLCByZXR1cm5pbmcgbnVsbCcpOw0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICByZXR1cm4gbnVsbDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBTZWxlY3QgYSBtb3ZlIHJhbmRvbWx5IGJhc2VkIG9uIHdlaWdodHMNCiAgICAgKiBIaWdoZXIgd2VpZ2h0ID0gbW9yZSBsaWtlbHkgdG8gYmUgc2VsZWN0ZWQNCiAgICAgKi8NCiAgICBzZWxlY3RXZWlnaHRlZE1vdmUobW92ZXMpIHsNCiAgICAgICAgLy8gQ2FsY3VsYXRlIHRvdGFsIHdlaWdodA0KICAgICAgICBjb25zdCB0b3RhbFdlaWdodCA9IG1vdmVzLnJlZHVjZSgoc3VtLCBtb3ZlKSA9PiBzdW0gKyBtb3ZlLndlaWdodCwgMCk7DQoNCiAgICAgICAgLy8gR2VuZXJhdGUgcmFuZG9tIG51bWJlcg0KICAgICAgICBsZXQgcmFuZG9tID0gTWF0aC5yYW5kb20oKSAqIHRvdGFsV2VpZ2h0Ow0KDQogICAgICAgIC8vIFNlbGVjdCBtb3ZlDQogICAgICAgIGZvciAoY29uc3QgbW92ZSBvZiBtb3Zlcykgew0KICAgICAgICAgICAgcmFuZG9tIC09IG1vdmUud2VpZ2h0Ow0KICAgICAgICAgICAgaWYgKHJhbmRvbSA8PSAwKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogbW92ZS5mcm9tLmMgfSwgdG86IHsgcjogbW92ZS50by5yLCBjOiBtb3ZlLnRvLmMgfQ0KICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICAvLyBGYWxsYmFjayAoc2hvdWxkIG5ldmVyIHJlYWNoIGhlcmUpDQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmVzWzBdLmZyb20uciwgYzogbW92ZXNbMF0uZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmVzWzBdLnRvLnIsIGM6IG1vdmVzWzBdLnRvLmMgfQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEhlbHBlciB0byBjcmVhdGUgaW5pdGlhbCBib2FyZCAobmVlZGVkIGZvciBib29rIGluaXRpYWxpemF0aW9uKQ0KICAgICAqLw0KICAgIGNyZWF0ZUluaXRpYWxCb2FyZCgpIHsNCiAgICAgICAgY29uc3QgYm9hcmQgPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKSk7DQogICAgICAgIA0KICAgICAgICAvLyBSZWQgcGllY2VzIChib3R0b20gLSByPTAtMikNCiAgICAgICAgYm9hcmRbMF1bMF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzFdID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bMl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVszXSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bNF0gPSB7IHR5cGU6ICdnZW5lcmFsJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzVdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs2XSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzddID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bOF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzJdWzFdID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzJdWzddID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzBdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVsyXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bNF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzZdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVs4XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCg0KICAgICAgICAvLyBCbGFjayBwaWVjZXMgKHRvcCAtIHI9Ny05KQ0KICAgICAgICBib2FyZFs5XVswXSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVsxXSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bMl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzNdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzRdID0geyB0eXBlOiAnZ2VuZXJhbCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzVdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzZdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs3XSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bOF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbN11bMV0gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs3XVs3XSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzBdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzJdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzRdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzZdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzhdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQoNCiAgICAgICAgcmV0dXJuIGJvYXJkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEVuYWJsZSBvciBkaXNhYmxlIG9wZW5pbmcgYm9vaw0KICAgICAqLw0KICAgIHNldEVuYWJsZWQoZW5hYmxlZCkgew0KICAgICAgICB0aGlzLmVuYWJsZWQgPSBlbmFibGVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENoZWNrIGlmIG9wZW5pbmcgYm9vayBpcyBlbmFibGVkDQogICAgICovDQogICAgaXNFbmFibGVkKCkgew0KICAgICAgICByZXR1cm4gdGhpcy5lbmFibGVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEdldCBzdGF0aXN0aWNzIGFib3V0IHRoZSBvcGVuaW5nIGJvb2sNCiAgICAgKi8NCiAgICBnZXRTdGF0cygpIHsNCiAgICAgICAgbGV0IHRvdGFsTW92ZXMgPSAwOw0KICAgICAgICB0aGlzLmJvb2suZm9yRWFjaChlbnRyeSA9PiB7DQogICAgICAgICAgICB0b3RhbE1vdmVzICs9IGVudHJ5Lm1vdmVzLmxlbmd0aDsNCiAgICAgICAgfSk7DQoNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIHBvc2l0aW9uczogdGhpcy5ib29rLnNpemUsDQogICAgICAgICAgICB0b3RhbE1vdmVzDQogICAgICAgIH07DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQWRkIG9wZW5pbmcgbGluZSBmcm9tIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24NCiAgICAgKiBAcGFyYW0gbm90YXRpb24gQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uIChlLmcuLCBbJ+eCruS6jOW5s+S6lCcsICfpqaw46L+bNyddKQ0KICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIGFycmF5IG9mIHdlaWdodHMgZm9yIGVhY2ggbW92ZQ0KICAgICAqLw0KICAgIGFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKG5vdGF0aW9uLCB3ZWlnaHRzKSB7DQogICAgICAgIC8vIENvbnZlcnQgdHJhZGl0aW9uYWwgbm90YXRpb24gdG8gY29vcmRpbmF0ZSBmb3JtYXQNCiAgICAgICAgY29uc3QgbW92ZXMgPSB0aGlzLm5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvbik7DQogICAgICAgIC8vIEFkZCB0aGUgbW92ZXMgdG8gdGhlIG9wZW5pbmcgYm9vaw0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lKG1vdmVzLCB3ZWlnaHRzKTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBBZGQgb3BlbmluZyBsaW5lIGZyb20gc3RyaW5nIHdpdGggc3BhY2Utc2VwYXJhdGVkIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24NCiAgICAgKiBAcGFyYW0gbm90YXRpb25BcnJheSBBcnJheSBvZiBzdHJpbmdzLCBlYWNoIGNvbnRhaW5pbmcgc3BhY2Utc2VwYXJhdGVkIG1vdmVzIChlLmcuLCBbJ+eCruS6jOW5s+S6lCDpqaw46L+bNyDovabkuIDlubPkuownXSkNCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCBhcnJheSBvZiB3ZWlnaHRzIGZvciBlYWNoIG1vdmUNCiAgICAgKi8NCiAgICBhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcobm90YXRpb25BcnJheSwgd2VpZ2h0cykgew0KICAgICAgICAvLyBQcm9jZXNzIGVhY2ggc3RyaW5nIGluIHRoZSBhcnJheQ0KICAgICAgICBpZiAoIW5vdGF0aW9uQXJyYXkgfHwgIUFycmF5LmlzQXJyYXkobm90YXRpb25BcnJheSkgfHwgbm90YXRpb25BcnJheS5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgfQ0KICAgICAgICBub3RhdGlvbkFycmF5LmZvckVhY2gobm90YXRpb25TdHJpbmcgPT4gew0KICAgICAgICAgICAgLy8gU3BsaXQgdGhlIHN0cmluZyBieSBzcGFjZXMgdG8gZ2V0IGluZGl2aWR1YWwgbW92ZXMNCiAgICAgICAgICAgIGNvbnN0IG5vdGF0aW9uID0gbm90YXRpb25TdHJpbmcuc3BsaXQoJyAnKS5maWx0ZXIobW92ZSA9PiBtb3ZlLnRyaW0oKSAhPT0gJycpOw0KICAgICAgICAgICAgLy8gQ2FsbCBleGlzdGluZyBmdW5jdGlvbiB0byBhZGQgdGhlIGxpbmUNCiAgICAgICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tTm90YXRpb24obm90YXRpb24sIHdlaWdodHMpOw0KICAgICAgICB9KTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDb252ZXJ0IGNvb3JkaW5hdGUtYmFzZWQgbW92ZXMgdG8gdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbg0KICAgICAqIEBwYXJhbSBib2FyZEhpc3RvcnkgQXJyYXkgb2YgYm9hcmQgc3RhdGVzIHJlcHJlc2VudGluZyB0aGUgZ2FtZSBoaXN0b3J5DQogICAgICogQHBhcmFtIG1vdmVIaXN0b3J5IEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0DQogICAgICogQHJldHVybnMgQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uDQogICAgICovDQogICAgbW92ZXNUb05vdGF0aW9uKGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkpIHsNCiAgICAgICAgY29uc3Qgbm90YXRpb24gPSBbXTsNCiAgICAgICAgbGV0IGN1cnJlbnRDb2xvciA9ICdyZWQnOyAvLyBSZWQgbW92ZXMgZmlyc3QNCg0KICAgICAgICAvLyBUeXBlIHRvIHBpZWNlIGNoYXJhY3RlciBtYXBwaW5nDQogICAgICAgIGNvbnN0IHR5cGVUb1BpZWNlID0gew0KICAgICAgICAgICAgJ2dlbmVyYWwnOiB7ICdyZWQnOiAn5biFJywgJ2JsYWNrJzogJ+WwhicgfSwNCiAgICAgICAgICAgICdhZHZpc29yJzogeyAncmVkJzogJ+S7lScsICdibGFjayc6ICflo6snIH0sDQogICAgICAgICAgICAnZWxlcGhhbnQnOiB7ICdyZWQnOiAn55u4JywgJ2JsYWNrJzogJ+ixoScgfSwNCiAgICAgICAgICAgICdob3JzZSc6IHsgJ3JlZCc6ICfpqawnLCAnYmxhY2snOiAn6amsJyB9LA0KICAgICAgICAgICAgJ2NoYXJpb3QnOiB7ICdyZWQnOiAn6L2mJywgJ2JsYWNrJzogJ+i9picgfSwNCiAgICAgICAgICAgICdjYW5ub24nOiB7ICdyZWQnOiAn54KuJywgJ2JsYWNrJzogJ+eCricgfSwNCiAgICAgICAgICAgICdzb2xkaWVyJzogeyAncmVkJzogJ+WFtScsICdibGFjayc6ICfljZInIH0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDb2x1bW4gbWFwcGluZyAoY29vcmRpbmF0ZSAwLTggdG8gdHJhZGl0aW9uYWwg5LmdLeS4gCBmb3IgcmVkLCA5LTEgZm9yIGJsYWNrKQ0KICAgICAgICBjb25zdCBjb2xUb0NoaW5lc2UgPSBbJ+S5nScsICflhasnLCAn5LiDJywgJ+WFrScsICfkupQnLCAn5ZubJywgJ+S4iScsICfkuownLCAn5LiAJ107DQogICAgICAgIGNvbnN0IGNvbFRvQXJhYmljID0gWyc5JywgJzgnLCAnNycsICc2JywgJzUnLCAnNCcsICczJywgJzInLCAnMSddOw0KDQogICAgICAgIC8vIERpZ2l0IHRvIENoaW5lc2UgbnVtYmVyIG1hcHBpbmcgZm9yIHN0ZXBzDQogICAgICAgIGNvbnN0IGRpZ2l0VG9DaGluZXNlID0gWycnLCAn5LiAJywgJ+S6jCcsICfkuIknLCAn5ZubJywgJ+S6lCcsICflha0nLCAn5LiDJywgJ+WFqycsICfkuZ0nXTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY2hlY2sgaWYgdGhlcmUgYXJlIG11bHRpcGxlIHNhbWUtdHlwZSBwaWVjZXMgaW4gdGhlIHNhbWUgY29sdW1uDQogICAgICAgIGNvbnN0IGhhc1NhbWVUeXBlSW5Db2x1bW4gPSAoYm9hcmQsIHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgZXhjbHVkZVJvdykgPT4gew0KICAgICAgICAgICAgbGV0IGNvdW50ID0gMDsNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY29sXTsNCiAgICAgICAgICAgICAgICBpZiAociA9PT0gZXhjbHVkZVJvdykgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09IHBpZWNlVHlwZSAmJiBwaWVjZS5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgY291bnQrKzsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICByZXR1cm4gY291bnQgPiAwOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBkZXRlcm1pbmUgZnJvbnQvYmFjayBtYXJrZXINCiAgICAgICAgY29uc3QgZ2V0RnJvbnRCYWNrTWFya2VyID0gKGJvYXJkLCBwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGN1cnJlbnRSb3cpID0+IHsNCiAgICAgICAgICAgIGNvbnN0IHNhbWVUeXBlUGllY2VzID0gW107DQogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NvbF07DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09IHBpZWNlVHlwZSAmJiBwaWVjZS5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgc2FtZVR5cGVQaWVjZXMucHVzaChyKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAoc2FtZVR5cGVQaWVjZXMubGVuZ3RoIDw9IDEpIHJldHVybiAnJzsNCiAgICAgICAgICAgIGlmIChjb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIhyPTctOe+8ie+8jHLlgLzotorlpKfotorpnaDov5HmlYzmlrnvvIzmmK8i5YmNIg0KICAgICAgICAgICAgICAgIGNvbnN0IHNvcnRlZFJvd3MgPSBbLi4uc2FtZVR5cGVQaWVjZXNdLnNvcnQoKGEsIGIpID0+IGIgLSBhKTsgLy8gSGlnaGVyIHJvd3MgZmlyc3QgPSBjbG9zZXIgdG8gb3Bwb25lbnQNCiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkUm93c1swXSA9PT0gY3VycmVudFJvdyA/ICfliY0nIDogJ+WQjic7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8iHI9MC0y77yJ77yMcuWAvOi2iuWwj+i2iumdoOi/keaVjOaWue+8jOaYryLliY0iDQogICAgICAgICAgICAgICAgY29uc3Qgc29ydGVkUm93cyA9IFsuLi5zYW1lVHlwZVBpZWNlc10uc29ydCgoYSwgYikgPT4gYSAtIGIpOyAvLyBMb3dlciByb3dzIGZpcnN0ID0gY2xvc2VyIHRvIG9wcG9uZW50DQogICAgICAgICAgICAgICAgcmV0dXJuIHNvcnRlZFJvd3NbMF0gPT09IGN1cnJlbnRSb3cgPyAn5YmNJyA6ICflkI4nOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIFByb2Nlc3MgZWFjaCBtb3ZlDQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW92ZUhpc3RvcnkubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IG1vdmUgPSBtb3ZlSGlzdG9yeVtpXTsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkQmVmb3JlID0gYm9hcmRIaXN0b3J5W2ldOw0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZEJlZm9yZVttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoIXBpZWNlKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gcGllY2UgZm91bmQgYXQgZnJvbSBwb3NpdGlvbjonLCBtb3ZlLmZyb20pOw0KICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZS50eXBlOw0KICAgICAgICAgICAgY29uc3QgcGllY2VDaGFyID0gdHlwZVRvUGllY2VbcGllY2VUeXBlXVtwaWVjZS5jb2xvcl07DQogICAgICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUgYXJlIG11bHRpcGxlIHNhbWUtdHlwZSBwaWVjZXMgaW4gdGhlIHNhbWUgY29sdW1uDQogICAgICAgICAgICBjb25zdCBoYXNEdXBsaWNhdGUgPSBoYXNTYW1lVHlwZUluQ29sdW1uKGJvYXJkQmVmb3JlLCBwaWVjZVR5cGUsIHBpZWNlLmNvbG9yLCBtb3ZlLmZyb20uYywgbW92ZS5mcm9tLnIpOw0KICAgICAgICAgICAgLy8gR2V0IGZyb250L2JhY2sgbWFya2VyIGlmIG5lZWRlZA0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25NYXJrZXIgPSBoYXNEdXBsaWNhdGUgPyBnZXRGcm9udEJhY2tNYXJrZXIoYm9hcmRCZWZvcmUsIHBpZWNlVHlwZSwgcGllY2UuY29sb3IsIG1vdmUuZnJvbS5jLCBtb3ZlLmZyb20ucikgOiAnJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gRGV0ZXJtaW5lIG5vdGF0aW9uIGJhc2VkIG9uIHBpZWNlIHR5cGUgYW5kIG1vdmUgZGlyZWN0aW9uDQogICAgICAgICAgICBsZXQgbm90YXRpb25TdHI7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdob3JzZScgfHwgcGllY2VUeXBlID09PSAnYWR2aXNvcicgfHwgcGllY2VUeXBlID09PSAnZWxlcGhhbnQnKSB7DQogICAgICAgICAgICAgICAgLy8gRGlhZ29uYWwgbW92aW5nIHBpZWNlcyAtIG9ubHkgdXNlIOi/my/pgIAsIHJlY29yZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6L+b77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSBtb3ZlLnRvLnIgPiBtb3ZlLmZyb20uciA/ICfov5snIDogJ+mAgCc7DQogICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnku47lj7PlvoDlt6bmmK8xLTnvvIzpnIDopoHlj43ovazliJfmmKDlsIQNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8iHI9MO+8ie+8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/ov5vvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IG1vdmUudG8uciA8IG1vdmUuZnJvbS5yID8gJ+i/mycgOiAn6YCAJzsNCiAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcgfHwgcGllY2VUeXBlID09PSAnY2hhcmlvdCcgfHwgcGllY2VUeXBlID09PSAnY2Fubm9uJyB8fCBwaWVjZVR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIC8vIFN0cmFpZ2h0IG1vdmluZyBwaWVjZXMgLSDov5sv6YCAL+W5sw0KICAgICAgICAgICAgICAgIGlmIChtb3ZlLmZyb20uYyA9PT0gbW92ZS50by5jKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIG1vdmUgLSDov5sv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXBzID0gTWF0aC5hYnMobW92ZS50by5yIC0gbW92ZS5mcm9tLnIpOw0KICAgICAgICAgICAgICAgICAgICAvLyDov5vmmK/pnaDov5HmlYzmlrnnmoTmlrnlkJHvvIzpgIDmmK/ov5znprvmlYzmlrnnmoTmlrnlkJENCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+i/m++8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+i/m++8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gKGlzUmVkID8gbW92ZS50by5yID4gbW92ZS5mcm9tLnIgOiBtb3ZlLnRvLnIgPCBtb3ZlLmZyb20ucikgPyAn6L+bJyA6ICfpgIAnOw0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBzdGVwcyBpcyBhIHZhbGlkIG51bWJlciBiZXR3ZWVuIDEtOQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsaWRTdGVwcyA9IE1hdGgubWF4KDEsIE1hdGgubWluKDksIE1hdGgucm91bmQoc3RlcHMgfHwgMSkpKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7ZGlnaXRUb0NoaW5lc2VbdmFsaWRTdGVwc10gfHwgJyd9YDsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhA0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY107DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgc3RlcHMgaXMgYSB2YWxpZCBudW1iZXINCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkU3RlcHMgPSBNYXRoLnJvdW5kKHN0ZXBzIHx8IDEpOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt2YWxpZFN0ZXBzfWA7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIG1vdmUgLSDlubMNCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9DaGluZXNlW21vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH3lubMke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnku47lj7PlvoDlt6bmmK8xLTnvvIzpnIDopoHlj43ovazliJfmmKDlsIQNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfeW5syR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignVW5rbm93biBwaWVjZSB0eXBlOicsIHBpZWNlVHlwZSk7DQogICAgICAgICAgICAgICAgY29udGludWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIG5vdGF0aW9uLnB1c2gobm90YXRpb25TdHIpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBTd2l0Y2ggY29sb3IgZm9yIG5leHQgbW92ZQ0KICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgcmV0dXJuIG5vdGF0aW9uOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENvbnZlcnQgdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbiB0byBjb29yZGluYXRlIG1vdmVzDQogICAgICogQHBhcmFtIG5vdGF0aW9uIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbg0KICAgICAqIEByZXR1cm5zIEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0DQogICAgICovDQogICAgbm90YXRpb25Ub01vdmVzKG5vdGF0aW9uLCBpbml0aWFsQm9hcmQgPSBudWxsKSB7DQogICAgICAgIC8vIOehruS/nW5vdGF0aW9u5piv5pWw57uE5LiU5LiN5Li656m6DQogICAgICAgIGlmICghbm90YXRpb24gfHwgIUFycmF5LmlzQXJyYXkobm90YXRpb24pIHx8IG5vdGF0aW9uLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgcmV0dXJuIFtdOw0KICAgICAgICB9DQogICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgIGxldCBjdXJyZW50Q29sb3IgPSAncmVkJzsgLy8gUmVkIG1vdmVzIGZpcnN0DQoNCiAgICAgICAgLy8gUGllY2UgY2hhcmFjdGVyIHRvIHR5cGUgbWFwcGluZw0KICAgICAgICBjb25zdCBwaWVjZU1hcCA9IHsNCiAgICAgICAgICAgICflsIYnOiAnZ2VuZXJhbCcsICfluIUnOiAnZ2VuZXJhbCcsDQogICAgICAgICAgICAn5aOrJzogJ2Fkdmlzb3InLCAn5LuVJzogJ2Fkdmlzb3InLA0KICAgICAgICAgICAgJ+ixoSc6ICdlbGVwaGFudCcsICfnm7gnOiAnZWxlcGhhbnQnLA0KICAgICAgICAgICAgJ+mprCc6ICdob3JzZScsDQogICAgICAgICAgICAn6L2mJzogJ2NoYXJpb3QnLA0KICAgICAgICAgICAgJ+eCric6ICdjYW5ub24nLA0KICAgICAgICAgICAgJ+WNkic6ICdzb2xkaWVyJywgJ+WFtSc6ICdzb2xkaWVyJw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENvbHVtbiBtYXBwaW5nICh0cmFkaXRpb25hbCBub3RhdGlvbiB1c2VzIDEtOSBmcm9tIHJpZ2h0IHRvIGxlZnQpDQogICAgICAgIGNvbnN0IGNvbE1hcCA9IHsNCiAgICAgICAgICAgICfkuIAnOiA4LCAnMSc6IDgsDQogICAgICAgICAgICAn5LqMJzogNywgJzInOiA3LA0KICAgICAgICAgICAgJ+S4iSc6IDYsICczJzogNiwNCiAgICAgICAgICAgICflm5snOiA1LCAnNCc6IDUsDQogICAgICAgICAgICAn5LqUJzogNCwgJzUnOiA0LA0KICAgICAgICAgICAgJ+WFrSc6IDMsICc2JzogMywNCiAgICAgICAgICAgICfkuIMnOiAyLCAnNyc6IDIsDQogICAgICAgICAgICAn5YWrJzogMSwgJzgnOiAxLA0KICAgICAgICAgICAgJ+S5nSc6IDAsICc5JzogMA0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENoaW5lc2UgbnVtYmVyIHRvIGRpZ2l0IG1hcHBpbmcNCiAgICAgICAgY29uc3QgY2hpbmVzZU51bWJlck1hcCA9IHsNCiAgICAgICAgICAgICfkuIAnOiAxLCAnMSc6IDEsDQogICAgICAgICAgICAn5LqMJzogMiwgJzInOiAyLA0KICAgICAgICAgICAgJ+S4iSc6IDMsICczJzogMywNCiAgICAgICAgICAgICflm5snOiA0LCAnNCc6IDQsDQogICAgICAgICAgICAn5LqUJzogNSwgJzUnOiA1LA0KICAgICAgICAgICAgJ+WFrSc6IDYsICc2JzogNiwNCiAgICAgICAgICAgICfkuIMnOiA3LCAnNyc6IDcsDQogICAgICAgICAgICAn5YWrJzogOCwgJzgnOiA4LA0KICAgICAgICAgICAgJ+S5nSc6IDksICc5JzogOQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEluaXRpYWwgcG9zaXRpb25zIG9mIHBpZWNlcyAocmVkIGFuZCBibGFjaykNCiAgICAgICAgLy8g5L+u5aSN77ya5LiO5paw5Z2Q5qCH57O757uf5L+d5oyB5LiA6Ie077yM57qi5pa55Zyo5bqV6YOo77yIcj0wLTLvvInvvIzpu5HmlrnlnKjpobbpg6jvvIhyPTctOe+8iQ0KICAgICAgICBjb25zdCBkZWZhdWx0SW5pdGlhbFBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICdyZWQtZ2VuZXJhbCc6IHsgcjogMCwgYzogNCB9LA0KICAgICAgICAgICAgJ3JlZC1hZHZpc29yJzogW3sgcjogMCwgYzogMyB9LCB7IHI6IDAsIGM6IDUgfV0sDQogICAgICAgICAgICAncmVkLWVsZXBoYW50JzogW3sgcjogMCwgYzogMiB9LCB7IHI6IDAsIGM6IDYgfV0sDQogICAgICAgICAgICAncmVkLWhvcnNlJzogW3sgcjogMCwgYzogMSB9LCB7IHI6IDAsIGM6IDcgfV0sDQogICAgICAgICAgICAncmVkLWNoYXJpb3QnOiBbeyByOiAwLCBjOiAwIH0sIHsgcjogMCwgYzogOCB9XSwNCiAgICAgICAgICAgICdyZWQtY2Fubm9uJzogW3sgcjogMiwgYzogMSB9LCB7IHI6IDIsIGM6IDcgfV0sDQogICAgICAgICAgICAncmVkLXNvbGRpZXInOiBbeyByOiAzLCBjOiAwIH0sIHsgcjogMywgYzogMiB9LCB7IHI6IDMsIGM6IDQgfSwgeyByOiAzLCBjOiA2IH0sIHsgcjogMywgYzogOCB9XSwNCiAgICAgICAgICAgICdibGFjay1nZW5lcmFsJzogeyByOiA5LCBjOiA0IH0sDQogICAgICAgICAgICAnYmxhY2stYWR2aXNvcic6IFt7IHI6IDksIGM6IDMgfSwgeyByOiA5LCBjOiA1IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWVsZXBoYW50JzogW3sgcjogOSwgYzogMiB9LCB7IHI6IDksIGM6IDYgfV0sDQogICAgICAgICAgICAnYmxhY2staG9yc2UnOiBbeyByOiA5LCBjOiAxIH0sIHsgcjogOSwgYzogNyB9XSwNCiAgICAgICAgICAgICdibGFjay1jaGFyaW90JzogW3sgcjogOSwgYzogMCB9LCB7IHI6IDksIGM6IDggfV0sDQogICAgICAgICAgICAnYmxhY2stY2Fubm9uJzogW3sgcjogNywgYzogMSB9LCB7IHI6IDcsIGM6IDcgfV0sDQogICAgICAgICAgICAnYmxhY2stc29sZGllcic6IFt7IHI6IDYsIGM6IDAgfSwgeyByOiA2LCBjOiAyIH0sIHsgcjogNiwgYzogNCB9LCB7IHI6IDYsIGM6IDYgfSwgeyByOiA2LCBjOiA4IH1dDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gVHJhY2sgcGllY2UgcG9zaXRpb25zIGFzIG1vdmVzIGFyZSBtYWRlDQogICAgICAgIGxldCBwaWVjZVBvc2l0aW9ucyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoZGVmYXVsdEluaXRpYWxQb3NpdGlvbnMpKTsNCiAgICAgICAgDQogICAgICAgIC8vIElmIGluaXRpYWwgYm9hcmQgaXMgcHJvdmlkZWQsIGluaXRpYWxpemUgcGllY2UgcG9zaXRpb25zIGZyb20gaXQNCiAgICAgICAgaWYgKGluaXRpYWxCb2FyZCkgew0KICAgICAgICAgICAgLy8gUmVzZXQgcGllY2UgcG9zaXRpb25zIGJhc2VkIG9uIGluaXRpYWwgYm9hcmQNCiAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgICdyZWQtZ2VuZXJhbCc6IHsgcjogLTEsIGM6IC0xIH0sDQogICAgICAgICAgICAgICAgJ3JlZC1hZHZpc29yJzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1lbGVwaGFudCc6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtaG9yc2UnOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWNoYXJpb3QnOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWNhbm5vbic6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtc29sZGllcic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1nZW5lcmFsJzogeyByOiAtMSwgYzogLTEgfSwNCiAgICAgICAgICAgICAgICAnYmxhY2stYWR2aXNvcic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1lbGVwaGFudCc6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1ob3JzZSc6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1jaGFyaW90JzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWNhbm5vbic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1zb2xkaWVyJzogW10NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFBvcHVsYXRlIHBpZWNlIHBvc2l0aW9ucyBmcm9tIGluaXRpYWwgYm9hcmQNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gaW5pdGlhbEJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke3BpZWNlLmNvbG9yfS0ke3BpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1trZXldID0geyByLCBjIH07DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2tleV0ucHVzaCh7IHIsIGMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZmluZCBwaWVjZSBwb3NpdGlvbg0KICAgICAgICBjb25zdCBmaW5kUGllY2VQb3NpdGlvbiA9IChwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGRpcmVjdGlvbiwgYm9hcmQsIGZyb250QmFja01hcmtlciA9IG51bGwpID0+IHsNCiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbG9yfS0ke3BpZWNlVHlwZX1gOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNba2V5XTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcG9zaXRpb25zIGV4aXN0IGFuZCBhcmUgdmFsaWQNCiAgICAgICAgICAgIGlmICghcG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gcG9zaXRpb25zIGZvdW5kIGZvciBwaWVjZTonLCBrZXkpOw0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gcG9zaXRpb25zOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBGaW5kIHBpZWNlcyBvbiB0aGUgc3BlY2lmaWVkIGNvbHVtbg0KICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IHBvc2l0aW9ucy5maWx0ZXIocG9zID0+IHBvcy5jID09PSBjb2wpOw0KDQogICAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBjYW5kaWRhdGVzIGZvdW5kIGZvciBwaWVjZTonLCBrZXksICdvbiBjb2x1bW46JywgY29sKTsNCiAgICAgICAgICAgICAgICAvLyBBZGRpdGlvbmFsIGRlYnVnIGluZm8gZm9yIGNhbm5vbg0KICAgICAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdjYW5ub24nICYmIGNvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdERUJVRzogQ2FuZGlkYXRlcyBhZnRlciBmaWx0ZXI6JywgY2FuZGlkYXRlcyk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gY2FuZGlkYXRlc1swXTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gSWYgZnJvbnQvYmFjayBtYXJrZXIgaXMgcHJvdmlkZWQsIHVzZSBpdCB0byBkZXRlcm1pbmUgdGhlIHBpZWNlDQogICAgICAgICAgICBpZiAoZnJvbnRCYWNrTWFya2VyID09PSAn5YmNJykgew0KICAgICAgICAgICAgICAgIC8vIOWJjeeCru+8mumdoOi/keaVjOaWueeahOaji+WtkA0KICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8mnLlgLzovoPlpKfnmoTmm7TpnaDov5HmlYzmlrnvvIjliY3vvIkNCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJpy5YC86L6D5bCP55qE5pu06Z2g6L+R5pWM5pa577yI5YmN77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoZnJvbnRCYWNrTWFya2VyID09PSAn5ZCOJykgew0KICAgICAgICAgICAgICAgIC8vIOWQjueCru+8mumdoOi/keW3seaWueeahOaji+WtkA0KICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8mnLlgLzovoPlsI/nmoTmm7TpnaDov5Hlt7HmlrnvvIjlkI7vvIkNCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJpy5YC86L6D5aSn55qE5pu06Z2g6L+R5bex5pa577yI5ZCO77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gSWYgbXVsdGlwbGUgcGllY2VzIG9uIHRoZSBzYW1lIGNvbHVtbiBhbmQgbm8gbWFya2VyLCBkZXRlcm1pbmUgYmFzZWQgb24gZGlyZWN0aW9uDQogICAgICAgICAgICAvLyDlr7nkuo7lkIzkuIDliJfnmoTmo4vlrZDvvIzpgJrov4fmr5TovoNy5YC85p2l5Yy65YiGDQogICAgICAgICAgICBpZiAoZGlyZWN0aW9uID09PSAn6L+bJykgew0KICAgICAgICAgICAgICAgIC8vIOi/m+aYr+WQkeaVjOaWueaWueWQkeenu+WKqO+8jOaJgOS7pemAieaLqeabtOmdoOi/keW3seaWueeahOaji+WtkO+8iOWQju+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9IGVsc2UgaWYgKGRpcmVjdGlvbiA9PT0gJ+mAgCcpIHsNCiAgICAgICAgICAgICAgICAvLyDpgIDmmK/lkJHlt7HmlrnmlrnlkJHnp7vliqjvvIzmiYDku6XpgInmi6nmm7TpnaDov5HmlYzmlrnnmoTmo4vlrZDvvIjliY3vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICByZXR1cm4gY2FuZGlkYXRlc1swXTsgLy8gRGVmYXVsdCB0byBmaXJzdCBpZiBkaXJlY3Rpb24gaXMgJ+W5sycgYW5kIG5vIG1hcmtlcg0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byB1cGRhdGUgcGllY2UgcG9zaXRpb24NCiAgICAgICAgY29uc3QgdXBkYXRlUGllY2VQb3NpdGlvbiA9IChwaWVjZVR5cGUsIGNvbG9yLCBvbGRQb3MsIG5ld1BvcykgPT4gew0KICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7Y29sb3J9LSR7cGllY2VUeXBlfWA7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1trZXldOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiBwb3NpdGlvbnMgZXhpc3QgYW5kIGFyZSB2YWxpZA0KICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IE5vIHBvc2l0aW9ucyBmb3VuZCBmb3IgcGllY2U6Jywga2V5KTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgIHBvc2l0aW9ucy5yID0gbmV3UG9zLnI7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zLmMgPSBuZXdQb3MuYzsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IGluZGV4ID0gcG9zaXRpb25zLmZpbmRJbmRleChwb3MgPT4gcG9zLnIgPT09IG9sZFBvcy5yICYmIHBvcy5jID09PSBvbGRQb3MuYyk7DQogICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKSB7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zW2luZGV4XS5yID0gbmV3UG9zLnI7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zW2luZGV4XS5jID0gbmV3UG9zLmM7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogQ291bGQgbm90IGZpbmQgcGllY2UgcG9zaXRpb24gdG8gdXBkYXRlOicsIG9sZFBvcywgJ2luJywgcG9zaXRpb25zKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY2hlY2sgaWYgcG9zaXRpb24gaXMgdmFsaWQNCiAgICAgICAgY29uc3QgaXNWYWxpZFBvcyA9IChyLCBjKSA9PiByID49IDAgJiYgciA8IDEwICYmIGMgPj0gMCAmJiBjIDwgOTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGhvcnNlIG1vdmVzDQogICAgICAgIGNvbnN0IGdldEhvcnNlTW92ZXMgPSAocG9zLCBjb2xvcikgPT4gew0KICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyBkcjogLTIsIGRjOiAtMSB9LCB7IGRyOiAtMiwgZGM6IDEgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAtMSwgZGM6IC0yIH0sIHsgZHI6IC0xLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDEsIGRjOiAtMiB9LCB7IGRyOiAxLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDIsIGRjOiAtMSB9LCB7IGRyOiAyLCBkYzogMSB9DQogICAgICAgICAgICBdOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgaG9yc2UgY2FuIG1vdmUgaW4gdGhlIGRpcmVjdGlvbg0KICAgICAgICAgICAgY29uc3QgY2FuTW92ZSA9IChkciwgZGMsIGJsb2NrZWRSLCBibG9ja2VkQykgPT4gew0KICAgICAgICAgICAgICAgIGlmICghaXNWYWxpZFBvcyhyICsgYmxvY2tlZFIsIGMgKyBibG9ja2VkQykpIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH07DQoNCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSwgaW5kZXgpID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCBibG9ja2VkUiA9IGRyID4gMCA/IDEgOiBkciA8IDAgPyAtMSA6IDA7DQogICAgICAgICAgICAgICAgY29uc3QgYmxvY2tlZEMgPSBkYyA+IDAgPyAxIDogZGMgPCAwID8gLTEgOiAwOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBwYXRoIGlzIGJsb2NrZWQNCiAgICAgICAgICAgICAgICBpZiAoKGluZGV4IDwgMiB8fCBpbmRleCA+PSA2KSAmJiBibG9ja2VkUiAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBibG9ja2VkDQogICAgICAgICAgICAgICAgICAgIGlmICghY2FuTW92ZShkciwgZGMsIGJsb2NrZWRSLCAwKSkgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoYmxvY2tlZEMgIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBibG9ja2VkDQogICAgICAgICAgICAgICAgICAgIGlmICghY2FuTW92ZShkciwgZGMsIDAsIGJsb2NrZWRDKSkgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSkgew0KICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCg0KICAgICAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgZWxlcGhhbnQgbW92ZXMNCiAgICAgICAgY29uc3QgZ2V0RWxlcGhhbnRNb3ZlcyA9IChwb3MsIGNvbG9yKSA9PiB7DQogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IGRyOiAtMiwgZGM6IC0yIH0sIHsgZHI6IC0yLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDIsIGRjOiAtMiB9LCB7IGRyOiAyLCBkYzogMiB9DQogICAgICAgICAgICBdOw0KDQogICAgICAgICAgICAvLyBFbGVwaGFudCdzIHRlcnJpdG9yeSAtIHJlZCBlbGVwaGFudHMgY2FuIG9ubHkgYmUgaW4gcjw9NCwgYmxhY2sgZWxlcGhhbnRzIGluIHI+PTUNCiAgICAgICAgICAgIGNvbnN0IGlzSW5UZXJyaXRvcnkgPSAocikgPT4gew0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyByIDw9IDQgOiByID49IDU7DQogICAgICAgICAgICB9Ow0KDQogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0pID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCBtaWRSID0gciArIGRyIC8gMjsNCiAgICAgICAgICAgICAgICBjb25zdCBtaWRDID0gYyArIGRjIC8gMjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7DQoNCiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBtaWQgcG9zaXRpb24gaXMgZW1wdHkgYW5kIG5ldyBwb3NpdGlvbiBpcyB2YWxpZA0KICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG1pZFIsIG1pZEMpICYmIGlzVmFsaWRQb3MobmV3UiwgbmV3QykgJiYgaXNJblRlcnJpdG9yeShuZXdSKSkgew0KICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCg0KICAgICAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgYWR2aXNvciBtb3Zlcw0KICAgICAgICBjb25zdCBnZXRBZHZpc29yTW92ZXMgPSAocG9zLCBjb2xvcikgPT4gew0KICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyBkcjogLTEsIGRjOiAtMSB9LCB7IGRyOiAtMSwgZGM6IDEgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAxLCBkYzogLTEgfSwgeyBkcjogMSwgZGM6IDEgfQ0KICAgICAgICAgICAgXTsNCg0KICAgICAgICAgICAgLy8gQWR2aXNvcidzIHRlcnJpdG9yeSAocGFsYWNlKSAtIHJlZCBhZHZpc29ycyBpbiByPTAtMixjPTMtNSwgYmxhY2sgYWR2aXNvcnMgaW4gcj03LTksYz0zLTUNCiAgICAgICAgICAgIGNvbnN0IGlzSW5QYWxhY2UgPSAociwgYykgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IHJSYW5nZSA9IGNvbG9yID09PSAncmVkJyA/IFswLCAyXSA6IFs3LCA5XTsNCiAgICAgICAgICAgICAgICByZXR1cm4gciA+PSByUmFuZ2VbMF0gJiYgciA8PSByUmFuZ2VbMV0gJiYgYyA+PSAzICYmIGMgPD0gNTsNCiAgICAgICAgICAgIH07DQoNCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSkgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSAmJiBpc0luUGFsYWNlKG5ld1IsIG5ld0MpKSB7DQogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0pOw0KDQogICAgICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGJvYXJkIHRvIHRyYWNrIG1vdmVzDQogICAgICAgIGxldCB0ZW1wQm9hcmQgPSB0aGlzLmNyZWF0ZUluaXRpYWxCb2FyZCgpOw0KICAgICAgICANCiAgICAgICAgLy8gRW5zdXJlIHRlbXBCb2FyZCBpcyBwcm9wZXJseSBpbml0aWFsaXplZA0KICAgICAgICBpZiAoIXRlbXBCb2FyZCB8fCB0ZW1wQm9hcmQubGVuZ3RoICE9PSAxMCkgew0KICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBib2FyZCBpbml0aWFsaXphdGlvbicpOw0KICAgICAgICAgICAgcmV0dXJuIFtdOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyBWZXJpZnkgYWxsIHJvd3MgaGF2ZSA5IGNvbHVtbnMNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDsgaSsrKSB7DQogICAgICAgICAgICBpZiAoIXRlbXBCb2FyZFtpXSB8fCB0ZW1wQm9hcmRbaV0ubGVuZ3RoICE9PSA5KSB7DQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2ldID0gQXJyYXkoOSkuZmlsbChudWxsKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIGNvbnNvbGUubG9nKCdUb3RhbCBtb3ZlczonLCBub3RhdGlvbi5sZW5ndGgpOw0KICAgICAgICBub3RhdGlvbi5mb3JFYWNoKG1vdmVOb3RhdGlvbiA9PiB7DQoNCg0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBQYXJzZSB0aGUgbW92ZSBub3RhdGlvbiAtIGtlZXAgbGFzdCBncm91cCBvcHRpb25hbA0KICAgICAgICAgICAgY29uc3QgcmVnZXggPSAvKFvliY3lkI5dKT8oW+WwhuW4heWjq+S7leixoeebuOmprOi9pueCruWFteWNkl0pKFvkuIDkuozkuInlm5vkupTlha3kuIPlhavkuZ0xMjM0NTY3ODldKShb6L+b6YCA5bmzXSkoW+S4gOS6jOS4ieWbm+S6lOWFreS4g+WFq+S5nTEyMzQ1Njc4OV0pPy87DQogICAgICAgICAgICBjb25zdCBtYXRjaCA9IG1vdmVOb3RhdGlvbi5tYXRjaChyZWdleCk7DQoNCiAgICAgICAgICAgIGlmICghbWF0Y2gpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIG1vdmUgbm90YXRpb246JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IFssIGZyb250QmFja01hcmtlciwgcGllY2VDaGFyLCBmcm9tQ29sTm90YXRpb24sIGRpcmVjdGlvbiwgdG9Db2xPclN0ZXBOb3RhdGlvbl0gPSBtYXRjaDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlTWFwW3BpZWNlQ2hhcl07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIEdldCBjb2x1bW4gbWFwcGluZyBiYXNlZCBvbiBjdXJyZW50IGNvbG9yIChibGFjayBzZWVzIGNvbHVtbnMgbWlycm9yZWQpDQogICAgICAgICAgICBsZXQgZnJvbUNvbCA9IGNvbE1hcFtmcm9tQ29sTm90YXRpb25dOw0KICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjayAoZnJvbSBibGFjaydzIHBlcnNwZWN0aXZlKQ0KICAgICAgICAgICAgICAgIGZyb21Db2wgPSA4IC0gZnJvbUNvbDsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gRmluZCB0aGUgY3VycmVudCBwb3NpdGlvbiBvZiB0aGUgcGllY2UNCiAgICAgICAgICAgIGNvbnN0IGZyb21Qb3MgPSBmaW5kUGllY2VQb3NpdGlvbihwaWVjZVR5cGUsIGN1cnJlbnRDb2xvciwgZnJvbUNvbCwgZGlyZWN0aW9uLCB0ZW1wQm9hcmQsIGZyb250QmFja01hcmtlcik7DQoNCiAgICAgICAgICAgIGlmICghZnJvbVBvcykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBmaW5kIHBpZWNlIHBvc2l0aW9uIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBsZXQgdG9Qb3M7DQoNCiAgICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT09ICflubMnKSB7DQogICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBtb3ZlbWVudA0KICAgICAgICAgICAgICAgIGxldCB0b0NvbCA9IGNvbE1hcFt0b0NvbE9yU3RlcE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICBpZiAodG9Db2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb246JywgdG9Db2xPclN0ZXBOb3RhdGlvbiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrIHdoZW4gbW92aW5nIGhvcml6b250YWxseQ0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgdG9Db2wgPSA4IC0gdG9Db2w7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIHRvUG9zID0geyByOiBmcm9tUG9zLnIsIGM6IHRvQ29sIH07DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIG9yIGRpYWdvbmFsIG1vdmVtZW50DQogICAgICAgICAgICAgICAgY29uc3Qgc3RlcHMgPSBjaGluZXNlTnVtYmVyTWFwW3RvQ29sT3JTdGVwTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKHN0ZXBzID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBzdGVwIGNvdW50OicsIHRvQ29sT3JTdGVwTm90YXRpb24sICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2hvcnNlJykgew0KICAgICAgICAgICAgICAgICAgICAvLyBIb3JzZSBtb3ZlcyBpbiBMLXNoYXBlDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRIb3JzZU1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7DQogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247DQogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgaG9yc2U6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjaw0KICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdlbGVwaGFudCcpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gRWxlcGhhbnQgbW92ZXMgZGlhZ29uYWxseSAyIHN0ZXBzDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRFbGVwaGFudE1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7DQogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247DQogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgZWxlcGhhbnQ6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjaw0KICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdhZHZpc29yJykgew0KICAgICAgICAgICAgICAgICAgICAvLyBBZHZpc29yIG1vdmVzIGRpYWdvbmFsbHkgMSBzdGVwDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRBZHZpc29yTW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsNCiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvbE5vdGF0aW9uID0gdG9Db2xPclN0ZXBOb3RhdGlvbjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uIGZvciBhZHZpc29yOicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sNCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIFN0cmFpZ2h0IGxpbmUgbW92ZW1lbnQgKGNoYXJpb3QsIGNhbm5vbiwgc29sZGllcikNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RlcCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyAoY3VycmVudENvbG9yID09PSAncmVkJyA/IDEgOiAtMSkgKiBzdGVwcyA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IC0xIDogMSkgKiBzdGVwczsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IGZyb21Qb3MuciArIHN0ZXA7DQogICAgICAgICAgICAgICAgICAgIGlmIChuZXdSIDwgMCB8fCBuZXdSID49IDEwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHJvdyBwb3NpdGlvbiBhZnRlciBtb3ZlOicsIG5ld1IsICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0geyByOiBuZXdSLCBjOiBmcm9tUG9zLmMgfTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmICghdG9Qb3MpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZGV0ZXJtaW5lIHRhcmdldCBwb3NpdGlvbiBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gQWRkIHRoZSBtb3ZlIHRvIHRoZSBsaXN0DQogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgZnJvbTogeyByOiBmcm9tUG9zLnIsIGM6IGZyb21Qb3MuYyB9LCB0bzogeyByOiB0b1Bvcy5yLCBjOiB0b1Bvcy5jIH0gfSk7DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlJ3MgYSBjYXB0dXJlZCBwaWVjZQ0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRQaWVjZSA9IHRlbXBCb2FyZFt0b1Bvcy5yXVt0b1Bvcy5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gSWYgdGhlcmUncyBhIGNhcHR1cmVkIHBpZWNlLCByZW1vdmUgaXQgZnJvbSBwaWVjZVBvc2l0aW9ucw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGAke2NhcHR1cmVkUGllY2UuY29sb3J9LSR7Y2FwdHVyZWRQaWVjZS50eXBlfWA7DQogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGNhcHR1cmVkUG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWwhi/luIXkuI3kvJrooqvlkIPmjonvvIzmiYDku6Xlj6rlpITnkIblhbbku5bmo4vlrZANCiAgICAgICAgICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBSZW1vdmUgdGhlIGNhcHR1cmVkIHBvc2l0aW9uIGZyb20gdGhlIGFycmF5DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjYXB0dXJlZFBvc2l0aW9ucykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB1cGRhdGVkUG9zaXRpb25zID0gY2FwdHVyZWRQb3NpdGlvbnMuZmlsdGVyKHBvcyA9PiANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zICYmIChwb3MuciAhPT0gdG9Qb3MuciB8fCBwb3MuYyAhPT0gdG9Qb3MuYykNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XSA9IHVwZGF0ZWRQb3NpdGlvbnM7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVmVyaWZ5IHJlbW92YWwgd2FzIHN1Y2Nlc3NmdWwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGlsbEV4aXN0cyA9IHVwZGF0ZWRQb3NpdGlvbnMuc29tZShwb3MgPT4gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiBwb3MuciA9PT0gdG9Qb3MuciAmJiBwb3MuYyA9PT0gdG9Qb3MuYw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHN0aWxsRXhpc3RzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogQ2FwdHVyZWQgcGllY2Ugc3RpbGwgZXhpc3RzIGluIHBpZWNlUG9zaXRpb25zIScpOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCfinIUgU1VDQ0VTUzogQ2FwdHVyZWQgcGllY2UgcmVtb3ZlZCBmcm9tIHBpZWNlUG9zaXRpb25zJyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IFVuZXhwZWN0ZWQgbm9uLWFycmF5IHBvc2l0aW9ucyBmb3IgcGllY2U6JywgY2FwdHVyZWRLZXkpOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBObyBwb3NpdGlvbnMgZm91bmQgZm9yIGNhcHR1cmVkIHBpZWNlOicsIGNhcHR1cmVkS2V5KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFZlcmlmeSB0aGUgY2FwdHVyZWQgcGllY2UgaGFzIGJlZW4gcmVtb3ZlZA0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGAke2NhcHR1cmVkUGllY2UuY29sb3J9LSR7Y2FwdHVyZWRQaWVjZS50eXBlfWA7DQogICAgICAgICAgICAgICAgY29uc3QgZmluYWxQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07DQogICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmluYWxQb3NpdGlvbnMpKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0aWxsRXhpc3RzID0gZmluYWxQb3NpdGlvbnMuc29tZShwb3MgPT4gDQogICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgcG9zLnIgPT09IHRvUG9zLnIgJiYgcG9zLmMgPT09IHRvUG9zLmMNCiAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHN0aWxsRXhpc3RzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFUlJPUjogQ2FwdHVyZWQgcGllY2Ugc3RpbGwgZXhpc3RzIGluIHBpZWNlUG9zaXRpb25zOicsIGNhcHR1cmVkUGllY2UsICdhdCcsIHRvUG9zKTsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTVUNDRVNTOiBDYXB0dXJlZCBwaWVjZSByZW1vdmVkIGZyb20gcGllY2VQb3NpdGlvbnMnKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gTWFrZSB0aGUgbW92ZSBvbiB0aGUgdGVtcG9yYXJ5IGJvYXJkIGZpcnN0IGJlZm9yZSB1cGRhdGluZyBwaWVjZSBwb3NpdGlvbnMNCiAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKGZyb21Qb3MuciwgZnJvbVBvcy5jKSAmJiBpc1ZhbGlkUG9zKHRvUG9zLnIsIHRvUG9zLmMpICYmIA0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtmcm9tUG9zLnJdICYmIHRlbXBCb2FyZFt0b1Bvcy5yXSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gdGVtcEJvYXJkW2Zyb21Qb3Mucl1bZnJvbVBvcy5jXTsNCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbdG9Qb3Mucl1bdG9Qb3MuY10gPSBwaWVjZTsNCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbZnJvbVBvcy5yXVtmcm9tUG9zLmNdID0gbnVsbDsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBJbnZhbGlkIHBvc2l0aW9ucyBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24sIGZyb21Qb3MsIHRvUG9zKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBwaWVjZSBwb3NpdGlvbiBpbiBwaWVjZVBvc2l0aW9ucw0KICAgICAgICAgICAgdXBkYXRlUGllY2VQb3NpdGlvbihwaWVjZVR5cGUsIGN1cnJlbnRDb2xvciwgZnJvbVBvcywgdG9Qb3MpOw0KICAgICAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBTd2l0Y2ggY29sb3IgZm9yIG5leHQgbW92ZQ0KICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgfSk7DQoNCiAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgIH0NCn0NCg0KLy8gLS0tIENvbnN0YW50cyAtLS0NCg0KLy8gSW5pdGlhbGl6ZSBPcGVuaW5nIEJvb2sNCmNvbnN0IG9wZW5pbmdCb29rID0gbmV3IE9wZW5pbmdCb29rKDEyKTsNCg0KY29uc3QgUElFQ0VfVkFMVUVTID0gew0KICBnZW5lcmFsOiAxMDAwMCwgICAgIC8vIOWwhi/luIUNCiAgY2hhcmlvdDogOTAwLCAgICAgICAvLyDovaYNCiAgY2Fubm9uOiA0NTAsICAgICAgICAvLyDngq4NCiAgaG9yc2U6IDQwMCwgICAgICAgICAvLyDpqawNCiAgZWxlcGhhbnQ6IDIwMCwgICAgICAvLyDosaEv55u4DQogIGFkdmlzb3I6IDIwMCwgICAgICAgLy8g5aOrL+S7lQ0KICBzb2xkaWVyOiAxMDAsICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIC0tLSBQaWVjZS1TcXVhcmUgVGFibGVzIC0tLQ0KY29uc3QgUFNUX1NPTERJRVIgPSBbDQogIFsxMCwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDEwXSwNCiAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgWzUsIDEwLCAyMCwgMjUsIDI1LCAyNSwgMjAsIDEwLCA1XSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0NCl07DQpjb25zdCBQU1RfQ0hBUklPVCA9IFsNCiAgWzUsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDEwLCA1XSwNCiAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICBbMTAsIDEyLCAxNSwgMTUsIDE1LCAxNSwgMTUsIDEyLCAxMF0sDQogIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgWzUsIDEwLCAxMiwgMTAsIDEwLCAxMCwgMTIsIDEwLCA1XSwNCiAgWzEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTBdLA0KICBbMCwgMTAsIDUsIDEwLCA1LCAxMCwgNSwgMTAsIDBdDQpdOw0KY29uc3QgUFNUX0hPUlNFID0gWw0KICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgWzAsIDUsIDE1LCAxMCwgMTAsIDEwLCAxNSwgNSwgMF0sDQogIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICBbNSwgMTAsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTAsIDVdLA0KICBbMCwgNSwgMTUsIDIwLCAyMCwgMjAsIDE1LCA1LCAwXSwNCiAgWzAsIDUsIDE1LCAyMCwgMjAsIDIwLCAxNSwgNSwgMF0sDQogIFswLCA1LCAxMCwgMTUsIDE1LCAxNSwgMTAsIDUsIDBdLA0KICBbMCwgMCwgNSwgNSwgNSwgNSwgNSwgMCwgMF0sDQogIFswLCAtNSwgMCwgNSwgNSwgNSwgMCwgLTUsIDBdLA0KICBbMCwgLTEwLCAtNSwgMCwgMCwgMCwgLTUsIC0xMCwgMF0NCl07DQpjb25zdCBQU1RfQ0FOTk9OID0gWw0KICBbMCwgMCwgNSwgMTAsIDEwLCAxMCwgNSwgMCwgMF0sDQogIFswLCA1LCAxNSwgMTAsIDEwLCAxMCwgMTUsIDUsIDBdLA0KICBbMCwgNSwgMTUsIDI1LCAyNSwgMjUsIDE1LCA1LCAwXSwNCiAgWzAsIDUsIDEwLCAxNSwgMTUsIDE1LCAxMCwgNSwgMF0sDQogIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgWzAsIDUsIDUsIDUsIDUsIDUsIDUsIDUsIDBdLA0KICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogIFs1LCAxNSwgMjAsIDMwLCAzMCwgMzAsIDIwLCAxNSwgNV0sIA0KICBbMCwgNSwgNSwgMTAsIDEwLCAxMCwgNSwgNSwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KXTsNCmNvbnN0IFBTVF9ERUZFTlNFID0gWw0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMjAsIDMwLCAyMCwgMCwgMCwgMF0NCl07DQoNCmNvbnN0IGdldFBTVFZhbHVlID0gKHR5cGUsIGNvbG9yLCByLCBjKSA9PiB7DQogIGNvbnN0IHJvd0lkeCA9IGNvbG9yID09PSAncmVkJyA/IHIgOiAoOSAtIHIpOw0KICBsZXQgdGFibGUgPSBbXTsNCiAgc3dpdGNoICh0eXBlKSB7DQogICAgY2FzZSAnc29sZGllcic6IHRhYmxlID0gUFNUX1NPTERJRVI7IGJyZWFrOw0KICAgIGNhc2UgJ2NoYXJpb3QnOiB0YWJsZSA9IFBTVF9DSEFSSU9UOyBicmVhazsNCiAgICBjYXNlICdob3JzZSc6IHRhYmxlID0gUFNUX0hPUlNFOyBicmVhazsNCiAgICBjYXNlICdjYW5ub24nOiB0YWJsZSA9IFBTVF9DQU5OT047IGJyZWFrOw0KICAgIGRlZmF1bHQ6IHRhYmxlID0gUFNUX0RFRkVOU0U7IGJyZWFrOyANCiAgfQ0KICByZXR1cm4gdGFibGVbcm93SWR4XT8uW2NdIHx8IDA7DQp9Ow0KDQpjb25zdCBpc1ZhbGlkUG9zID0gKHIsIGMpID0+IHIgPj0gMCAmJiByIDwgUk9XUyAmJiBjID49IDAgJiYgYyA8IENPTFM7DQoNCi8vIOiOt+WPluaji+WtkOeahOWogeiDgeebruagh+WSjOS/neaKpOebruaghw0KY29uc3QgZ2V0UGllY2VUYXJnZXRzID0gKGJvYXJkLCBwb3MsIHBpZWNlKSA9PiB7DQogIGNvbnN0IHRocmVhdCA9IFtdOyAgICAgICAgICAgLy8g5b2T5YmN5qOL5a2Q5aiB6IOB55qE5pWM5pa55qOL5a2QDQogIGNvbnN0IGd1YXJkID0gW107ICAgICAgIC8vIOW9k+WJjeaji+WtkOS/neaKpOeahOW3seaWueaji+WtkA0KICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQoNCiAgY29uc3QgYWRkSWZWYWxpZCA9ICh0ciwgdGMpID0+IHsNCiAgICBpZiAoaXNWYWxpZFBvcyh0ciwgdGMpKSB7DQogICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW3RyXVt0Y107DQogICAgICAgIGlmICh0YXJnZXQpIHsNCiAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlLmNvbG9yKSB7DQogICAgICAgICAgICAgICAgLy8g5pWM5pa55qOL5a2Q77yM5Yqg5YWl5aiB6IOB5YiX6KGoDQogICAgICAgICAgICAgICAgdGhyZWF0LnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIOW3seaWueaji+WtkO+8jOWKoOWFpeS/neaKpOWIl+ihqO+8jOWwhuW4heS4jemcgOimgeS6i+WQjueahOS/neaKpA0KICAgICAgICAgICAgICAgIGlmICh0YXJnZXQudHlwZSAhPSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgZ3VhcmQucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogIH07DQogIA0KDQoNCiAgc3dpdGNoIChwaWVjZS50eXBlKSB7DQogICAgY2FzZSAnZ2VuZXJhbCc6IA0KICAgICAgW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGlmIChuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDcgJiYgbnIgPD0gOSkgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2Fkdmlzb3InOg0KICAgICAgW1sxLCAxXSwgWzEsIC0xXSwgWy0xLCAxXSwgWy0xLCAtMV1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgaWYgKG5jID49IDMgJiYgbmMgPD0gNSkgew0KICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA+PSAwICYmIG5yIDw9IDIpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnZWxlcGhhbnQnOg0KICAgICAgW1syLCAyXSwgWzIsIC0yXSwgWy0yLCAyXSwgWy0yLCAtMl1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgY29uc3QgZXllUiA9IHIgKyBkciAvIDIsIGV5ZUMgPSBjICsgZGMgLyAyOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhuciwgbmMpICYmIGJvYXJkW2V5ZVJdW2V5ZUNdID09PSBudWxsKSB7DQogICAgICAgICAgaWYgKGlzUmVkICYmIG5yIDw9IDQpIGFkZElmVmFsaWQobnIsIG5jKTsgDQogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDUpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdob3JzZSc6DQogICAgICBbWzIsIDFdLCBbMiwgLTFdLCBbLTIsIDFdLCBbLTIsIC0xXSwgWzEsIDJdLCBbMSwgLTJdLCBbLTEsIDJdLCBbLTEsIC0yXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBjb25zdCBsZWdSID0gciArIChNYXRoLmFicyhkcikgPT09IDIgPyBNYXRoLnNpZ24oZHIpIDogMCk7DQogICAgICAgIGNvbnN0IGxlZ0MgPSBjICsgKE1hdGguYWJzKGRjKSA9PT0gMiA/IE1hdGguc2lnbihkYykgOiAwKTsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MobGVnUiwgbGVnQykgJiYgYm9hcmRbbGVnUl1bbGVnQ10gPT09IG51bGwpIHsNCiAgICAgICAgICBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnY2hhcmlvdCc6DQogICAgICBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgLy8g56m65L2N572u77yM5LiN5YGa5aSE55CGDQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgIH0NCiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnY2Fubm9uJzoNCiAgICAgIFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgbGV0IHNjcmVlbkZvdW5kID0gZmFsc2U7DQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAvLyDnqbrkvY3nva7vvIzkuI3lgZrlpITnkIYNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgIHNjcmVlbkZvdW5kID0gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gIT09IG51bGwpIHsNCiAgICAgICAgICAgICAgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICB9DQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ3NvbGRpZXInOiB7DQogICAgICAvLyDnuqLmlrnlhbXliJ3lp4vkvY3nva7lnKhyPTPvvIzlkJHliY3otbDmmK9y5aKe5aSn77yI5ZCR5LiL77yJ77yb6buR5pa55YW15Yid5aeL5L2N572u5Zyocj0277yM5ZCR5YmN6LWw5pivcuWHj+Wwj++8iOWQkeS4iu+8iQ0KICAgICAgY29uc3QgZm9yd2FyZCA9IGlzUmVkID8gMSA6IC0xOw0KICAgICAgLy8g57qi5pa55YW16L+H5rKz5p2h5Lu25pivciA+PSA177yM6buR5pa55YW16L+H5rKz5p2h5Lu25pivciA8PSA0DQogICAgICAvLyDmsrPnlYzkvY3kuo5yPTTlkoxyPTXkuYvpl7TvvIznuqLmlrnlhbXpnIDopoHotbDliLByPTXmiY3og73ov4fmsrPvvIzpu5HmlrnlhbXpnIDopoHotbDliLByPTTmiY3og73ov4fmsrMNCiAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGlzUmVkID8gciA+PSA1IDogciA8PSA0Ow0KICAgICAgYWRkSWZWYWxpZChyICsgZm9yd2FyZCwgYyk7DQogICAgICBpZiAoY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgIGFkZElmVmFsaWQociwgYyAtIDEpOw0KICAgICAgICBhZGRJZlZhbGlkKHIsIGMgKyAxKTsNCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgfQ0KICByZXR1cm4geyB0aHJlYXQsIGd1YXJkIH07DQp9Ow0KDQovLyBhbGxpZXNPdXQ6IOWPr+mAie+8jOaUtumbhuWPr+S/neaKpOeahOW3seaWueiQveeCue+8iOS4jeWQq+WwhuW4he+8ie+8jOS+m+WFs+ezu+iuoeeul+WkjeeUqO+8jOmBv+WFjeS6jOasoeWwhOe6vw0KY29uc3QgZ2V0UGllY2VNb3ZlcyA9IChib2FyZCwgcG9zLCBwaWVjZSwgYWxsaWVzT3V0ID0gbnVsbCkgPT4gew0KICBjb25zdCBtb3ZlcyA9IFtdOw0KICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQoNCiAgY29uc3QgYWRkQWxseSA9ICh0ciwgdGMsIHRhcmdldCkgPT4gew0KICAgIGlmIChhbGxpZXNPdXQgJiYgdGFyZ2V0ICYmIHRhcmdldC5jb2xvciA9PT0gcGllY2UuY29sb3IgJiYgdGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgew0KICAgICAgYWxsaWVzT3V0LnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgfQ0KICB9Ow0KDQogIGNvbnN0IGFkZElmVmFsaWQgPSAodHIsIHRjKSA9PiB7DQogICAgaWYgKGlzVmFsaWRQb3ModHIsIHRjKSkgew0KICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFt0cl1bdGNdOw0KICAgICAgICBpZiAoIXRhcmdldCB8fCB0YXJnZXQuY29sb3IgIT09IHBpZWNlLmNvbG9yKSB7DQogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgYWRkQWxseSh0ciwgdGMsIHRhcmdldCk7DQogICAgICAgIH0NCiAgICB9DQogIH07DQoNCiAgc3dpdGNoIChwaWVjZS50eXBlKSB7DQogICAgY2FzZSAnZ2VuZXJhbCc6IA0KICAgICAgW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGlmIChuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDcgJiYgbnIgPD0gOSkgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2Fkdmlzb3InOg0KICAgICAgW1sxLCAxXSwgWzEsIC0xXSwgWy0xLCAxXSwgWy0xLCAtMV1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgaWYgKG5jID49IDMgJiYgbmMgPD0gNSkgew0KICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA+PSAwICYmIG5yIDw9IDIpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnZWxlcGhhbnQnOg0KICAgICAgW1syLCAyXSwgWzIsIC0yXSwgWy0yLCAyXSwgWy0yLCAtMl1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgY29uc3QgZXllUiA9IHIgKyBkciAvIDIsIGV5ZUMgPSBjICsgZGMgLyAyOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhuciwgbmMpICYmIGJvYXJkW2V5ZVJdW2V5ZUNdID09PSBudWxsKSB7DQogICAgICAgICAgaWYgKGlzUmVkICYmIG5yIDw9IDQpIGFkZElmVmFsaWQobnIsIG5jKTsgDQogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDUpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdob3JzZSc6DQogICAgICBbWzIsIDFdLCBbMiwgLTFdLCBbLTIsIDFdLCBbLTIsIC0xXSwgWzEsIDJdLCBbMSwgLTJdLCBbLTEsIDJdLCBbLTEsIC0yXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBjb25zdCBsZWdSID0gciArIChNYXRoLmFicyhkcikgPT09IDIgPyBNYXRoLnNpZ24oZHIpIDogMCk7DQogICAgICAgIGNvbnN0IGxlZ0MgPSBjICsgKE1hdGguYWJzKGRjKSA9PT0gMiA/IE1hdGguc2lnbihkYykgOiAwKTsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MobGVnUiwgbGVnQykgJiYgYm9hcmRbbGVnUl1bbGVnQ10gPT09IG51bGwpIHsNCiAgICAgICAgICBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnY2hhcmlvdCc6DQogICAgICBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgIGlmICh0YXJnZXQgPT09IG51bGwpIHsNCiAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlLmNvbG9yKSBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgZWxzZSBhZGRBbGx5KG5yLCBuYywgdGFyZ2V0KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgIH0NCiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnY2Fubm9uJzoNCiAgICAgIC8vIOedgOazleS7jeWPquWQq+aVjOaWuemalOaJk++8m+W3seaWuemalOaJk+S/neaKpOeUsSBmaWxsQ2Fubm9uUmVsYXRpb25zIOe7n+S4gOWkhOeQhg0KICAgICAgW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBsZXQgc2NyZWVuRm91bmQgPSBmYWxzZTsNCiAgICAgICAgd2hpbGUgKGlzVmFsaWRQb3MobnIsIG5jKSkgew0KICAgICAgICAgIGlmICghc2NyZWVuRm91bmQpIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdID09PSBudWxsKSB7DQogICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICBzY3JlZW5Gb3VuZCA9IHRydWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdICE9PSBudWxsKSB7DQogICAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdLmNvbG9yICE9PSBwaWVjZS5jb2xvcikgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgICAgfQ0KICAgICAgICAgIG5yICs9IGRyOyBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdzb2xkaWVyJzogew0KICAgICAgLy8g57qi5pa55YW15Yid5aeL5L2N572u5Zyocj0z77yM5ZCR5YmN6LWw5pivcuWinuWkp++8iOWQkeS4i++8ie+8m+m7keaWueWFteWIneWni+S9jee9ruWcqHI9Nu+8jOWQkeWJjei1sOaYr3Llh4/lsI/vvIjlkJHkuIrvvIkNCiAgICAgIGNvbnN0IGZvcndhcmQgPSBpc1JlZCA/IDEgOiAtMTsNCiAgICAgIC8vIOe6ouaWueWFtei/h+ays+adoeS7tuaYr3IgPj0gNe+8jOm7keaWueWFtei/h+ays+adoeS7tuaYr3IgPD0gNA0KICAgICAgLy8g5rKz55WM5L2N5LqOcj005ZKMcj015LmL6Ze077yM57qi5pa55YW16ZyA6KaB6LWw5Yiwcj015omN6IO96L+H5rKz77yM6buR5pa55YW16ZyA6KaB6LWw5Yiwcj005omN6IO96L+H5rKzDQogICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBpc1JlZCA/IHIgPj0gNSA6IHIgPD0gNDsNCiAgICAgIGFkZElmVmFsaWQociArIGZvcndhcmQsIGMpOw0KICAgICAgaWYgKGNyb3NzZWRSaXZlcikgew0KICAgICAgICBhZGRJZlZhbGlkKHIsIGMgLSAxKTsNCiAgICAgICAgYWRkSWZWYWxpZChyLCBjICsgMSk7DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogIH0NCiAgcmV0dXJuIG1vdmVzOw0KfTsNCg0KLy8g6I635Y+W5qOL5a2Q55qE5o6n5Yi254K5DQpjb25zdCBnZXRQaWVjZUNvbnRyb2wgPSAoYm9hcmQsIHBvcywgcGllY2UpID0+IHsNCiAgY29uc3QgY29udHJvbCA9IFtdOw0KICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQoNCiAgY29uc3QgYWRkSWZWYWxpZCA9ICh0ciwgdGMpID0+IHsNCiAgICBpZiAoaXNWYWxpZFBvcyh0ciwgdGMpKSB7DQogICAgICAgIGNvbnRyb2wucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICB9DQogIH07DQoNCiAgLy8g5a+55LqO6Z2e54Ku5qOL5a2Q77yM5o6n5Yi254K55Y+q5YyF5ous5YW25Y+v5Lul5omT5Yiw55qE56m65L2N572u77yM5Y2z5aaC5p6c5pWM5pa55qOL5a2Q6L+b5YWl6L+Z5Lqb54K55bCG6KKr5pS75Ye7DQogIGlmIChwaWVjZS50eXBlICE9PSAnY2Fubm9uJykgew0KICAgIC8vIOiOt+WPluaJgOacieWPr+iDveeahOenu+WKqOS9jee9ru+8jOeEtuWQjui/h+a7pOaOieacieaji+WtkOeahOS9jee9rg0KICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgcG9zLCBwaWVjZSk7DQogICAgbW92ZXMuZm9yRWFjaChtb3ZlID0+IHsNCiAgICAgIC8vIOWPqua3u+WKoOepuuS9jee9ruS9nOS4uuaOp+WItueCuQ0KICAgICAgaWYgKGJvYXJkW21vdmUucl1bbW92ZS5jXSA9PT0gbnVsbCkgew0KICAgICAgICBjb250cm9sLnB1c2gobW92ZSk7DQogICAgICB9DQogICAgfSk7DQogIH0gZWxzZSB7DQogICAgLy8g5a+55LqO54Ku5qOL5a2Q77yM6ZyA6KaB54m55q6K6K6h566X5o6n5Yi254K577yM5o6n5Yi254K55Y+q5YyF5ous5YW25Y+v5Lul5omT5Yiw55qE56m65L2N572u77yM5Y2z5aaC5p6c5pWM5pa55qOL5a2Q6L+b5YWl6L+Z5Lqb54K55bCG6KKr5pS75Ye7DQogICAgLy8g54Ku6IO95o6n5Yi255qE5piv56ysMeS4queCruWPsOS5i+WQju+8iOS4jeWQq+eCruWPsO+8ieesrDLkuKrngq7lj7DkuYvliY3vvIjkuI3lkKvngq7lj7DvvInnmoTmiYDmnInnqbrkvY3nva4NCiAgICAvLyDlpoLmnpzmsqHmnInnrKwy5Liq54Ku5Y+w6YKj5LmI5bCx5piv56ysMeS4queCruWPsOS5i+WQju+8iOS4jeWQq+eCruWPsO+8ieeahOaJgOacieepuuS9jee9rg0KICAgIFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICBsZXQgc2NyZWVuRm91bmRDb3VudCA9IDA7DQogICAgICANCiAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYgc2NyZWVuRm91bmRDb3VudCA8IDIpIHsNCiAgICAgICAgY29uc3QgY3VycmVudFBpZWNlID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgDQogICAgICAgIGlmIChjdXJyZW50UGllY2UgIT09IG51bGwpIHsNCiAgICAgICAgICAvLyDmib7liLDkuIDkuKrngq7lj7DvvIzlop7liqDorqHmlbANCiAgICAgICAgICBzY3JlZW5Gb3VuZENvdW50Kys7DQogICAgICAgIH0gZWxzZSBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMSkgew0KICAgICAgICAgIC8vIOesrDHkuKrngq7lj7DkuYvlkI7vvIznrKwy5Liq54Ku5Y+w5LmL5YmN55qE56m65L2N572u77yM5re75Yqg5Yiw5o6n5Yi254K5DQogICAgICAgICAgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICB9DQogICAgfSk7DQogIH0NCg0KICByZXR1cm4gY29udHJvbDsNCn07DQoNCmNvbnN0IGlzRmx5aW5nR2VuZXJhbCA9IChib2FyZCkgPT4gew0KICBjb25zdCByZWRHID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgJ3JlZCcpOw0KICBjb25zdCBibGFja0cgPSBnZXRHZW5lcmFsUG9zKGJvYXJkLCAnYmxhY2snKTsNCiAgaWYgKCFyZWRHIHx8ICFibGFja0cgfHwgcmVkRy5jICE9PSBibGFja0cuYykgcmV0dXJuIGZhbHNlOw0KICANCiAgLy8g56Gu5L+d5b6q546v5pa55ZCR5q2j56Gu77yM5LuO6L6D5bCP55qEcuWIsOi+g+Wkp+eahHINCiAgY29uc3Qgc3RhcnRSID0gTWF0aC5taW4oYmxhY2tHLnIsIHJlZEcucikgKyAxOw0KICBjb25zdCBlbmRSID0gTWF0aC5tYXgoYmxhY2tHLnIsIHJlZEcucikgLSAxOw0KICANCiAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsNCiAgICBpZiAoYm9hcmRbcl1bcmVkRy5jXSAhPT0gbnVsbCkgcmV0dXJuIGZhbHNlOw0KICB9DQogIHJldHVybiB0cnVlOw0KfTsNCg0KLy8g5pegIGJvYXJkSW5mbyDml7bnmoTlv6vpgJ/lsIblhpvmo4DmtYvvvJrlsIbkvY3nvJPlrZggKyDku47lsIbkvY3lm5vlkJHlsITnur/vvIjovaYv5bCGL+eCruWQiOW5tu+8iQ0KY29uc3QgaXNDaGVja1JhdyA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBjb25zdCBnZW5lcmFsUG9zID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgY29sb3IpOw0KICAgIGlmICghZ2VuZXJhbFBvcykgcmV0dXJuIHRydWU7DQoNCiAgICBjb25zdCBlbmVteUNvbG9yID0gY29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgIGNvbnN0IHsgcjogZ3IsIGM6IGdjIH0gPSBnZW5lcmFsUG9zOw0KDQogICAgLy8g55u057q/77ya56ys5LiA5a2Q5Li65pWM6L2mL+WwhuWImeWwhuWGm++8m+i2iui/h+eCruaetuWQjuesrOS6jOWtkOS4uuaVjOeCruWImeWwhuWGmw0KICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dOw0KICAgIGZvciAoY29uc3QgW2RyLCBkY10gb2YgZGlyZWN0aW9ucykgew0KICAgICAgICBsZXQgbnIgPSBnciArIGRyOw0KICAgICAgICBsZXQgbmMgPSBnYyArIGRjOw0KICAgICAgICBsZXQgc2VlbiA9IDA7DQoNCiAgICAgICAgd2hpbGUgKGlzVmFsaWRQb3MobnIsIG5jKSkgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICBpZiAocCkgew0KICAgICAgICAgICAgICAgIHNlZW4rKzsNCiAgICAgICAgICAgICAgICBpZiAoc2VlbiA9PT0gMSkgew0KICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiAocC50eXBlID09PSAnY2hhcmlvdCcgfHwgcC50eXBlID09PSAnZ2VuZXJhbCcpKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ2Nhbm5vbicpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIG5yICs9IGRyOw0KICAgICAgICAgICAgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDpqazvvJrku47lsIbkvY3lj43mjqjvvIzpqazohb/lnKjpqazkuIDkvqfvvIjkuI4gZ2V0UGllY2VNb3ZlcyDkuIDoh7TvvIkNCiAgICBjb25zdCBob3JzZU1vdmVzID0gW1syLCAxXSwgWzIsIC0xXSwgWy0yLCAxXSwgWy0yLCAtMV0sIFsxLCAyXSwgWzEsIC0yXSwgWy0xLCAyXSwgWy0xLCAtMl1dOw0KICAgIGZvciAoY29uc3QgW2RyLCBkY10gb2YgaG9yc2VNb3Zlcykgew0KICAgICAgICBjb25zdCBuciA9IGdyICsgZHI7DQogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkYzsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MobnIsIG5jKSkgew0KICAgICAgICAgICAgY29uc3QgbGVnUiA9IG5yIC0gKE1hdGguYWJzKGRyKSA9PT0gMiA/IE1hdGguc2lnbihkcikgOiAwKTsNCiAgICAgICAgICAgIGNvbnN0IGxlZ0MgPSBuYyAtIChNYXRoLmFicyhkYykgPT09IDIgPyBNYXRoLnNpZ24oZGMpIDogMCk7DQogICAgICAgICAgICBpZiAoYm9hcmRbbGVnUl1bbGVnQ10gPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ2hvcnNlJykgew0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDlo6vvvIjkuZ3lrqvlhoXvvIkNCiAgICBjb25zdCBhZHZpc29yTW92ZXMgPSBbWzEsIDFdLCBbMSwgLTFdLCBbLTEsIDFdLCBbLTEsIC0xXV07DQogICAgZm9yIChjb25zdCBbZHIsIGRjXSBvZiBhZHZpc29yTW92ZXMpIHsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGRyOw0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYNCiAgICAgICAgICAgICgoY29sb3IgPT09ICdyZWQnICYmIG5yID49IDAgJiYgbnIgPD0gMikgfHwgKGNvbG9yID09PSAnYmxhY2snICYmIG5yID49IDcgJiYgbnIgPD0gOSkpICYmDQogICAgICAgICAgICBuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdhZHZpc29yJykgew0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5YW177ya5q2j5YmN5pa55aeL57uI5Y+v5pS777yb5bem5Y+z5LuF6L+H5rKz5YW1DQogICAgY29uc3QgZW5lbXlGb3J3YXJkID0gZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyAxIDogLTE7DQogICAgY29uc3QgZm9yd2FyZEZyb21SID0gZ3IgLSBlbmVteUZvcndhcmQ7DQogICAgaWYgKGlzVmFsaWRQb3MoZm9yd2FyZEZyb21SLCBnYykpIHsNCiAgICAgICAgY29uc3QgcCA9IGJvYXJkW2ZvcndhcmRGcm9tUl1bZ2NdOw0KICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7DQogICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBmb3IgKGNvbnN0IGRjIG9mIFsxLCAtMV0pIHsNCiAgICAgICAgY29uc3QgbmMgPSBnYyArIGRjOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhnciwgbmMpKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbZ3JdW25jXTsNCiAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnc29sZGllcicpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBlbmVteUNvbG9yID09PSAncmVkJyA/IGdyID49IDUgOiBnciA8PSA0Ow0KICAgICAgICAgICAgICAgIGlmIChjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgcmV0dXJuIGZhbHNlOw0KfTsNCg0KY29uc3QgaXNDaGVjayA9IChib2FyZCwgY29sb3IsIHBpZWNlc0luZm8gPSBudWxsLCBib2FyZEluZm8gPSBudWxsKSA9PiB7DQogICAgLy8g5LyY5YWI5L2/55So6aKE6K6h566X55qE5bCG5Yab54q25oCBDQogICAgaWYgKGJvYXJkSW5mbykgew0KICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZElzSW5DaGVjayA6IGJvYXJkSW5mby5ibGFja0lzSW5DaGVjazsNCiAgICB9DQoNCiAgICAvLyDlpoLmnpzmnIlwaWVjZXNJbmZv77yM5Lmf5Y+v5Lul5LuO5Lit6I635Y+W5bCG5Yab54q25oCBDQogICAgaWYgKHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7DQogICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyBwaWVjZXNJbmZvWzBdLnJlZElzSW5DaGVjayA6IHBpZWNlc0luZm9bMF0uYmxhY2tJc0luQ2hlY2s7DQogICAgfQ0KDQogICAgcmV0dXJuIGlzQ2hlY2tSYXcoYm9hcmQsIGNvbG9yKTsNCn07DQoNCi8vIOWQiOazleedgOazle+8muS8quWQiOazlSArIOS4jemAgeWwhi/kuI3po57lsIbvvIhtYWtlL3VubWFrZe+8iQ0KY29uc3QgZ2V0VmFsaWRNb3ZlcyA9IChib2FyZCwgcG9zKSA9PiB7DQogIGNvbnN0IHBpZWNlID0gYm9hcmRbcG9zLnJdW3Bvcy5jXTsNCiAgaWYgKCFwaWVjZSkgcmV0dXJuIFtdOw0KICBjb25zdCBwc2V1ZG9Nb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHBvcywgcGllY2UpOw0KICByZXR1cm4gZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgcG9zLCBwaWVjZSwgcHNldWRvTW92ZXMpOw0KfTsNCg0KY29uc3QgaXNWYWxpZFBsYWNlbWVudCA9ICh0eXBlLCBjb2xvciwgciwgYykgPT4gew0KICAgIGNvbnN0IGlzUmVkID0gY29sb3IgPT09ICdyZWQnOw0KICAgIHN3aXRjaCh0eXBlKSB7DQogICAgICAgIGNhc2UgJ2dlbmVyYWwnOg0KICAgICAgICAgICAgLy8g5biF5bCG5Y+q6IO95Zyo5Lmd5a6r5Lit5b+D55qE5LiA5p2h57q/5LiKDQogICAgICAgICAgICBpZiAoYyA8IDMgfHwgYyA+IDUpIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgIGlmIChpc1JlZCkgcmV0dXJuIHIgPj0gMCAmJiByIDw9IDI7DQogICAgICAgICAgICBlbHNlIHJldHVybiByID49IDcgJiYgciA8PSA5Ow0KICAgICAgICBjYXNlICdhZHZpc29yJzoNCiAgICAgICAgICAgIC8vIOWjq+WPquiDveWcqOS5neWuq+eahDXkuKrngrnkuYvkuIANCiAgICAgICAgICAgIGNvbnN0IHZhbGlkQWR2aXNvclBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IFtbMCwgM10sIFswLCA1XSwgWzEsIDRdLCBbMiwgM10sIFsyLCA1XV0sDQogICAgICAgICAgICAgICAgYmxhY2s6IFtbNywgM10sIFs3LCA1XSwgWzgsIDRdLCBbOSwgM10sIFs5LCA1XV0NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICByZXR1cm4gdmFsaWRBZHZpc29yUG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXS5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgY2FzZSAnZWxlcGhhbnQnOg0KICAgICAgICAgICAgLy8g55u45Y+q6IO95Zyo5bex5pa55Y2K5Zy655qEN+S4queCueS5i+S4gA0KICAgICAgICAgICAgY29uc3QgdmFsaWRFbGVwaGFudFBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IFtbMCwgMl0sIFswLCA2XSwgWzIsIDBdLCBbMiwgNF0sIFsyLCA4XSwgWzQsIDJdLCBbNCwgNl1dLA0KICAgICAgICAgICAgICAgIGJsYWNrOiBbWzUsIDJdLCBbNSwgNl0sIFs3LCAwXSwgWzcsIDRdLCBbNywgOF0sIFs5LCAyXSwgWzksIDZdXQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIHJldHVybiB2YWxpZEVsZXBoYW50UG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXS5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgY2FzZSAnc29sZGllcic6DQogICAgICAgICAgICAvLyDlhbXnmoTkvY3nva7pmZDliLbvvJrov4fmsrPliY3lj6rog73lnKjlgbbmlbDliJfvvIzov4fmsrPlkI7lj6/ku6XlnKjku7vkvZXliJcNCiAgICAgICAgICAgIC8vIOe6ouaWueWFtei/h+ays+adoeS7tuaYr3IgPj0gNe+8jOm7keaWueWFtei/h+ays+adoeS7tuaYr3IgPD0gNA0KICAgICAgICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gaXNSZWQgPyByID49IDUgOiByIDw9IDQ7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgICAgICAgICAgLy8g6L+H5rKz5YmN5Y+q6IO95Zyo5YG25pWw5YiX77yIYz0wLDIsNCw2LDjvvIkNCiAgICAgICAgICAgICAgICBpZiAoIVswLCAyLCA0LCA2LCA4XS5pbmNsdWRlcyhjKSkgcmV0dXJuIGZhbHNlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDlhbXnmoTkvY3nva7pmZDliLbvvJrov4fmsrPliY3lj6rog73lnKjlhbXkvY3lkozlhbXkvY3liY3mlrnvvIzov4fmsrPlkI7mlYzmlrnljYrlnLrpg73lkIjms5UNCiAgICAgICAgICAgIGNvbnN0IHZhbGlkU29sZGllclBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IHsNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa55Yid5aeL5YW15L2N77yacj0zLCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBpbml0aWFsOiBbWzMsIDBdLCBbMywgMl0sIFszLCA0XSwgWzMsIDZdLCBbMywgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnlhbXkvY3liY3mlrnvvJpyPTQsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGZvcndhcmQ6IFtbNCwgMF0sIFs0LCAyXSwgWzQsIDRdLCBbNCwgNl0sIFs0LCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/h+ays+e6v++8mnI+PTUNCiAgICAgICAgICAgICAgICAgICAgY3Jvc3NlZFJpdmVyOiByID49IDUNCiAgICAgICAgICAgICAgICB9LA0KICAgICAgICAgICAgICAgIGJsYWNrOiB7DQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueWIneWni+WFteS9je+8mnI9NiwgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbDogW1s2LCAwXSwgWzYsIDJdLCBbNiwgNF0sIFs2LCA2XSwgWzYsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55YW15L2N5YmN5pa577yacj01LCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBmb3J3YXJkOiBbWzUsIDBdLCBbNSwgMl0sIFs1LCA0XSwgWzUsIDZdLCBbNSwgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov4fmsrPnur/vvJpyPD00DQogICAgICAgICAgICAgICAgICAgIGNyb3NzZWRSaXZlcjogciA8PSA0DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgY29uc3Qgc29sZGllckluZm8gPSB2YWxpZFNvbGRpZXJQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddOw0KICAgICAgICAgICAgY29uc3QgaXNJbml0aWFsUG9zID0gc29sZGllckluZm8uaW5pdGlhbC5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgICAgIGNvbnN0IGlzRm9yd2FyZFBvcyA9IHNvbGRpZXJJbmZvLmZvcndhcmQuc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChzb2xkaWVySW5mby5jcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICAvLyDov4fmsrPlkI7mlYzmlrnljYrlnLrpg73lkIjms5UNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g6L+H5rKz5YmN5Y+q6IO95Zyo5YW15L2N5ZKM5YW15L2N5YmN5pa5DQogICAgICAgICAgICAgICAgcmV0dXJuIGlzSW5pdGlhbFBvcyB8fCBpc0ZvcndhcmRQb3M7DQogICAgICAgICAgICB9DQogICAgICAgIGRlZmF1bHQ6DQogICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICB9DQp9Ow0KDQpjb25zdCBjaGVja0dhbWVTdGF0ZSA9IChib2FyZCwgdHVybiwgcGllY2VzSW5mbyA9IG51bGwsIGJvYXJkSW5mbyA9IG51bGwpID0+IHsNCiAgICAvLyDkvJjlhYjkvb/nlKjpooTorqHnrpfnmoRnYW1lU3RhdGUNCiAgICBpZiAoYm9hcmRJbmZvICYmIGJvYXJkSW5mby5nYW1lU3RhdGUpIHsNCiAgICAgICAgcmV0dXJuIGJvYXJkSW5mby5nYW1lU3RhdGU7DQogICAgfQ0KICAgIA0KICAgIC8vIOayoeaciemihOiuoeeul+e7k+aenOaXtu+8jOaJp+ihjOWOn+Wni+iuoeeulw0KICAgIGxldCBoYXNNb3ZlcyA9IGZhbHNlOw0KICAgIGZvcihsZXQgcj0wOyByPFJPV1M7IHIrKykgew0KICAgICAgICBmb3IobGV0IGM9MDsgYzxDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgICAgICAgICBpZiAoZ2V0VmFsaWRNb3Zlcyhib2FyZCwge3IsY30pLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICAgICAgaGFzTW92ZXMgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKGhhc01vdmVzKSBicmVhazsNCiAgICB9DQoNCiAgICBpZiAoaGFzTW92ZXMpIHJldHVybiB7IHN0YXR1czogJ3BsYXlpbmcnIH07DQoNCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVjayhib2FyZCwgdHVybiwgcGllY2VzSW5mbywgYm9hcmRJbmZvKTsNCiAgICBjb25zdCBvcHBvbmVudCA9IHR1cm4gPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgIA0KICAgIGlmIChpbkNoZWNrKSB7DQogICAgICAgIHJldHVybiB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICB9IGVsc2Ugew0KICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfQ0KfTsNCg0KDQoNCi8vIOWinuW8uueahOa4uOaIj+mYtuauteivhuWIqw0KY29uc3QgZ2V0R2FtZVBoYXNlID0gKGJvYXJkKSA9PiB7DQogIC8qDQogIGNvbnN0IHBpZWNlQ291bnQgPSBjb3VudFBpZWNlcyhib2FyZCk7DQogIA0KICBpZiAocGllY2VDb3VudCA8PSA4KSByZXR1cm4gJ2VuZGdhbWUnOw0KICBpZiAocGllY2VDb3VudCA8PSAxNikgcmV0dXJuICdtaWRkbGVnYW1lJzsNCiAgcmV0dXJuICdvcGVuaW5nJzsNCiAgKi8NCiAgcmV0dXJuICdvcGVuaW5nJzsNCn07DQoNCi8vIOWKqOaAgeadg+mHjeiuoeeulw0KY29uc3QgY2FsY3VsYXRlRHluYW1pY1dlaWdodHMgPSAocGhhc2UpID0+IHsNCiAgc3dpdGNoIChwaGFzZSkgew0KICAgIGNhc2UgJ29wZW5pbmcnOg0KICAgICAgcmV0dXJuIHsgbWF0ZXJpYWw6IDgsIHBvc2l0aW9uOiAyLCB0YWN0aWM6IDYsIHNhZmV0eTogNCwgbW9iaWxpdHk6IDcsIHRocmVhdDogMyB9Ow0KICAgIGNhc2UgJ21pZGRsZWdhbWUnOg0KICAgICAgcmV0dXJuIHsgbWF0ZXJpYWw6IDYsIHBvc2l0aW9uOiA5LCB0YWN0aWM6IDcsIHNhZmV0eTogNiwgbW9iaWxpdHk6IDgsIHRocmVhdDogNyB9Ow0KICAgIGNhc2UgJ2VuZGdhbWUnOg0KICAgICAgcmV0dXJuIHsgbWF0ZXJpYWw6IDksIHBvc2l0aW9uOiA3LCB0YWN0aWM6IDIsIHNhZmV0eTogOCwgbW9iaWxpdHk6IDQsIHRocmVhdDogOSB9Ow0KICAgIGRlZmF1bHQ6DQogICAgICByZXR1cm4geyBtYXRlcmlhbDogOCwgcG9zaXRpb246IDUsIHRhY3RpYzogNSwgc2FmZXR5OiA2LCBtb2JpbGl0eTogNSwgdGhyZWF0OiA1IH07DQogIH0NCn07DQoNCi8vIOiuoeeul+aji+WtkOaAu+aVsA0KY29uc3QgY291bnRQaWVjZXMgPSAoYm9hcmQpID0+IHsNCiAgbGV0IGNvdW50ID0gMDsNCiAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgaWYgKGJvYXJkW3JdW2NdKSBjb3VudCsrOw0KICAgIH0NCiAgfQ0KICByZXR1cm4gY291bnQ7DQp9Ow0KDQovLyDlrp7kvovljJZab2JyaXN0SGFzaGVyDQpjb25zdCB6b2JyaXN0SGFzaGVyID0gbmV3IFpvYnJpc3RIYXNoZXIoKTsNCg0KLy8g572u5o2i6KGo5a6e546w77yI5a656YeP57qmIDJeMjDvvIzpgb/lhY0gTWFwIOi/h+Wkp+aLluaFoiBHQ++8iQ0KY2xhc3MgVHJhbnNwb3NpdGlvblRhYmxlIHsNCiAgICBjb25zdHJ1Y3RvcihzaXplID0gTWF0aC5wb3coMiwgMjApKSB7DQogICAgICAgIHRoaXMudGFibGUgPSBuZXcgTWFwKCk7DQogICAgICAgIHRoaXMuc2l6ZSA9IHNpemU7DQogICAgICAgIHRoaXMuaGFzaGVyID0gem9icmlzdEhhc2hlcjsNCiAgICAgICAgLy8g57uf6K6h5L+h5oGvDQogICAgICAgIHRoaXMuc3RhdHMgPSB7DQogICAgICAgICAgICBoaXRzOiAwLA0KICAgICAgICAgICAgbWlzc2VzOiAwLA0KICAgICAgICAgICAgZXhhY3RIaXRzOiAwLA0KICAgICAgICAgICAgbG93ZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICB1cHBlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHN0b3JlczogMCwNCiAgICAgICAgICAgIGxydUV2aWN0aW9uczogMCwNCiAgICAgICAgICAgIGNsZWFyczogMA0KICAgICAgICB9Ow0KICAgIH0NCiAgICANCiAgICBzdG9yZShrZXksIGRlcHRoLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUgPSBudWxsLCBtb3ZlU2VxdWVuY2UgPSBudWxsKSB7DQogICAgICAgIGlmICh0aGlzLnRhYmxlLnNpemUgPj0gdGhpcy5zaXplKSB7DQogICAgICAgICAgICAvLyDnroDljZXnmoRMUlXnrZbnlaXvvJrnp7vpmaTnrKzkuIDkuKrlhYPntKANCiAgICAgICAgICAgIGNvbnN0IGZpcnN0S2V5ID0gdGhpcy50YWJsZS5rZXlzKCkubmV4dCgpLnZhbHVlOw0KICAgICAgICAgICAgdGhpcy50YWJsZS5kZWxldGUoZmlyc3RLZXkpOw0KICAgICAgICAgICAgdGhpcy5zdGF0cy5scnVFdmljdGlvbnMrKzsNCiAgICAgICAgfQ0KICAgICAgICB0aGlzLnRhYmxlLnNldChrZXksIHsgZGVwdGgsIHZhbHVlLCBmbGFnLCBiZXN0TW92ZSwgbW92ZVNlcXVlbmNlIH0pOw0KICAgICAgICB0aGlzLnN0YXRzLnN0b3JlcysrOw0KICAgIH0NCiAgICANCiAgICByZXRyaWV2ZShrZXkpIHsNCiAgICAgICAgY29uc3QgZW50cnkgPSB0aGlzLnRhYmxlLmdldChrZXkpIHx8IG51bGw7DQogICAgICAgIGlmIChlbnRyeSkgew0KICAgICAgICAgICAgdGhpcy5zdGF0cy5oaXRzKys7DQogICAgICAgICAgICAvLyDnu5/orqHkuI3lkIznsbvlnovnmoTlkb3kuK0NCiAgICAgICAgICAgIHN3aXRjaCAoZW50cnkuZmxhZykgew0KICAgICAgICAgICAgICAgIGNhc2UgJ2V4YWN0JzoNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0cy5leGFjdEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgY2FzZSAnbG93ZXJib3VuZCc6DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMubG93ZXJib3VuZEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgY2FzZSAndXBwZXJib3VuZCc6DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMudXBwZXJib3VuZEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICB0aGlzLnN0YXRzLm1pc3NlcysrOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBlbnRyeTsNCiAgICB9DQogICAgDQogICAgY2xlYXIoKSB7DQogICAgICAgIHRoaXMudGFibGUuY2xlYXIoKTsNCiAgICAgICAgdGhpcy5zdGF0cy5jbGVhcnMrKzsNCiAgICB9DQogICAgDQogICAgLy8g6I635Y+W57uf6K6h5L+h5oGv5bm26K6h566X5ZG95Lit546HDQogICAgZ2V0U3RhdHMoKSB7DQogICAgICAgIGNvbnN0IHRvdGFsQWNjZXNzZXMgPSB0aGlzLnN0YXRzLmhpdHMgKyB0aGlzLnN0YXRzLm1pc3NlczsNCiAgICAgICAgY29uc3QgaGl0UmF0ZSA9IHRvdGFsQWNjZXNzZXMgPiAwID8gKHRoaXMuc3RhdHMuaGl0cyAvIHRvdGFsQWNjZXNzZXMgKiAxMDApLnRvRml4ZWQoMikgOiAwOw0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgLi4udGhpcy5zdGF0cywNCiAgICAgICAgICAgIHRvdGFsQWNjZXNzZXMsDQogICAgICAgICAgICBoaXRSYXRlLA0KICAgICAgICAgICAgY3VycmVudFNpemU6IHRoaXMudGFibGUuc2l6ZSwNCiAgICAgICAgICAgIG1heFNpemU6IHRoaXMuc2l6ZSwNCiAgICAgICAgICAgIGZpbGxQZXJjZW50YWdlOiAodGhpcy50YWJsZS5zaXplIC8gdGhpcy5zaXplICogMTAwKS50b0ZpeGVkKDIpDQogICAgICAgIH07DQogICAgfQ0KICAgIA0KICAgIC8vIOmHjee9rue7n+iuoeS/oeaBrw0KICAgIHJlc2V0U3RhdHMoKSB7DQogICAgICAgIHRoaXMuc3RhdHMgPSB7DQogICAgICAgICAgICBoaXRzOiAwLA0KICAgICAgICAgICAgbWlzc2VzOiAwLA0KICAgICAgICAgICAgZXhhY3RIaXRzOiAwLA0KICAgICAgICAgICAgbG93ZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICB1cHBlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHN0b3JlczogMCwNCiAgICAgICAgICAgIGxydUV2aWN0aW9uczogMCwNCiAgICAgICAgICAgIGNsZWFyczogMA0KICAgICAgICB9Ow0KICAgIH0NCn0NCg0KLy8g5oCn6IO957uf6K6hDQpsZXQgcGVyZlN0YXRzID0gew0KICAgIGV2YWx1YXRlQm9hcmRDb3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sDQogICAgcHJlcGFyZVNlYXJjaEluZm9Db3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sDQogICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnQ6IHsgcmVkOiAwLCBibGFjazogMCB9LA0KICAgIGFscGhhQmV0YUNhbGxzOiAwLCAgLy8g5oC76LCD55So5qyh5pWwDQogICAgbm9kZXNTZWFyY2hlZDoge30sIC8vIOaMiea3seW6pue7n+iuoeaQnOe0oueahOiKgueCueaVsA0KICAgIG1vdmVzR2VuZXJhdGVkOiB7fSwgLy8g5oyJ5rex5bqm57uf6K6h55Sf5oiQ55qE6LWw5rOV5pWwDQogICAgY3V0b2Zmczoge30sIC8vIOaMiea3seW6pue7n+iuoeWJquaeneasoeaVsA0KICAgIC8vIOWQiOazleaAp+i3r+W+hO+8muS8quWQiOazleeUn+aIkOmHj+OAgeivlei1sOWQiOazleaAp+ajgOa1i+OAgemdnuazlei3s+i/h+OAgeWunumZhei/m+WFpeaQnOe0oueahOWQiOazleedgA0KICAgIHBzZXVkb01vdmVzR2VuZXJhdGVkOiAwLA0KICAgIGxlZ2FsaXR5Q2hlY2tzOiAwLA0KICAgIGlsbGVnYWxNb3Zlc1NraXBwZWQ6IDAsDQogICAgbGVnYWxNb3Zlc1NlYXJjaGVkOiAwLA0KICAgIC8vIFpvYnJpc3TvvJrlhajnm5jph43nrpfmrKHmlbAgLyDlop7ph4/mm7TmlrDmrKHmlbAgLyDmoKHpqozkuI3kuIDoh7TvvIjku4UgdmVyaWZ5IOaooeW8j++8iQ0KICAgIGZ1bGxIYXNoQ291bnQ6IDAsDQogICAgaW5jcmVtZW50YWxIYXNoVXBkYXRlczogMCwNCiAgICBoYXNoTWlzbWF0Y2hlczogMCwNCiAgICBzdGFydFRpbWU6IERhdGUubm93KCkNCn07DQoNCi8vIOmHjee9rue7n+iuoe+8iOavj+asoeaQnOe0ouW8gOWni+aXtuiwg+eUqO+8iQ0KY29uc3QgcmVzZXRQZXJmU3RhdHMgPSAoKSA9PiB7DQogICAgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRDb3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50ID0geyByZWQ6IDAsIGJsYWNrOiAwIH07DQogICAgcGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50ID0geyByZWQ6IDAsIGJsYWNrOiAwIH07DQogICAgcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzID0gMDsNCiAgICBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZCA9IHt9Ow0KICAgIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZCA9IHt9Ow0KICAgIHBlcmZTdGF0cy5jdXRvZmZzID0ge307DQogICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkID0gMDsNCiAgICBwZXJmU3RhdHMubGVnYWxpdHlDaGVja3MgPSAwOw0KICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkID0gMDsNCiAgICBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkID0gMDsNCiAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCA9IDA7DQogICAgcGVyZlN0YXRzLmluY3JlbWVudGFsSGFzaFVwZGF0ZXMgPSAwOw0KICAgIHBlcmZTdGF0cy5oYXNoTWlzbWF0Y2hlcyA9IDA7DQogICAgcGVyZlN0YXRzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7DQp9Ow0KDQpjb25zdCBzbmFwc2hvdFBlcmZTdGF0cyA9ICgpID0+IHsNCiAgICBjb25zdCBlbGFwc2VkID0gRGF0ZS5ub3coKSAtIHBlcmZTdGF0cy5zdGFydFRpbWU7DQogICAgY29uc3QgdHRTdGF0cyA9IHRyYW5zcG9zaXRpb25UYWJsZS5nZXRTdGF0cygpOw0KICAgIGNvbnN0IGRlcHRocyA9IE9iamVjdC5rZXlzKHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkKS5zb3J0KChhLCBiKSA9PiBOdW1iZXIoYSkgLSBOdW1iZXIoYikpOw0KICAgIGNvbnN0IGJ5RGVwdGggPSB7fTsNCiAgICBmb3IgKGNvbnN0IGQgb2YgZGVwdGhzKSB7DQogICAgICAgIGJ5RGVwdGhbZF0gPSB7DQogICAgICAgICAgICBub2RlczogcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0gfHwgMCwNCiAgICAgICAgICAgIG1vdmVzOiBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gfHwgMCwNCiAgICAgICAgICAgIGN1dG9mZnM6IHBlcmZTdGF0cy5jdXRvZmZzW2RdIHx8IDANCiAgICAgICAgfTsNCiAgICB9DQogICAgcmV0dXJuIHsNCiAgICAgICAgZWxhcHNlZE1zOiBlbGFwc2VkLA0KICAgICAgICBkZWZlckxlZ2FsaXR5OiBTRUFSQ0hfREVGRVJfTEVHQUxJVFksDQogICAgICAgIGluY3JlbWVudGFsWm9icmlzdDogU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QsDQogICAgICAgIGV2YWx1YXRlQm9hcmQ6IHsgLi4ucGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRDb3VudCB9LA0KICAgICAgICBwcmVwYXJlU2VhcmNoSW5mbzogeyAuLi5wZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudCB9LA0KICAgICAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXM6IHsgLi4ucGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50IH0sDQogICAgICAgIGFscGhhQmV0YUNhbGxzOiBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMsDQogICAgICAgIHBzZXVkb01vdmVzR2VuZXJhdGVkOiBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQsDQogICAgICAgIGxlZ2FsaXR5Q2hlY2tzOiBwZXJmU3RhdHMubGVnYWxpdHlDaGVja3MsDQogICAgICAgIGlsbGVnYWxNb3Zlc1NraXBwZWQ6IHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkLA0KICAgICAgICBsZWdhbE1vdmVzU2VhcmNoZWQ6IHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQsDQogICAgICAgIGZ1bGxIYXNoQ291bnQ6IHBlcmZTdGF0cy5mdWxsSGFzaENvdW50LA0KICAgICAgICBpbmNyZW1lbnRhbEhhc2hVcGRhdGVzOiBwZXJmU3RhdHMuaW5jcmVtZW50YWxIYXNoVXBkYXRlcywNCiAgICAgICAgaGFzaE1pc21hdGNoZXM6IHBlcmZTdGF0cy5oYXNoTWlzbWF0Y2hlcywNCiAgICAgICAgdHQ6IHR0U3RhdHMsDQogICAgICAgIGJ5RGVwdGgNCiAgICB9Ow0KfTsNCg0KLy8g5omT5Y2w57uf6K6h5L+h5oGvDQpjb25zdCBsb2dQZXJmU3RhdHMgPSAoY3VycmVudFBsYXllcikgPT4gew0KICAgIGNvbnN0IHNuYXAgPSBzbmFwc2hvdFBlcmZTdGF0cygpOw0KICAgIGNvbnNvbGUubG9nKGDwn5OKIOaAp+iDvee7n+iuoSAoJHtjdXJyZW50UGxheWVyfSkgLSAke3NuYXAuZWxhcHNlZE1zfW1zOmApOw0KICAgIGNvbnNvbGUubG9nKGAgICBldmFsdWF0ZUJvYXJkOiByZWQ9JHtzbmFwLmV2YWx1YXRlQm9hcmQucmVkfSwgYmxhY2s9JHtzbmFwLmV2YWx1YXRlQm9hcmQuYmxhY2t9YCk7DQogICAgY29uc29sZS5sb2coYCAgIHByZXBhcmVTZWFyY2hJbmZvOiByZWQ9JHtzbmFwLnByZXBhcmVTZWFyY2hJbmZvLnJlZH0sIGJsYWNrPSR7c25hcC5wcmVwYXJlU2VhcmNoSW5mby5ibGFja31gKTsNCiAgICBjb25zb2xlLmxvZyhgICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzOiByZWQ9JHtzbmFwLmNhbGN1bGF0ZVRocmVhdFZhbHVlcy5yZWR9LCBibGFjaz0ke3NuYXAuY2FsY3VsYXRlVGhyZWF0VmFsdWVzLmJsYWNrfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBhbHBoYUJldGHosIPnlKjmrKHmlbA6ICR7c25hcC5hbHBoYUJldGFDYWxsc31gKTsNCiAgICBjb25zb2xlLmxvZyhgICAg5ZCI5rOV5oCnOiBwc2V1ZG89JHtzbmFwLnBzZXVkb01vdmVzR2VuZXJhdGVkfSwgY2hlY2tzPSR7c25hcC5sZWdhbGl0eUNoZWNrc30sIGlsbGVnYWxTa2lwPSR7c25hcC5pbGxlZ2FsTW92ZXNTa2lwcGVkfSwgbGVnYWxTZWFyY2hlZD0ke3NuYXAubGVnYWxNb3Zlc1NlYXJjaGVkfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBab2JyaXN0OiBpbmNyZW1lbnRhbD0ke3NuYXAuaW5jcmVtZW50YWxab2JyaXN0fSwgZnVsbEhhc2g9JHtzbmFwLmZ1bGxIYXNoQ291bnR9LCBpbmNyVXBkYXRlcz0ke3NuYXAuaW5jcmVtZW50YWxIYXNoVXBkYXRlc30sIG1pc21hdGNoZXM9JHtzbmFwLmhhc2hNaXNtYXRjaGVzfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBUVDogaGl0cz0ke3NuYXAudHQuaGl0c30sIG1pc3Nlcz0ke3NuYXAudHQubWlzc2VzfSwgaGl0UmF0ZT0ke3NuYXAudHQuaGl0UmF0ZX0lLCBzdG9yZXM9JHtzbmFwLnR0LnN0b3Jlc30sIHNpemU9JHtzbmFwLnR0LmN1cnJlbnRTaXplfWApOw0KICAgIA0KICAgIGNvbnN0IGRlcHRocyA9IE9iamVjdC5rZXlzKHNuYXAuYnlEZXB0aCk7DQogICAgaWYgKGRlcHRocy5sZW5ndGggPiAwKSB7DQogICAgICAgIGNvbnNvbGUubG9nKCcgICDmjInmt7Hluqbnu5/orqE6Jyk7DQogICAgICAgIGZvciAoY29uc3QgZCBvZiBkZXB0aHMpIHsNCiAgICAgICAgICAgIGNvbnN0IHJvdyA9IHNuYXAuYnlEZXB0aFtkXTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICAgIOa3seW6piR7ZH06IOiKgueCuT0ke3Jvdy5ub2Rlc30sIOi1sOazlT0ke3Jvdy5tb3Zlc30sIOWJquaenT0ke3Jvdy5jdXRvZmZzfWApOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KY29uc3QgdHJhbnNwb3NpdGlvblRhYmxlID0gbmV3IFRyYW5zcG9zaXRpb25UYWJsZSgpOw0KDQovLyDlj7bor4TkvLDnvJPlrZjvvIjlrozmlbTlvaLlir/liIbvvInvvJvmr4/mrKEgZ2V0QmVzdE1vdmUg5riF56m6DQpjb25zdCBFVkFMX0NBQ0hFX01BWCA9IE1hdGgucG93KDIsIDE4KTsNCmNvbnN0IGV2YWxDYWNoZSA9IG5ldyBNYXAoKTsNCmNvbnN0IGNsZWFyRXZhbENhY2hlID0gKCkgPT4gew0KICAgIGV2YWxDYWNoZS5jbGVhcigpOw0KfTsNCg0KLy8g5Ymq5p6d5byA5YWz77ya5a6M5pW06K+E5Lyw5LiL6Iul5byA5bGA5Ye65bqf5qOL5YiZ5YWI5YWz77yM5L+d5qOL5Yqb5YaN6YeN5qCH5a6aDQpjb25zdCBTRUFSQ0hfRU5BQkxFX05NUCA9IGZhbHNlOw0KY29uc3QgU0VBUkNIX0VOQUJMRV9MTVIgPSBmYWxzZTsNCg0KLy8g552A5rOV5ZCI5rOV5oCn77yadHJ1ZT3mkJzntKLlhoXor5XotbDml7bmo4DmtYvvvIjlj6/ot7Pov4fliarmnp3mnKrop6blj4rnnYDms5XvvInvvJtmYWxzZT1wcmVwYXJlIOaXtuWFqOmHjyBmaWx0ZXJMZWdhbE1vdmVz77yI5pen6Lev5b6E77yJDQpsZXQgU0VBUkNIX0RFRkVSX0xFR0FMSVRZID0gdHJ1ZTsNCg0KLy8gWm9icmlzdC9UVO+8mnRydWU95pCc57Si5YaF5aKe6YeP57u05oqk5bGA6Z2i5ZOI5biMICsg5pWw5YC8IFRUIGtlee+8m2ZhbHNlPeavj+iKgueCueWFqOebmCBoYXNoICsg5a2X56ym5LiyIGtlee+8iOaXp+i3r+W+hO+8jOS+v+S6jiBBL0LvvIkNCmxldCBTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCA9IHRydWU7DQovLyDosIPor5XvvJrlop7ph4/lkI7kuI7lhajnm5ggaGFzaCDmr5Tlr7nvvIjku4XmoKHpqozohJrmnKzlvIDlkK/vvIzmraPlvI/mkJzntKLlhbPpl63vvIkNCmxldCBTRUFSQ0hfWk9CUklTVF9WRVJJRlkgPSBmYWxzZTsNCg0KLy8g5pCc57Si5ZCv5Y+R77ya5p2A5qOL6KGoICsg5Y6G5Y+y5ZCv5Y+R77yI5q+P5qyhIGdldEJlc3RNb3ZlIOmHjee9ru+8iQ0KbGV0IGtpbGxlck1vdmVzID0gW107DQpsZXQgaGlzdG9yeVRhYmxlID0gbnVsbDsNCg0KY29uc3QgcmVzZXRTZWFyY2hIZXVyaXN0aWNzID0gKG1heERlcHRoKSA9PiB7DQogICAga2lsbGVyTW92ZXMgPSBBcnJheShtYXhEZXB0aCArIDIpLmZpbGwobnVsbCkubWFwKCgpID0+IFtudWxsLCBudWxsXSk7DQogICAgaGlzdG9yeVRhYmxlID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogMTAgfSwgKCkgPT4NCiAgICAgICAgQXJyYXkuZnJvbSh7IGxlbmd0aDogOSB9LCAoKSA9Pg0KICAgICAgICAgICAgQXJyYXkuZnJvbSh7IGxlbmd0aDogMTAgfSwgKCkgPT4gQXJyYXkoOSkuZmlsbCgwKSkNCiAgICAgICAgKQ0KICAgICk7DQp9Ow0KDQpjb25zdCBpc1NhbWVNb3ZlID0gKGEsIGIpID0+DQogICAgYSAmJiBiICYmDQogICAgYS5mcm9tLnIgPT09IGIuZnJvbS5yICYmIGEuZnJvbS5jID09PSBiLmZyb20uYyAmJg0KICAgIGEudG8uciA9PT0gYi50by5yICYmIGEudG8uYyA9PT0gYi50by5jOw0KDQpjb25zdCBzdG9yZUtpbGxlck1vdmUgPSAoZGVwdGgsIG1vdmUpID0+IHsNCiAgICBpZiAoZGVwdGggPCAwIHx8IGRlcHRoID49IGtpbGxlck1vdmVzLmxlbmd0aCB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGNvbnN0IHNsb3QgPSBraWxsZXJNb3Zlc1tkZXB0aF07DQogICAgaWYgKGlzU2FtZU1vdmUoc2xvdFswXSwgbW92ZSkpIHJldHVybjsNCiAgICBzbG90WzFdID0gc2xvdFswXTsNCiAgICBzbG90WzBdID0geyBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiBtb3ZlLmZyb20uYyB9LCB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IG1vdmUudG8uYyB9IH07DQp9Ow0KDQpjb25zdCBhZGRIaXN0b3J5U2NvcmUgPSAobW92ZSwgZGVwdGgpID0+IHsNCiAgICBpZiAoIWhpc3RvcnlUYWJsZSB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGNvbnN0IHsgZnJvbSwgdG8gfSA9IG1vdmU7DQogICAgaGlzdG9yeVRhYmxlW2Zyb20ucl1bZnJvbS5jXVt0by5yXVt0by5jXSArPSBkZXB0aCAqIGRlcHRoOw0KfTsNCg0KY29uc3QgZ2V0SGlzdG9yeVNjb3JlID0gKG1vdmUpID0+IHsNCiAgICBpZiAoIWhpc3RvcnlUYWJsZSB8fCAhbW92ZSkgcmV0dXJuIDA7DQogICAgY29uc3QgeyBmcm9tLCB0byB9ID0gbW92ZTsNCiAgICByZXR1cm4gaGlzdG9yeVRhYmxlW2Zyb20ucl1bZnJvbS5jXVt0by5yXVt0by5jXSB8fCAwOw0KfTsNCg0KLy8gV29ya2VyIG1lc3NhZ2UgaGFuZGxpbmcNCmlmICh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcpIHsNCiAgICBzZWxmLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKGUpIHsNCiAgICBjb25zdCB7IHR5cGUsIHBheWxvYWQgfSA9IGUuZGF0YTsNCiAgICANCiAgICBzd2l0Y2ggKHR5cGUpIHsgICAgICAgICAgICANCiAgICAgICAgY2FzZSAnU0VBUkNIJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogc2VhcmNoQm9hcmQsIHR1cm46IHNlYXJjaFR1cm4sIGRlcHRoOiBzZWFyY2hEZXB0aCwgcmFuZG9tbmVzczogc2VhcmNoUmFuZG9tbmVzcywgZ2FtZUlkLCBvcGVuaW5nQm9va0VuYWJsZWQ6IHNlYXJjaE9wZW5pbmdCb29rRW5hYmxlZCA9IHRydWUsIHBseTogc2VhcmNoUGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0OiBzZWFyY2hFbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzOiBzZWFyY2hFeGFjdFJvb3RTY29yZXMgPSBmYWxzZSwgZGVmZXJMZWdhbGl0eTogc2VhcmNoRGVmZXJMZWdhbGl0eSwgaW5jcmVtZW50YWxab2JyaXN0OiBzZWFyY2hJbmNyZW1lbnRhbFpvYnJpc3QsIHpvYnJpc3RWZXJpZnk6IHNlYXJjaFpvYnJpc3RWZXJpZnkgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaERlZmVyTGVnYWxpdHkgPT09ICdib29sZWFuJykgew0KICAgICAgICAgICAgICAgIFNFQVJDSF9ERUZFUl9MRUdBTElUWSA9IHNlYXJjaERlZmVyTGVnYWxpdHk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaEluY3JlbWVudGFsWm9icmlzdCA9PT0gJ2Jvb2xlYW4nKSB7DQogICAgICAgICAgICAgICAgU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QgPSBzZWFyY2hJbmNyZW1lbnRhbFpvYnJpc3Q7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBTRUFSQ0hfWk9CUklTVF9WRVJJRlkgPSAhIXNlYXJjaFpvYnJpc3RWZXJpZnk7DQogICAgICAgICAgICAvLyBTZXQgb3BlbmluZyBib29rIGVuYWJsZWQgc3RhdHVzDQogICAgICAgICAgICBvcGVuaW5nQm9vay5zZXRFbmFibGVkKHNlYXJjaE9wZW5pbmdCb29rRW5hYmxlZCk7DQogICAgICAgICAgICAvLyDorrDlvZXmkJzntKLlvIDlp4vml7bpl7QNCiAgICAgICAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgICAgICAgICAgLy8g5omn6KGM5pCc57SiDQogICAgICAgICAgICBjb25zdCBiZXN0U2VhcmNoTW92ZSA9IGdldEJlc3RNb3ZlKHNlYXJjaEJvYXJkLCBzZWFyY2hUdXJuLCBzZWFyY2hEZXB0aCwgc2VhcmNoUmFuZG9tbmVzcywgc2VhcmNoUGx5LCBzZWFyY2hFbmFibGVUaW1lTGltaXQsIHNlYXJjaEV4YWN0Um9vdFNjb3Jlcyk7DQogICAgICAgICAgICAvLyDorrDlvZXmkJzntKLnu5PmnZ/ml7bpl7TlubborqHnrpfmgJ3ogIPml7bpl7QNCiAgICAgICAgICAgIGNvbnN0IGVuZFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKTsNCiAgICAgICAgICAgIGNvbnN0IHRoaW5raW5nVGltZSA9IGVuZFRpbWUgLSBzdGFydFRpbWU7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOajgOafpeaYr+WQpuadpeiHquW8gOWxgOW6kw0KICAgICAgICAgICAgY29uc3QgYm9va01vdmVTZWFyY2ggPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShzZWFyY2hCb2FyZCwgc2VhcmNoUGx5KTsNCiAgICAgICAgICAgIGNvbnN0IGZyb21Cb29rU2VhcmNoID0gISFib29rTW92ZVNlYXJjaCAmJiBKU09OLnN0cmluZ2lmeShib29rTW92ZVNlYXJjaCkgPT09IEpTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5re75Yqg5oCn6IO957uf6K6h5pel5b+XDQogICAgICAgICAgICBsb2dQZXJmU3RhdHMoc2VhcmNoVHVybik7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOa3u+WKoOaAneiAg+aXtumXtOaXpeW/lw0KICAgICAgICAgICAgY29uc29sZS5sb2coYFNlYXJjaCBjb21wbGV0ZWQgaW4gJHtNYXRoLnJvdW5kKHRoaW5raW5nVGltZSl9bXMsIGdhbWVJZD0ke2dhbWVJZH0sIGJlc3RNb3ZlPSR7SlNPTi5zdHJpbmdpZnkoYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmUpfSwgc2Vjb25kQmVzdE1vdmU9JHtKU09OLnN0cmluZ2lmeShiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZSl9LCBmcm9tQm9vaz0ke2Zyb21Cb29rU2VhcmNofWApOw0KICAgICAgICAgICAgLy8g5Y+R6YCB5pCc57Si57uT5p6c5ZKM5oCd6ICD5pe26Ze0DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ1NFQVJDSF9DT01QTEVURScsIA0KICAgICAgICAgICAgICAgIHBheWxvYWQ6IHsgDQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlOiBiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSwgDQogICAgICAgICAgICAgICAgICAgIHNlY29uZEJlc3RNb3ZlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZSwgDQogICAgICAgICAgICAgICAgICAgIGdhbWVJZCwgDQogICAgICAgICAgICAgICAgICAgIGZyb21Cb29rOiBmcm9tQm9va1NlYXJjaCwgDQogICAgICAgICAgICAgICAgICAgIHRoaW5raW5nVGltZTogTWF0aC5yb3VuZCh0aGlua2luZ1RpbWUpLCAvLyDlm5voiI3kupTlhaXliLDmr6vnp5INCiAgICAgICAgICAgICAgICAgICAgbW92ZVNlcXVlbmNlOiBiZXN0U2VhcmNoTW92ZS5tb3ZlU2VxdWVuY2UsDQogICAgICAgICAgICAgICAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kTW92ZVNlcXVlbmNlLA0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNjb3JlOiBiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZVNjb3JlLA0KICAgICAgICAgICAgICAgICAgICBzZWNvbmRCZXN0TW92ZVNjb3JlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZVNjb3JlLA0KICAgICAgICAgICAgICAgICAgICBhbGxNb3Zlc1dpdGhTY29yZXM6IGJlc3RTZWFyY2hNb3ZlLmFsbE1vdmVzV2l0aFNjb3JlcyB8fCBbXSwNCiAgICAgICAgICAgICAgICAgICAgY29tcGxldGVkRGVwdGg6IGJlc3RTZWFyY2hNb3ZlLmNvbXBsZXRlZERlcHRoLA0KICAgICAgICAgICAgICAgICAgICBwZXJmOiBzbmFwc2hvdFBlcmZTdGF0cygpDQogICAgICAgICAgICAgICAgfSANCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnZ2V0VmFsaWRNb3Zlcyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHZtQm9hcmQsIHBvczogdm1Qb3MgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBzeW5jR2VuZXJhbFBvc0NhY2hlKHZtQm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgdmFsaWRNb3ZlcyA9IGdldFZhbGlkTW92ZXModm1Cb2FyZCwgdm1Qb3MpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ3ZhbGlkTW92ZXMnLA0KICAgICAgICAgICAgICAgIG1vdmVzOiB2YWxpZE1vdmVzDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnZ2V0UGllY2VSZWxhdGlvbnMnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBwckJvYXJkLCBwb3M6IHByUG9zIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBwckJvYXJkW3ByUG9zLnJdW3ByUG9zLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDosIPnlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE5qOL5a2Q5L+h5oGv5ZKMYm9hcmRJbmZvDQogICAgICAgICAgICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZShwckJvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRFdmFsdWF0aW9uID0gZXZhbHVhdGVCb2FyZChwckJvYXJkLCBmYWxzZSwgbnVsbCwgMCwgbnVsbCwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlc0luZm8gPSBib2FyZEV2YWx1YXRpb24ucGllY2VzSW5mbzsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5ib2FyZEluZm87DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIGJvYXJkSW5mbyDmoLzlhoXlj6/og73mmK8gcGllY2VzSW5mbyDlvJXnlKjvvIznu5/kuIDmmKDlsITkuLoge3IsY30g5L6bIFVJIOS9v+eUqA0KICAgICAgICAgICAgY29uc3QgcmF3Q29udHJvbGxlcnMgPSBib2FyZEluZm9bcHJQb3Mucl1bcHJQb3MuY10gfHwgW107DQogICAgICAgICAgICBjb25zdCBjb250cm9sbGVycyA9IHJhd0NvbnRyb2xsZXJzLm1hcCgoY3RybCkgPT4gKHsgcjogY3RybC5yLCBjOiBjdHJsLmMgfSkpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBsZXQgcmVsYXRpb25zID0gew0KICAgICAgICAgICAgICAgIHRocmVhdDogW10sIA0KICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeTogW10sIA0KICAgICAgICAgICAgICAgIGd1YXJkOiBbXSwgDQogICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwgDQogICAgICAgICAgICAgICAgY29udHJvbDogW10sDQogICAgICAgICAgICAgICAgY29udHJvbGxlcnMNCiAgICAgICAgICAgIH07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOWmguaenOeCueWHu+eahOaYr+aji+WtkO+8jOi/lOWbnuivpeaji+WtkOeahOWFs+ezu+S/oeaBrw0KICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgY3VycmVudCBwaWVjZSBpbmZvDQogICAgICAgICAgICAgICAgY29uc3QgY3VycmVudFBpZWNlSW5mbyA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gcHJQb3MuciAmJiBwLmMgPT09IHByUG9zLmMpOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGllY2VJbmZvKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgcmVsYXRpb25zDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRocmVhdCA9IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0Lm1hcCh0aHJlYXRQaWVjZSA9PiAoeyByOiB0aHJlYXRQaWVjZS5yLCBjOiB0aHJlYXRQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGhyZWF0ZW5lZEJ5ID0gY3VycmVudFBpZWNlSW5mby50aHJlYXRlbmVkQnkubWFwKHRocmVhdGVuZWRCeVBpZWNlID0+ICh7IHI6IHRocmVhdGVuZWRCeVBpZWNlLnIsIGM6IHRocmVhdGVuZWRCeVBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBndWFyZCA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmQubWFwKGd1YXJkUGllY2UgPT4gKHsgcjogZ3VhcmRQaWVjZS5yLCBjOiBndWFyZFBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBndWFyZGVkQnkgPSBjdXJyZW50UGllY2VJbmZvLmd1YXJkZWRCeS5tYXAoZ3VhcmRlZEJ5UGllY2UgPT4gKHsgcjogZ3VhcmRlZEJ5UGllY2UuciwgYzogZ3VhcmRlZEJ5UGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2wgPSAoY3VycmVudFBpZWNlSW5mby5jb250cm9sIHx8IFtdKS5tYXAoY29udHJvbFBvcyA9PiAoeyByOiBjb250cm9sUG9zLnIsIGM6IGNvbnRyb2xQb3MuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICByZWxhdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQsIA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5LCANCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkLCANCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkZWRCeSwgDQogICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sLA0KICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbGxlcnMNCiAgICAgICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZVJlbGF0aW9ucycsDQogICAgICAgICAgICAgICAgcmVsYXRpb25zOiByZWxhdGlvbnMNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdjaGVja0dhbWVTdGF0ZSc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGNnc0JvYXJkLCB0dXJuOiBjZ3NUdXJuLCByZXF1ZXN0SWQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBnYW1lU3RhdGUgPSBjaGVja0dhbWVTdGF0ZShjZ3NCb2FyZCwgY2dzVHVybik7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAnZ2FtZVN0YXRlJywNCiAgICAgICAgICAgICAgICBzdGF0ZTogZ2FtZVN0YXRlLA0KICAgICAgICAgICAgICAgIHJlcXVlc3RJZA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2V2YWx1YXRlQm9hcmQnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBldmFsQm9hcmQsIHR1cm46IGV2YWxUdXJuLCBpc1JlcGxheSA9IGZhbHNlLCBkZXB0aCA9IDEgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICAvLyDmiZPljbDmjqXmlLbnmoTlj4LmlbANCiAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ2V2YWx1YXRlQm9hcmQgY2FsbGVkIHdpdGg6JywgeyB0dXJuOiBldmFsVHVybiwgaXNSZXBsYXksIGRlcHRoIH0pOw0KICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoZXZhbEJvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgY29uc3QgZGV0YWlsZWRFdmFsID0gZXZhbHVhdGVCb2FyZChldmFsQm9hcmQsIGlzUmVwbGF5LCBldmFsVHVybiwgZGVwdGgsIGV2YWxUdXJuLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2RldGFpbGVkRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZGV0YWlsZWRFdmFsDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQoNCiAgICAgICAgY2FzZSAnZXZhbHVhdGVQaWVjZSc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHBpZWNlRXZhbEJvYXJkLCBwb3M6IHBpZWNlRXZhbFBvcywgdHVybiB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gcGllY2VFdmFsQm9hcmRbcGllY2VFdmFsUG9zLnJdW3BpZWNlRXZhbFBvcy5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFwaWVjZSkgew0KICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogew0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiAwDQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQogICAgICAgICAgICBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDkuLvliqjosIPnlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE6K+E5Lyw5L+h5oGvDQogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5ri45oiP6Zi25q61DQogICAgICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UocGllY2VFdmFsQm9hcmQpOw0KICAgICAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgICAgIGNvbnN0IGJvYXJkRXZhbHVhdGlvbiA9IGV2YWx1YXRlQm9hcmQocGllY2VFdmFsQm9hcmQsIGZhbHNlLCB0dXJuLCAwLCB0dXJuLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIOS7jmV2YWx1YXRlQm9hcmTnmoTov5Tlm57lgLzkuK3mib7liLDlvZPliY3mo4vlrZDnmoTkv6Hmga8NCiAgICAgICAgICAgICAgICBjdXJyZW50UGllY2VJbmZvID0gYm9hcmRFdmFsdWF0aW9uLnBpZWNlc0luZm8uZmluZCgNCiAgICAgICAgICAgICAgICAgICAgcCA9PiBwLnIgPT09IHBpZWNlRXZhbFBvcy5yICYmIHAuYyA9PT0gcGllY2VFdmFsUG9zLmMNCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGllY2VJbmZvKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOW6lOeUqOadg+mHjeW5tui/lOWbnuWNleS4quaji+WtkOeahOivhOS8sOWAvA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBldmFsdWF0aW9uID0gew0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IGN1cnJlbnRQaWVjZUluZm8ubWF0ZXJpYWxWYWx1ZSAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogY3VycmVudFBpZWNlSW5mby5wb3NpdGlvblZhbHVlICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiBjdXJyZW50UGllY2VJbmZvLm1vYmlsaXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiBjdXJyZW50UGllY2VJbmZvLnRocmVhdFZhbHVlICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IGN1cnJlbnRQaWVjZUluZm8uc2FmZXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogY3VycmVudFBpZWNlSW5mby50YWN0aWNWYWx1ZSAqIFZBTFVFX1dFSUdIVFMudGFjdGljDQogICAgICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZXZhbHVhdGlvbg0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDlpoLmnpzku43nhLbmib7kuI3liLDmo4vlrZDkv6Hmga/vvIzov5Tlm57pu5jorqTlgLwNCiAgICAgICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMA0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnaXNDaGVjayc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGNCb2FyZCwgY29sb3I6IGNDb2xvciwgcmVxdWVzdElkIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgc3luY0dlbmVyYWxQb3NDYWNoZShjQm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2soY0JvYXJkLCBjQ29sb3IpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2NoZWNrJywNCiAgICAgICAgICAgICAgICBpc0NoZWNrOiBpbkNoZWNrLA0KICAgICAgICAgICAgICAgIHJlcXVlc3RJZA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2lzVmFsaWRQbGFjZW1lbnQnOiB7DQogICAgICAgICAgICBjb25zdCB7IHR5cGU6IGlwVHlwZSwgY29sb3I6IGlwQ29sb3IsIHIsIGMgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCB2YWxpZFBsYWNlbWVudCA9IGlzVmFsaWRQbGFjZW1lbnQoaXBUeXBlLCBpcENvbG9yLCByLCBjKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICd2YWxpZFBsYWNlbWVudCcsDQogICAgICAgICAgICAgICAgaXNWYWxpZDogdmFsaWRQbGFjZW1lbnQNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcnOiB7DQogICAgICAgICAgICBjb25zdCB7IG1vdmVzLCB3ZWlnaHRzIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgLy8gQWRkIHRoZSBvcGVuaW5nIGxpbmUgdG8gdGhlIG9wZW5pbmcgYm9vaw0KICAgICAgICAgICAgb3BlbmluZ0Jvb2suYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKFttb3Zlc10sIHdlaWdodHMpOw0KICAgICAgICAgICAgLy8gU2VuZCBjb25maXJtYXRpb24NCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnb3BlbmluZ0xpbmVBZGRlZCcsIA0KICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUgDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnbW92ZXNUb05vdGF0aW9uJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5IH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3Qgbm90YXRpb24gPSBvcGVuaW5nQm9vay5tb3Zlc1RvTm90YXRpb24oYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ25vdGF0aW9uJywgDQogICAgICAgICAgICAgICAgbm90YXRpb246IG5vdGF0aW9uIA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ25vdGF0aW9uVG9Nb3Zlcyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgbm90YXRpb246IG5vdGF0aW9uU3RyaW5nLCBpbml0aWFsQm9hcmQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBtb3Zlc0Zyb21Ob3RhdGlvbiA9IG9wZW5pbmdCb29rLm5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvblN0cmluZywgaW5pdGlhbEJvYXJkKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnbW92ZXMnLCANCiAgICAgICAgICAgICAgICBtb3ZlczogbW92ZXNGcm9tTm90YXRpb24gDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnc2V0VmFsdWVXZWlnaHRzJzogew0KICAgICAgICAgICAgVkFMVUVfV0VJR0hUUyA9IHsgLi4uVkFMVUVfV0VJR0hUUywgLi4ucGF5bG9hZCB9Ow0KICAgICAgICAgICAgY29uc29sZS5sb2coJ1VwZGF0ZWQgVkFMVUVfV0VJR0hUUzonLCBWQUxVRV9XRUlHSFRTKTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KICAgIC8vIE92ZXJyaWRlIGNvbnNvbGUubG9nIHRvIHNlbmQgbWVzc2FnZXMgYmFjayB0byBtYWluIHRocmVhZA0KICAgIGNvbnN0IG9yaWdpbmFsQ29uc29sZUxvZyA9IGNvbnNvbGUubG9nOw0KICAgIGNvbnNvbGUubG9nID0gZnVuY3Rpb24oLi4uYXJncykgew0KICAgICAgICAvLyBTZW5kIHRvIG1haW4gdGhyZWFkDQogICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgdHlwZTogJ2xvZycsDQogICAgICAgICAgICBkYXRhOiBhcmdzLmpvaW4oJyAnKQ0KICAgICAgICB9KTsNCiAgICAgICAgDQogICAgICAgIC8vIEFsc28gbG9nIHRvIHdvcmtlciBjb25zb2xlDQogICAgICAgIG9yaWdpbmFsQ29uc29sZUxvZy5hcHBseShjb25zb2xlLCBhcmdzKTsNCiAgICB9Ow0KfQ0KDQovLyDnqbrnnYDliarmnp3vvJrmnInov5vmlLvlrZDlipvml7bmiY3lhYHorrjvvIjpgb/lhY3lsIYv5aOrL+ixoeaui+WxgOmAvOedgOivr+WJqu+8iQ0KY29uc3QgY2FuRG9OdWxsTW92ZSA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKCFwIHx8IHAuY29sb3IgIT09IGNvbG9yKSBjb250aW51ZTsNCiAgICAgICAgICAgIGlmIChwLnR5cGUgPT09ICdjaGFyaW90JyB8fCBwLnR5cGUgPT09ICdob3JzZScgfHwgcC50eXBlID09PSAnY2Fubm9uJyB8fCBwLnR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiBmYWxzZTsNCn07DQoNCi8vIOaQnOe0oueUqCBUVCBrZXnvvJrlop7ph4/mqKHlvI/kuLogbnVtYmVy77yM5pen5qih5byP5Li6IGAke2hhc2h9OiR7c2lkZX1gIOWtl+espuS4sg0KY29uc3QgbWFrZVNlYXJjaFRUS2V5ID0gKGJvYXJkLCBjdXJyZW50UGxheWVyLCBib2FyZEhhc2gpID0+IHsNCiAgICBpZiAoU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QpIHsNCiAgICAgICAgcmV0dXJuIHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChib2FyZEhhc2gsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIH0NCiAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOw0KICAgIHJldHVybiBgJHt6b2JyaXN0SGFzaGVyLmhhc2goYm9hcmQpfToke2N1cnJlbnRQbGF5ZXJ9YDsNCn07DQoNCi8vIOi1sOWtkOWQjueahOWtkOiKgueCueWxgOmdouWTiOW4jO+8iOS7heWinumHj+aooeW8j+acieaEj+S5ie+8m+mhu+WcqCBtYWtlIOWJjeS/neWtmCBtb3ZpbmdQaWVjZe+8iQ0KY29uc3QgY2hpbGRCb2FyZEhhc2ggPSAoYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpID0+IHsNCiAgICBpZiAoIVNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUKSByZXR1cm4gYm9hcmRIYXNoOw0KICAgIHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzKys7DQogICAgcmV0dXJuIHpvYnJpc3RIYXNoZXIudXBkYXRlSGFzaChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7DQp9Ow0KDQpjb25zdCB2ZXJpZnlCb2FyZEhhc2ggPSAoYm9hcmQsIGV4cGVjdGVkSGFzaCkgPT4gew0KICAgIGlmICghU0VBUkNIX1pPQlJJU1RfVkVSSUZZKSByZXR1cm47DQogICAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsNCiAgICBjb25zdCBmdWxsID0gem9icmlzdEhhc2hlci5oYXNoKGJvYXJkKTsNCiAgICBpZiAoZnVsbCAhPT0gZXhwZWN0ZWRIYXNoKSB7DQogICAgICAgIHBlcmZTdGF0cy5oYXNoTWlzbWF0Y2hlcysrOw0KICAgIH0NCn07DQoNCi8vIOaQnOe0oueUqOWHgOWIhu+8muWujOaVtOW9ouWKv+ivhOS8sO+8iOWFs+ezuy/lqIHog4Ev5a6J5YWoL+acuuWKqO+8ie+8jOS7hei3s+i/h+e7iOWxgOedgOazleaemuS4vu+8m+W4piBab2JyaXN0IOe8k+WtmA0KY29uc3Qgc3RhdGljU2VhcmNoRXZhbCA9IChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGJvYXJkSGFzaCA9IDApID0+IHsNCiAgICBsZXQgY2FjaGVLZXk7DQogICAgaWYgKFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUKSB7DQogICAgICAgIGNhY2hlS2V5ID0gem9icmlzdEhhc2hlci5ldmFsQ2FjaGVLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsNCiAgICB9IGVsc2Ugew0KICAgICAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOw0KICAgICAgICBjYWNoZUtleSA9IHpvYnJpc3RIYXNoZXIuZXZhbENhY2hlS2V5KGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSk7DQogICAgfQ0KICAgIGlmIChldmFsQ2FjaGUuaGFzKGNhY2hlS2V5KSkgew0KICAgICAgICByZXR1cm4gZXZhbENhY2hlLmdldChjYWNoZUtleSk7DQogICAgfQ0KICAgIGNvbnN0IGV2YWxSZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGJvYXJkLCBmYWxzZSwgc2VhcmNoSW5pdGlhdG9yLCAwLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgeyBmb3JTZWFyY2hMZWFmOiB0cnVlIH0pOw0KICAgIGNvbnN0IG9wcG9uZW50ID0gc2VhcmNoSW5pdGlhdG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICBjb25zdCBuZXQgPSBldmFsUmVzdWx0W3NlYXJjaEluaXRpYXRvcl0udG90YWwgLSBldmFsUmVzdWx0W29wcG9uZW50XS50b3RhbDsNCiAgICBpZiAoZXZhbENhY2hlLnNpemUgPj0gRVZBTF9DQUNIRV9NQVgpIHsNCiAgICAgICAgLy8g566A5Y2V5reY5rGw5pyA5pep5YaZ5YWl55qE5LiA5om577yM6YG/5YWNIE1hcCDml6DpmZDmtqgNCiAgICAgICAgbGV0IGRyb3AgPSAwOw0KICAgICAgICBmb3IgKGNvbnN0IGsgb2YgZXZhbENhY2hlLmtleXMoKSkgew0KICAgICAgICAgICAgZXZhbENhY2hlLmRlbGV0ZShrKTsNCiAgICAgICAgICAgIGlmICgrK2Ryb3AgPj0gNDA5NikgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQogICAgZXZhbENhY2hlLnNldChjYWNoZUtleSwgbmV0KTsNCiAgICByZXR1cm4gbmV0Ow0KfTsNCg0KLy8g55Sf5oiQ5b2T5YmN5pa55ZCD5a2Q552A77yI5L6b6Z2Z6buY5pCc57Si77yJDQpjb25zdCBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoID0gKGJvYXJkLCBjdXJyZW50UGxheWVyKSA9PiB7DQogICAgY29uc3QgY2FwdHVyZXMgPSBbXTsNCiAgICBjb25zdCBkZWZlciA9IFNFQVJDSF9ERUZFUl9MRUdBTElUWTsNCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcGllY2UgfHwgcGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIGNvbnRpbnVlOw0KICAgICAgICAgICAgY29uc3QgcHNldWRvID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlKTsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCArPSBwc2V1ZG8ubGVuZ3RoOw0KICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IHBzZXVkbyA6IGZpbHRlckxlZ2FsTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSwgcHNldWRvKTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdXNlTW92ZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCB0byA9IHVzZU1vdmVzW2ldOw0KICAgICAgICAgICAgICAgIGlmIChib2FyZFt0by5yXVt0by5jXSkgew0KICAgICAgICAgICAgICAgICAgICBjYXB0dXJlcy5wdXNoKHsgZnJvbTogeyByLCBjIH0sIHRvIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICByZXR1cm4gY2FwdHVyZXM7DQp9Ow0KDQovLyDpnZnpu5jmkJzntKLvvJpzdGFuZC1wYXQg55So5a6M5pW05b2i5Yq/6K+E5Lyw77yb5LuF5a+55ZCD5a2Q5bu25Ly477yIUVPiiaQz77yJDQpjb25zdCBxdWllc2NlbmNlID0gKA0KICAgIGIsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLA0KICAgIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBxc0RlcHRoLCBib2FyZEhhc2ggPSAwDQopID0+IHsNCiAgICBjb25zdCBzdGFuZFBhdCA9IHN0YXRpY1NlYXJjaEV2YWwoYiwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGJvYXJkSGFzaCk7DQoNCiAgICBpZiAocXNEZXB0aCA8PSAwKSB7DQogICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgIH0NCg0KICAgIGlmIChtYXhpbWl6aW5nKSB7DQogICAgICAgIGlmIChzdGFuZFBhdCA+PSBiZXRhKSB7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoc3RhbmRQYXQgPiBhbHBoYSkgew0KICAgICAgICAgICAgYWxwaGEgPSBzdGFuZFBhdDsNCiAgICAgICAgfQ0KICAgIH0gZWxzZSB7DQogICAgICAgIGlmIChzdGFuZFBhdCA8PSBhbHBoYSkgew0KICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgIH0NCiAgICAgICAgaWYgKHN0YW5kUGF0IDwgYmV0YSkgew0KICAgICAgICAgICAgYmV0YSA9IHN0YW5kUGF0Ow0KICAgICAgICB9DQogICAgfQ0KDQogICAgbGV0IGNhcHR1cmVzID0gZ2VuZXJhdGVDYXB0dXJlc0ZvclNlYXJjaChiLCBjdXJyZW50UGxheWVyKTsNCiAgICBpZiAoY2FwdHVyZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgIH0NCg0KICAgIC8vIE1WVi1MVkHvvJrlhYjor5XlkIPlpKflrZANCiAgICBjYXB0dXJlcy5zb3J0KChhLCBiTW92ZSkgPT4gew0KICAgICAgICBjb25zdCBzY29yZUEgPQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW2EudG8ucl1bYS50by5jXSwgZ2FtZVN0YWdlKSAqIDE2IC0NCiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYlthLmZyb20ucl1bYS5mcm9tLmNdLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCBzY29yZUIgPQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW2JNb3ZlLnRvLnJdW2JNb3ZlLnRvLmNdLCBnYW1lU3RhZ2UpICogMTYgLQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW2JNb3ZlLmZyb20ucl1bYk1vdmUuZnJvbS5jXSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgcmV0dXJuIHNjb3JlQiAtIHNjb3JlQTsNCiAgICB9KTsNCg0KICAgIGxldCBiZXN0RXZhbCA9IHN0YW5kUGF0Ow0KICAgIGxldCBiZXN0TW92ZVNlcXVlbmNlID0gW107DQogICAgY29uc3QgZGVmZXIgPSBTRUFSQ0hfREVGRVJfTEVHQUxJVFk7DQoNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNhcHR1cmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBjYXB0dXJlc1tpXTsNCiAgICAgICAgY29uc3QgbW92aW5nUGllY2UgPSBiW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107DQogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZU1vdmUoYiwgbW92ZS5mcm9tLCBtb3ZlLnRvKTsNCiAgICAgICAgaWYgKGRlZmVyICYmIGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllcikpIHsNCiAgICAgICAgICAgIHVubWFrZU1vdmUoYiwgbW92ZS5mcm9tLCBtb3ZlLnRvLCBjYXB0dXJlZCk7DQogICAgICAgICAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCsrOw0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCiAgICAgICAgY29uc3QgbmV4dEhhc2ggPSBjaGlsZEJvYXJkSGFzaChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7DQogICAgICAgIHZlcmlmeUJvYXJkSGFzaChiLCBuZXh0SGFzaCk7DQogICAgICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQrKzsNCiAgICAgICAgY29uc3QgbmV4dFBsYXllciA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBjb25zdCBuZXh0TWF4aW1pemluZyA9IG5leHRQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgY29uc3QgcmVzdWx0ID0gcXVpZXNjZW5jZSgNCiAgICAgICAgICAgIGIsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBxc0RlcHRoIC0gMSwgbmV4dEhhc2gNCiAgICAgICAgKTsNCiAgICAgICAgdW5tYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8sIGNhcHR1cmVkKTsNCg0KICAgICAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlLCAuLi4ocmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGFscGhhKSB7DQogICAgICAgICAgICAgICAgYWxwaGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmUsIC4uLihyZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV07DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmV0YSkgew0KICAgICAgICAgICAgICAgIGJldGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UgfTsNCn07DQoNCi8vIGFscGhhQmV0Ye+8muivhOS8sOWni+e7iOS7jiBzZWFyY2hJbml0aWF0b3Ig6KeS5bqm77ybVFQgKyBraWxsZXIvaGlzdG9yeSArIOepuuedgOWJquaenSArIExNUiArIFFTDQovLyBib2FyZEhhc2jvvJrlop7ph48gWm9icmlzdCDlsYDpnaLlk4jluIzvvIjkuI3lkKvooYzmo4vmlrnvvInvvJvml6fmqKHlvI/kuIvlj6/kvKAgMA0KY29uc3QgYWxwaGFCZXRhID0gKA0KICAgIGIsIGQsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLA0KICAgIHNlYXJjaERlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gY3VycmVudFBsYXllciwgZ2FtZVN0YWdlID0gJ21pZCcsDQogICAgYWxsb3dOdWxsID0gdHJ1ZSwgYm9hcmRIYXNoID0gMA0KKSA9PiB7DQogICAgY29uc3Qgb3JpZ2luYWxBbHBoYSA9IGFscGhhOw0KICAgIGNvbnN0IG9yaWdpbmFsQmV0YSA9IGJldGE7DQoNCiAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMrKzsNCiAgICBpZiAoIXBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKSBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSA9IDA7DQogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0rKzsNCg0KICAgIC8vIOWPtuiKgueCue+8muWujOaVtOW9ouWKv+ivhOS8sCArIOWQg+WtkOmdmem7mOaQnOe0ou+8iFFT4omkM++8iQ0KICAgIGlmIChkID09PSAwKSB7DQogICAgICAgIHJldHVybiBxdWllc2NlbmNlKA0KICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgMywgYm9hcmRIYXNoDQogICAgICAgICk7DQogICAgfQ0KDQogICAgLy8g572u5o2i6KGo5o6i5rWL77yIa2V5IOWQq+ihjOaji+aWue+8jOmBv+WFjeWQjOW9ouS4jeWQjOi1sOaWueWGsueqge+8iQ0KICAgIGNvbnN0IHR0S2V5ID0gbWFrZVNlYXJjaFRUS2V5KGIsIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSGFzaCk7DQogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZSh0dEtleSk7DQogICAgbGV0IHR0TW92ZSA9IG51bGw7DQogICAgaWYgKHR0RW50cnkpIHsNCiAgICAgICAgdHRNb3ZlID0gdHRFbnRyeS5iZXN0TW92ZSB8fCBudWxsOw0KICAgICAgICBpZiAodHRFbnRyeS5kZXB0aCA+PSBkKSB7DQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnZXhhY3QnKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHR0RW50cnkudmFsdWUsDQogICAgICAgICAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogdHRFbnRyeS5tb3ZlU2VxdWVuY2UgfHwgKHR0TW92ZSA/IFt0dE1vdmVdIDogW10pDQogICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICdsb3dlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlID49IGJldGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ3VwcGVyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3Qgc2VhcmNoSW5mbyA9IHByZXBhcmVTZWFyY2hJbmZvKGIsIGN1cnJlbnRQbGF5ZXIsIGdhbWVTdGFnZSwgc2VhcmNoSW5pdGlhdG9yLCBkKTsNCiAgICBjb25zdCBhYlBpZWNlc0luZm8gPSBzZWFyY2hJbmZvLnBpZWNlc0luZm87DQogICAgY29uc3QgYWJCb2FyZEluZm8gPSBzZWFyY2hJbmZvLmJvYXJkSW5mbzsNCiAgICBjb25zdCBjdXJyZW50UGxheWVyQ29sb3IgPSBjdXJyZW50UGxheWVyOw0KICAgIGNvbnN0IGluQ2hlY2sgPSBzZWFyY2hJbmZvLmluQ2hlY2sgfHwNCiAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ3JlZCcgJiYgYWJCb2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fA0KICAgICAgICAgICAgICAgICAgICAoY3VycmVudFBsYXllckNvbG9yID09PSAnYmxhY2snICYmIGFiQm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKTsNCg0KICAgIGNvbnN0IHRlcm1pbmFsU2NvcmUgPSAobWF0ZUluQ2hlY2spID0+IHsNCiAgICAgICAgY29uc3QgaXNJbml0aWF0b3JXaW5uZXIgPSBjdXJyZW50UGxheWVyQ29sb3IgIT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgY29uc3QgYmFzZVNjb3JlID0gaXNJbml0aWF0b3JXaW5uZXIgPyAxMDAwMDAgOiAtMTAwMDAwOw0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgdmFsdWU6IGJhc2VTY29yZSArIChpc0luaXRpYXRvcldpbm5lciA/IGQgOiAoc2VhcmNoRGVwdGggLSBkKSksDQogICAgICAgICAgICBtb3ZlU2VxdWVuY2U6IFtdLA0KICAgICAgICAgICAgdGVybWluYWw6IG1hdGVJbkNoZWNrID8gJ2NoZWNrbWF0ZScgOiAnc3RhbGVtYXRlJw0KICAgICAgICB9Ow0KICAgIH07DQoNCiAgICAvLyDml6DkvKrlkIjms5XnnYDvvJrnm7TmjqXnu4jlsYDvvIjmnoHlsJHop4HvvJvpgJrluLjoh7PlsJHmnInlsIbnmoTotbDliqjvvIkNCiAgICBpZiAoIXNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdCB8fCBzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3QubGVuZ3RoID09PSAwKSB7DQogICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGFiQm9hcmRJbmZvLmdhbWVTdGF0ZTsNCiAgICAgICAgaWYgKGdhbWVTdGF0ZSAmJiAoZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ2NoZWNrbWF0ZScgfHwgZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ3N0YWxlbWF0ZScpKSB7DQogICAgICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGdhbWVTdGF0ZS53aW5uZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgICAgIGNvbnN0IGJhc2VTY29yZSA9IGlzSW5pdGlhdG9yV2lubmVyID8gMTAwMDAwIDogLTEwMDAwMDsNCiAgICAgICAgICAgIGNvbnN0IHN0ZXBzRnJvbVJvb3QgPSBzZWFyY2hEZXB0aCAtIGQ7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogYmFzZVNjb3JlICsgKGlzSW5pdGlhdG9yV2lubmVyID8gZCA6IHN0ZXBzRnJvbVJvb3QpLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIHRlcm1pbmFsU2NvcmUoaW5DaGVjayk7DQogICAgfQ0KDQogICAgLy8g56m6552A5Ymq5p6d77ya5LuFIG1heGltaXppbmfvvJvlrozmlbTor4TkvLDkuIvkv53lrojlkK/nlKgNCiAgICBpZiAoDQogICAgICAgIFNFQVJDSF9FTkFCTEVfTk1QICYmDQogICAgICAgIGFsbG93TnVsbCAmJg0KICAgICAgICBtYXhpbWl6aW5nICYmDQogICAgICAgIGQgPj0gMyAmJg0KICAgICAgICAhaW5DaGVjayAmJg0KICAgICAgICBjYW5Eb051bGxNb3ZlKGIsIGN1cnJlbnRQbGF5ZXJDb2xvcikNCiAgICApIHsNCiAgICAgICAgY29uc3QgbnVsbFIgPSBkID49IDYgPyAzIDogMjsNCiAgICAgICAgY29uc3QgbnVsbERlcHRoID0gZCAtIDEgLSBudWxsUjsNCiAgICAgICAgaWYgKG51bGxEZXB0aCA+PSAwKSB7DQogICAgICAgICAgICBjb25zdCBudWxsUGxheWVyID0gY3VycmVudFBsYXllckNvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgICAgIGNvbnN0IG51bGxNYXhpbWl6aW5nID0gbnVsbFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICAgICAgLy8g56m6552A5LiN5pS55Y+Y5bGA6Z2i5ZOI5biM77yM5LuF6KGM5qOL5pa55Y+Y5YyW77yIVFQga2V5IOWQqyBzaWRl77yJDQogICAgICAgICAgICBjb25zdCBudWxsUmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgICAgIGIsIG51bGxEZXB0aCwgYmV0YSAtIDFlLTYsIGJldGEsIG51bGxNYXhpbWl6aW5nLCBudWxsUGxheWVyLA0KICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgZmFsc2UsIGJvYXJkSGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIGlmIChudWxsUmVzdWx0LnZhbHVlID49IGJldGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogbnVsbFJlc3VsdC52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgbGV0IG1vdmVzID0gc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0Ow0KDQogICAgaWYgKCFwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0pIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSA9IDA7DQogICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdICs9IG1vdmVzLmxlbmd0aDsNCg0KICAgIGNvbnN0IGtpbGxlcnNBdERlcHRoID0gKGtpbGxlck1vdmVzW2RdIHx8IFtudWxsLCBudWxsXSk7DQogICAgbW92ZXMgPSBzb3J0TW92ZXMobW92ZXMsIGIsIGN1cnJlbnRQbGF5ZXJDb2xvciwgYWJQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGFiQm9hcmRJbmZvLCB7DQogICAgICAgIHR0TW92ZSwNCiAgICAgICAga2lsbGVyczoga2lsbGVyc0F0RGVwdGgNCiAgICB9KTsNCg0KICAgIGNvbnN0IHN0b3JlVFQgPSAodmFsdWUsIGJlc3RNb3ZlLCBtb3ZlU2VxdWVuY2UpID0+IHsNCiAgICAgICAgbGV0IGZsYWc7DQogICAgICAgIGlmICh2YWx1ZSA8PSBvcmlnaW5hbEFscGhhKSBmbGFnID0gJ3VwcGVyYm91bmQnOw0KICAgICAgICBlbHNlIGlmICh2YWx1ZSA+PSBvcmlnaW5hbEJldGEpIGZsYWcgPSAnbG93ZXJib3VuZCc7DQogICAgICAgIGVsc2UgZmxhZyA9ICdleGFjdCc7DQogICAgICAgIHRyYW5zcG9zaXRpb25UYWJsZS5zdG9yZSh0dEtleSwgZCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlLCBtb3ZlU2VxdWVuY2UpOw0KICAgIH07DQoNCiAgICBsZXQgYmVzdEV2YWwgPSBtYXhpbWl6aW5nID8gLUluZmluaXR5IDogSW5maW5pdHk7DQogICAgbGV0IGJlc3RNb3ZlID0gbnVsbDsNCiAgICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOw0KICAgIGxldCBsZWdhbE1vdmVzRm91bmQgPSAwOw0KDQogICAgZm9yIChsZXQgbW92ZUluZGV4ID0gMDsgbW92ZUluZGV4IDwgbW92ZXMubGVuZ3RoOyBtb3ZlSW5kZXgrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbbW92ZUluZGV4XTsNCiAgICAgICAgY29uc3QgaXNDYXB0dXJlID0gISFiW21vdmUudG8ucl1bbW92ZS50by5jXTsNCiAgICAgICAgY29uc3QgaXNUVE1vdmUgPSB0dE1vdmUgJiYgaXNTYW1lTW92ZShtb3ZlLCB0dE1vdmUpOw0KICAgICAgICBjb25zdCBpc0tpbGxlciA9DQogICAgICAgICAgICBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNBdERlcHRoWzBdKSB8fA0KICAgICAgICAgICAgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzQXREZXB0aFsxXSk7DQoNCiAgICAgICAgLy8gTE1S77ya6Z2g5ZCO55qE5a6J6Z2Z552A5rOV6ZmN5rexIDHvvIjlrozmlbTor4TkvLDkuIvkv53lrojvvIkNCiAgICAgICAgLy8gbW92ZUluZGV4IOWQq+S8quWQiOazleW6j++8m+mdnuazleedgOi3s+i/h+WQjueVpeWBj+S/neWuiO+8iOWwkemZjea3se+8ie+8jOS4jeW9seWTjeato+ehruaApw0KICAgICAgICBsZXQgcmVkdWN0aW9uID0gMDsNCiAgICAgICAgaWYgKA0KICAgICAgICAgICAgU0VBUkNIX0VOQUJMRV9MTVIgJiYNCiAgICAgICAgICAgIGQgPj0gNCAmJg0KICAgICAgICAgICAgbW92ZUluZGV4ID49IDQgJiYNCiAgICAgICAgICAgICFpbkNoZWNrICYmDQogICAgICAgICAgICAhaXNDYXB0dXJlICYmDQogICAgICAgICAgICAhaXNUVE1vdmUgJiYNCiAgICAgICAgICAgICFpc0tpbGxlcg0KICAgICAgICApIHsNCiAgICAgICAgICAgIHJlZHVjdGlvbiA9IDE7DQogICAgICAgIH0NCg0KICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXTsNCiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8pOw0KICAgICAgICBpZiAoU0VBUkNIX0RFRkVSX0xFR0FMSVRZICYmIGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllckNvbG9yKSkgew0KICAgICAgICAgICAgdW5tYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8sIGNhcHR1cmVkKTsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkKys7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgICAgdmVyaWZ5Qm9hcmRIYXNoKGIsIG5leHRIYXNoKTsNCiAgICAgICAgbGVnYWxNb3Zlc0ZvdW5kKys7DQogICAgICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQrKzsNCg0KICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KDQogICAgICAgIGxldCByZXN1bHQ7DQogICAgICAgIGlmIChyZWR1Y3Rpb24gPiAwKSB7DQogICAgICAgICAgICBjb25zdCByZWR1Y2VkRGVwdGggPSBNYXRoLm1heCgwLCBkIC0gMSAtIHJlZHVjdGlvbik7DQogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgcmVkdWNlZERlcHRoLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIGNvbnN0IG5lZWRSZXNlYXJjaCA9IG1heGltaXppbmcNCiAgICAgICAgICAgICAgICA/IHJlc3VsdC52YWx1ZSA+IGFscGhhDQogICAgICAgICAgICAgICAgOiByZXN1bHQudmFsdWUgPCBiZXRhOw0KICAgICAgICAgICAgaWYgKG5lZWRSZXNlYXJjaCkgew0KICAgICAgICAgICAgICAgIHJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHRydWUsIG5leHRIYXNoDQogICAgICAgICAgICApOw0KICAgICAgICB9DQoNCiAgICAgICAgdW5tYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8sIGNhcHR1cmVkKTsNCg0KICAgICAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOw0KICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgICAgICB9DQogICAgICAgICAgICBhbHBoYSA9IE1hdGgubWF4KGFscGhhLCByZXN1bHQudmFsdWUpOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA8IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOw0KICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgICAgICB9DQogICAgICAgICAgICBiZXRhID0gTWF0aC5taW4oYmV0YSwgcmVzdWx0LnZhbHVlKTsNCiAgICAgICAgfQ0KDQogICAgICAgIGlmIChiZXRhIDw9IGFscGhhKSB7DQogICAgICAgICAgICBpZiAoIXBlcmZTdGF0cy5jdXRvZmZzW2RdKSBwZXJmU3RhdHMuY3V0b2Zmc1tkXSA9IDA7DQogICAgICAgICAgICBwZXJmU3RhdHMuY3V0b2Zmc1tkXSsrOw0KICAgICAgICAgICAgaWYgKCFpc0NhcHR1cmUpIHsNCiAgICAgICAgICAgICAgICBzdG9yZUtpbGxlck1vdmUoZCwgbW92ZSk7DQogICAgICAgICAgICAgICAgYWRkSGlzdG9yeVNjb3JlKG1vdmUsIGQpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDlu7bov5/lkIjms5XmgKfvvJrkvKrlkIjms5XpnZ7nqbrkvYbml6DkuIDlkIjms5Ug4oaSIOWwhuatuy/lm7Dmr5kNCiAgICBpZiAoU0VBUkNIX0RFRkVSX0xFR0FMSVRZICYmIGxlZ2FsTW92ZXNGb3VuZCA9PT0gMCkgew0KICAgICAgICByZXR1cm4gdGVybWluYWxTY29yZShpbkNoZWNrKTsNCiAgICB9DQoNCiAgICBzdG9yZVRUKGJlc3RFdmFsLCBiZXN0TW92ZSwgYmVzdE1vdmVTZXF1ZW5jZSk7DQogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UgfTsNCn07DQoNCi8vIGV4YWN0Um9vdFNjb3JlczogdHJ1ZT1BbmFseXNpcyDlhajmoLnnsr7noa7liIbvvJtmYWxzZT3lr7nlvIjmoIflh4YgUFZT77yIZmFpbC1sb3cg5LiN5Zue5pCc77yJDQpjb25zdCBnZXRCZXN0TW92ZSA9IChib2FyZCwgdHVybiwgZGVwdGggPSA2LCByYW5kb21uZXNzID0gMCwgcGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0ID0gZmFsc2UsIGV4YWN0Um9vdFNjb3JlcyA9IGZhbHNlKSA9PiB7DQogIGNvbnN0IHRpbWVMaW1pdCA9IDUwMDA7DQoNCiAgLy8gRmlyc3QgdHJ5IHRvIGdldCBtb3ZlIGZyb20gb3BlbmluZyBib29rDQogIGNvbnN0IGJvb2tNb3ZlID0gb3BlbmluZ0Jvb2suZ2V0Qm9va01vdmUoYm9hcmQsIHBseSk7DQogIA0KICBpZiAoYm9va01vdmUpIHsNCiAgICAvLyBDaGVjayBpZiBib29rTW92ZSBpcyB2YWxpZCBmb3IgY3VycmVudCBib2FyZA0KICAgIGlmIChib29rTW92ZS5mcm9tICYmIGJvb2tNb3ZlLnRvICYmIA0KICAgICAgICB0eXBlb2YgYm9va01vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICB0eXBlb2YgYm9va01vdmUudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJvb2tNb3ZlLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICANCiAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYm9hcmRbYm9va01vdmUuZnJvbS5yXVtib29rTW92ZS5mcm9tLmNdOw0KICAgICAgDQogICAgICBpZiAobW92aW5nUGllY2UgJiYgbW92aW5nUGllY2UuY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgLy8gVmVyaWZ5IG1vdmUgaXMgdmFsaWQNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCBib29rTW92ZS5mcm9tKTsNCiAgICAgICAgY29uc3QgaXNWYWxpZCA9IHZhbGlkRGVzdGluYXRpb25zLnNvbWUoZGVzdCA9PiBkZXN0LnIgPT09IGJvb2tNb3ZlLnRvLnIgJiYgZGVzdC5jID09PSBib29rTW92ZS50by5jKTsNCiAgICAgICAgDQogICAgICAgIGlmIChpc1ZhbGlkKSB7DQogICAgICAgICAgcmV0dXJuIHsgYmVzdE1vdmU6IGJvb2tNb3ZlLCBzZWNvbmRCZXN0TW92ZTogbnVsbCwgbW92ZVNlcXVlbmNlOiBbXSwgc2Vjb25kTW92ZVNlcXVlbmNlOiBbXSwgYmVzdE1vdmVTY29yZTogMCwgc2Vjb25kQmVzdE1vdmVTY29yZTogMCwgYWxsTW92ZXNXaXRoU2NvcmVzOiBbXSB9Ow0KICAgICAgICB9DQogICAgICB9DQogICAgfQ0KICB9DQoNCiAgLy8g5qC56IqC54K577ya6L+t5Luj5Yqg5rexICsgUFZT77ybVFQva2lsbGVyL2hpc3Rvcnkg6Leo5rex5bqm5L+d55WZ77yI5LuF5byA5bGA5riF56m65LiA5qyh77yJDQogIHJlc2V0UGVyZlN0YXRzKCk7DQogIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7DQogIHRyYW5zcG9zaXRpb25UYWJsZS5yZXNldFN0YXRzKCk7DQogIHRyYW5zcG9zaXRpb25UYWJsZS5jbGVhcigpOw0KICBjbGVhckV2YWxDYWNoZSgpOw0KICBjb25zdCBtYXhEZXB0aCA9IE1hdGgubWF4KDEsIGRlcHRoIHwgMCk7DQogIHJlc2V0U2VhcmNoSGV1cmlzdGljcyhtYXhEZXB0aCk7DQogIHN5bmNHZW5lcmFsUG9zQ2FjaGUoYm9hcmQpOw0KDQogIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKGJvYXJkKTsNCiAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQoNCiAgY29uc3Qgcm9vdEV2YWxSZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGJvYXJkLCBmYWxzZSwgdHVybiwgMCwgdHVybiwgZ2FtZVN0YWdlKTsNCiAgY29uc3Qgcm9vdFBpZWNlc0luZm8gPSByb290RXZhbFJlc3VsdC5waWVjZXNJbmZvOw0KICBjb25zdCByb290Qm9hcmRJbmZvID0gcm9vdEV2YWxSZXN1bHQuYm9hcmRJbmZvOw0KDQogIC8vIOaUtumbhuagueiKgueCuei1sOazle+8iOWPquWBmuS4gOasoe+8ie+8m+acquiiq+WwhuaXtui/h+a7pOmAgeWQgw0KICBsZXQgcm9vdE1vdmVzID0gW107DQogIGNvbnN0IHJvb3RJbkNoZWNrID0gKHR1cm4gPT09ICdyZWQnICYmIHJvb3RCb2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fA0KICAgICAgICAgICAgICAgICAgICAgICh0dXJuID09PSAnYmxhY2snICYmIHJvb3RCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOw0KDQogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHIsIGMgfSk7DQogICAgICAgIHZhbGlkRGVzdGluYXRpb25zLmZvckVhY2godG8gPT4gew0KICAgICAgICAgIGNvbnN0IGlzQWNjZXB0YWJsZSA9IHJvb3RJbkNoZWNrIHx8IGlzUG9zaXRpb25BY2NlcHRhYmxlKGJvYXJkLCB7IHIsIGMgfSwgdG8sIHR1cm4sIHJvb3RCb2FyZEluZm8sIHJvb3RQaWVjZXNJbmZvLCBwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICBpZiAoaXNBY2NlcHRhYmxlKSB7DQogICAgICAgICAgICByb290TW92ZXMucHVzaCh7IGZyb206IHsgciwgYyB9LCB0bywgc2NvcmU6IDAsIG1vdmVTZXF1ZW5jZTogW10gfSk7DQogICAgICAgICAgfQ0KICAgICAgICB9KTsNCiAgICAgIH0NCiAgICB9DQogIH0NCg0KICBpZiAocm9vdE1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgIHJldHVybiB7DQogICAgICBiZXN0TW92ZTogbnVsbCwNCiAgICAgIHNlY29uZEJlc3RNb3ZlOiBudWxsLA0KICAgICAgbW92ZVNlcXVlbmNlOiBbXSwNCiAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogW10sDQogICAgICBiZXN0TW92ZVNjb3JlOiAwLA0KICAgICAgc2Vjb25kQmVzdE1vdmVTY29yZTogMCwNCiAgICAgIGFsbE1vdmVzV2l0aFNjb3JlczogW10NCiAgICB9Ow0KICB9DQoNCiAgY29uc3Qgc29ydFJvb3RNb3Zlc0J5U2NvcmUgPSAobW92ZXMpID0+IHsNCiAgICBtb3Zlcy5zb3J0KChhLCBiKSA9PiB7DQogICAgICBjb25zdCBzY29yZURpZmYgPSBiLnNjb3JlIC0gYS5zY29yZTsNCiAgICAgIGlmIChNYXRoLmFicyhzY29yZURpZmYpIDwgMWUtNikgew0KICAgICAgICBpZiAoYS5zY29yZSA+IDApIHsNCiAgICAgICAgICByZXR1cm4gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYi5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoYS5zY29yZSA8IDApIHsNCiAgICAgICAgICByZXR1cm4gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYS5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gMDsNCiAgICAgIH0NCiAgICAgIHJldHVybiBzY29yZURpZmY7DQogICAgfSk7DQogIH07DQoNCiAgY29uc3QgcHJvbW90ZVJvb3RNb3ZlID0gKG1vdmVzLCBwcmVmZXJyZWQpID0+IHsNCiAgICBpZiAoIXByZWZlcnJlZCkgcmV0dXJuOw0KICAgIGNvbnN0IGlkeCA9IG1vdmVzLmZpbmRJbmRleCgobSkgPT4gaXNTYW1lTW92ZShtLCBwcmVmZXJyZWQpKTsNCiAgICBpZiAoaWR4ID4gMCkgew0KICAgICAgY29uc3QgW2hpdF0gPSBtb3Zlcy5zcGxpY2UoaWR4LCAxKTsNCiAgICAgIG1vdmVzLnVuc2hpZnQoaGl0KTsNCiAgICB9DQogIH07DQoNCiAgY29uc3Qgd29ya0JvYXJkID0gYm9hcmQubWFwKChyb3cpID0+IFsuLi5yb3ddKTsNCiAgY29uc3QgTlVMTF9XSU5ET1dfRVBTID0gMWUtNjsNCiAgY29uc3QgbmV4dFR1cm4gPSB0dXJuID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgLy8g5qC55bGA6Z2i5ZOI5biM5Y+q566X5LiA5qyh77yb5aKe6YeP5qih5byP5pW05qO15pCc57Si5qCR55Sx5q2k5rS+55SfDQogIGNvbnN0IHJvb3RIYXNoID0gem9icmlzdEhhc2hlci5oYXNoKGJvYXJkKTsNCiAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsNCiAgY29uc3Qgcm9vdFRUS2V5ID0gU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QNCiAgICA/IHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChyb290SGFzaCwgdHVybikNCiAgICA6IGAke3Jvb3RIYXNofToke3R1cm59YDsNCg0KICBjb25zb2xlLmxvZygNCiAgICBgU3RhcnRpbmcgaXRlcmF0aXZlIGRlZXBlbmluZyB8IHR1cm46ICR7dHVybn0sIG1heERlcHRoOiAke21heERlcHRofSwgaW5jclpvYnJpc3Q6ICR7U0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1R9LCB0aW1lTGltaXQ6ICR7dGltZUxpbWl0fW1zLCBlbmFibGVUaW1lTGltaXQ6ICR7ZW5hYmxlVGltZUxpbWl0fWANCiAgKTsNCg0KICBsZXQgY29tcGxldGVkRGVwdGggPSAwOw0KDQogIGZvciAobGV0IGN1cnJlbnREZXB0aCA9IDE7IGN1cnJlbnREZXB0aCA8PSBtYXhEZXB0aDsgY3VycmVudERlcHRoKyspIHsNCiAgICBpZiAoZW5hYmxlVGltZUxpbWl0ICYmIGNvbXBsZXRlZERlcHRoID4gMCAmJiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lID4gdGltZUxpbWl0KSB7DQogICAgICBjb25zb2xlLmxvZyhgSUQgc3RvcHBlZCBiZWZvcmUgZGVwdGggJHtjdXJyZW50RGVwdGh9IGR1ZSB0byB0aW1lIGxpbWl0IChsYXN0IGNvbXBsZXRlZD0ke2NvbXBsZXRlZERlcHRofSlgKTsNCiAgICAgIGJyZWFrOw0KICAgIH0NCg0KICAgIC8vIOa1heWxguacgOS9s+edgCArIFRUIOedgOaOkuWIsOacgOWJje+8jOS+m+acrOWxgiBQVlMg56ys5LiA552A5YWo56qX5L2/55SoDQogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZShyb290VFRLZXkpOw0KICAgIGNvbnN0IHR0TW92ZSA9IHR0RW50cnkgJiYgdHRFbnRyeS5iZXN0TW92ZSA/IHR0RW50cnkuYmVzdE1vdmUgOiBudWxsOw0KICAgIGNvbnN0IHByZXZCZXN0ID0gcm9vdE1vdmVzWzBdOw0KICAgIHNvcnRNb3Zlcyhyb290TW92ZXMsIGJvYXJkLCB0dXJuLCByb290UGllY2VzSW5mbywgZ2FtZVN0YWdlLCByb290Qm9hcmRJbmZvLCB7DQogICAgICB0dE1vdmUsDQogICAgICBraWxsZXJzOiBraWxsZXJNb3Zlc1tNYXRoLm1heCgwLCBjdXJyZW50RGVwdGggLSAxKV0gfHwgW251bGwsIG51bGxdDQogICAgfSk7DQogICAgLy8g5LiK5LiA5bGC5pyA5L2z552A5pS+56ys5LiA77yI5pyA5ZCOIHByb21vdGXvvInvvIzkv53or4HmnKzlsYIgUFZTIOmmluedgOWFqOeql+WRveS4reeDrei3r+W+hA0KICAgIHByb21vdGVSb290TW92ZShyb290TW92ZXMsIHR0TW92ZSk7DQogICAgcHJvbW90ZVJvb3RNb3ZlKHJvb3RNb3ZlcywgcHJldkJlc3QpOw0KDQogICAgY29uc3QgdXNlRXhhY3RSb290ID0gZXhhY3RSb290U2NvcmVzICYmIGN1cnJlbnREZXB0aCA9PT0gbWF4RGVwdGg7DQogICAgbGV0IHJvb3RBbHBoYSA9IC1JbmZpbml0eTsNCg0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcm9vdE1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICBjb25zdCBpdGVtID0gcm9vdE1vdmVzW2ldOw0KICAgICAgY29uc3QgbW92aW5nUGllY2UgPSB3b3JrQm9hcmRbaXRlbS5mcm9tLnJdW2l0ZW0uZnJvbS5jXTsNCiAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZU1vdmUod29ya0JvYXJkLCBpdGVtLmZyb20sIGl0ZW0udG8pOw0KICAgICAgY29uc3QgY2hpbGRIYXNoID0gY2hpbGRCb2FyZEhhc2gocm9vdEhhc2gsIGl0ZW0sIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7DQogICAgICB2ZXJpZnlCb2FyZEhhc2god29ya0JvYXJkLCBjaGlsZEhhc2gpOw0KDQogICAgICBsZXQgYWxwaGFCZXRhUmVzdWx0Ow0KICAgICAgbGV0IHNjb3JlSXNFeGFjdCA9IHRydWU7DQogICAgICBpZiAoaSA9PT0gMCB8fCByb290QWxwaGEgPT09IC1JbmZpbml0eSkgew0KICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LA0KICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICApOw0KICAgICAgfSBlbHNlIHsNCiAgICAgICAgY29uc3QgcHJvYmUgPSBhbHBoYUJldGEoDQogICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLA0KICAgICAgICAgIHJvb3RBbHBoYSwgcm9vdEFscGhhICsgTlVMTF9XSU5ET1dfRVBTLA0KICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICApOw0KICAgICAgICBpZiAocHJvYmUudmFsdWUgPiByb290QWxwaGEpIHsNCiAgICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsIHJvb3RBbHBoYSwgSW5maW5pdHksDQogICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCB0cnVlLCBjaGlsZEhhc2gNCiAgICAgICAgICApOw0KICAgICAgICB9IGVsc2UgaWYgKHVzZUV4YWN0Um9vdCkgew0KICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwgLUluZmluaXR5LCBJbmZpbml0eSwNCiAgICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICAgICk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgLy8gZmFpbC1sb3fvvJrmjqLmtYvliIblj6rmmK/kuIrnlYzvvIzkuI3og73lvZPnsr7noa7liIblhpnlhaXvvIjlkKbliJkgSUQg5LiL5bGC5o6S5bqP6KKr5rGh5p+T77yM5piT5Y+N5aSN6LWw54Ku77yJDQogICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gcHJvYmU7DQogICAgICAgICAgc2NvcmVJc0V4YWN0ID0gZmFsc2U7DQogICAgICAgIH0NCiAgICAgIH0NCg0KICAgICAgdW5tYWtlTW92ZSh3b3JrQm9hcmQsIGl0ZW0uZnJvbSwgaXRlbS50bywgY2FwdHVyZWQpOw0KDQogICAgICBpZiAoc2NvcmVJc0V4YWN0KSB7DQogICAgICAgIGl0ZW0uc2NvcmUgPSBhbHBoYUJldGFSZXN1bHQudmFsdWU7DQogICAgICAgIGl0ZW0ubW92ZVNlcXVlbmNlID0gW3sgZnJvbTogaXRlbS5mcm9tLCB0bzogaXRlbS50byB9LCAuLi4oYWxwaGFCZXRhUmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldOw0KICAgICAgICBpZiAoaXRlbS5zY29yZSA+IHJvb3RBbHBoYSkgew0KICAgICAgICAgIHJvb3RBbHBoYSA9IGl0ZW0uc2NvcmU7DQogICAgICAgIH0NCiAgICAgIH0gZWxzZSBpZiAoaXRlbS5zY29yZSA+IHJvb3RBbHBoYSkgew0KICAgICAgICAvLyDkv53nlZnkuIrkuIDlsYLliIbmlbDvvJvoi6Xku43pq5jkuo7lvZPliY0gzrHvvIjlvILluLjvvInvvIznlaXpmY3ku6XlhY3mjKTmjonnnJ/mnIDkvJgNCiAgICAgICAgaXRlbS5zY29yZSA9IHJvb3RBbHBoYSAtIDFlLTM7DQogICAgICB9DQogICAgfQ0KDQogICAgc29ydFJvb3RNb3Zlc0J5U2NvcmUocm9vdE1vdmVzKTsNCiAgICBjb21wbGV0ZWREZXB0aCA9IGN1cnJlbnREZXB0aDsNCg0KICAgIC8vIOaKiuacrOWxguacgOS9s+edgOWGmeWFpSBUVO+8jOS+m+abtOa3seS4gOWxguagueaOkuW6jw0KICAgIHRyYW5zcG9zaXRpb25UYWJsZS5zdG9yZSgNCiAgICAgIHJvb3RUVEtleSwNCiAgICAgIGN1cnJlbnREZXB0aCwNCiAgICAgIHJvb3RNb3Zlc1swXS5zY29yZSwNCiAgICAgICdleGFjdCcsDQogICAgICByb290TW92ZXNbMF0sDQogICAgICByb290TW92ZXNbMF0ubW92ZVNlcXVlbmNlIHx8IFtdDQogICAgKTsNCg0KICAgIGNvbnNvbGUubG9nKA0KICAgICAgYElEIGRlcHRoICR7Y3VycmVudERlcHRofS8ke21heERlcHRofSBkb25lIHwgYmVzdD0ke0pTT04uc3RyaW5naWZ5KHJvb3RNb3Zlc1swXS5mcm9tKX0tPiR7SlNPTi5zdHJpbmdpZnkocm9vdE1vdmVzWzBdLnRvKX0gc2NvcmU9JHtyb290TW92ZXNbMF0uc2NvcmV9IGVsYXBzZWQ9JHtEYXRlLm5vdygpIC0gc3RhcnRUaW1lfW1zYA0KICAgICk7DQogIH0NCg0KICBjb25zdCBiZXN0TW92ZSA9IHJvb3RNb3Zlc1swXSB8fCBudWxsOw0KICBjb25zdCBzZWNvbmRCZXN0TW92ZSA9IHJvb3RNb3Zlcy5sZW5ndGggPiAxID8gcm9vdE1vdmVzWzFdIDogbnVsbDsNCiAgY29uc3QgYmVzdE1vdmVTZXF1ZW5jZSA9IGJlc3RNb3ZlID8gKGJlc3RNb3ZlLm1vdmVTZXF1ZW5jZSB8fCBbXSkgOiBbXTsNCiAgY29uc3Qgc2Vjb25kTW92ZVNlcXVlbmNlID0gc2Vjb25kQmVzdE1vdmUgPyAoc2Vjb25kQmVzdE1vdmUubW92ZVNlcXVlbmNlIHx8IFtdKSA6IFtdOw0KICBjb25zdCBiZXN0TW92ZVNjb3JlID0gYmVzdE1vdmUgPyBiZXN0TW92ZS5zY29yZSA6IDA7DQogIGNvbnN0IHNlY29uZEJlc3RNb3ZlU2NvcmUgPSBzZWNvbmRCZXN0TW92ZSA/IHNlY29uZEJlc3RNb3ZlLnNjb3JlIDogMDsNCg0KICBjb25zdCBhbGxNb3Zlc1dpdGhTY29yZXMgPSByb290TW92ZXMubWFwKChtb3ZlSW5mbykgPT4gKHsNCiAgICBtb3ZlOiB7DQogICAgICBmcm9tOiBtb3ZlSW5mby5mcm9tLA0KICAgICAgdG86IG1vdmVJbmZvLnRvDQogICAgfSwNCiAgICBzY29yZTogbW92ZUluZm8uc2NvcmUsDQogICAgbW92ZVNlcXVlbmNlOiBtb3ZlSW5mby5tb3ZlU2VxdWVuY2UgfHwgW10NCiAgfSkpOw0KDQogIHJldHVybiB7DQogICAgYmVzdE1vdmUsDQogICAgc2Vjb25kQmVzdE1vdmUsDQogICAgbW92ZVNlcXVlbmNlOiBiZXN0TW92ZVNlcXVlbmNlLA0KICAgIHNlY29uZE1vdmVTZXF1ZW5jZSwNCiAgICBiZXN0TW92ZVNjb3JlLA0KICAgIHNlY29uZEJlc3RNb3ZlU2NvcmUsDQogICAgYWxsTW92ZXNXaXRoU2NvcmVzLA0KICAgIGNvbXBsZXRlZERlcHRoDQogIH07DQp9Ow0KDQovLyAtLS0gV09SS0VSIExJU1RFTkVSICjnu5/kuIDmtojmga/lpITnkIYpIC0tLQ0K';
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

            // 调用通用的搜索和执行走法函数，为AI走棋添加3秒延迟，使用Setting面板中的TimeLimit开关设置
            searchAndExecuteMove(board, turn, searchDepth, capturedGameId, config.randomness, moveHistory.length, true, 3000, enableTimeLimit);

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

