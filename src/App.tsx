
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovCgovLyDmo4vnm5jluLjph4/lrprkuYkKY29uc3QgUk9XUyA9IDEwOwpjb25zdCBDT0xTID0gOTsKCi8vIOaji+WtkOexu+Wei+WumuS5iQpjb25zdCBQSUVDRV9UWVBFUyA9IHsKICAgIEdFTkVSQUw6ICdnZW5lcmFsJywKICAgIENIQVJJT1Q6ICdjaGFyaW90JywKICAgIENBTk5PTjogJ2Nhbm5vbicsCiAgICBIT1JTRTogJ2hvcnNlJywKICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLAogICAgQURWSVNPUjogJ2Fkdmlzb3InLAogICAgU09MRElFUjogJ3NvbGRpZXInCn07CgovLyDmnZDmlpnlgLzmnYPph43phY3nva4KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gewogICAgZ2VuZXJhbDogMTAwMDAsICAvLyDlsIYv5biFCiAgICBjaGFyaW90OiA5MDAsICAgICAvLyDovaYKICAgIGNhbm5vbjogewogICAgICAgIGVhcmx5OiA0NTAsICAgIC8vIOW8gOWxgOmYtuautQogICAgICAgIG1pZDogNDAwLCAgICAgIC8vIOS4reWxgOmYtuautQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQogICAgfSwgICAgICAgICAgICAgICAgLy8g54KuCiAgICBob3JzZTogewogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQogICAgICAgIG1pZDogNDUwLCAgICAgIC8vIOS4reWxgOmYtuautQogICAgICAgIGxhdGU6IDQ1MCAgICAgIC8vIOaui+WxgOmYtuautQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsCiAgICBlbGVwaGFudDogMjAwLCAgICAvLyDosaEv55u4CiAgICBhZHZpc29yOiAyMDAsICAgICAvLyDlo6sv5LuVCiAgICBzb2xkaWVyOiB7CiAgICAgICAgZWFybHk6IDEwMCwgICAgLy8g5byA5bGA6Zi25q61CiAgICAgICAgbWlkOiAyMDAsICAgICAgLy8g5Lit5bGA6Zi25q61CiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61CiAgICB9ICAgICAgICAgICAgICAgICAgLy8g5YW1L+WNkgp9OwoKLy8g5qOL5a2Q5Lu35YC85p2D6YeN6YWN572uCmxldCBWQUxVRV9XRUlHSFRTID0gewogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQogICAgLy9wb3NpdGlvbjogMC4yLCAgIC8vIOS9jee9ruWAvOadg+mHjQogICAgLy90aHJlYXQ6IDAuMTUsICAgIC8vIOWogeiDgeWAvOadg+mHjQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQogICAgLy9zYWZldHk6IDAuMSwgICAgIC8vIOWuieWFqOWAvOadg+mHjQogICAgLy9tb2JpbGl0eTogMC4wNSAgIC8vIOacuuWKqOWAvOadg+mHjQoKICAgIG1hdGVyaWFsOiAxLCAgICAvLyDmnZDmlpnlgLzmnYPph40KICAgIHBvc2l0aW9uOiAxLCAgICAvLyDkvY3nva7lgLzmnYPph40KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQogICAgdGFjdGljOiAxLCAgICAgIC8vIOaImOacr+WAvOadg+mHjQogICAgc2FmZXR5OiAxLCAgICAgIC8vIOWuieWFqOWAvOadg+mHjQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQp9OwoKLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XCmNvbnN0IEVWQUxVQVRJT05fUEFSQU1FVEVSUyA9IHsKICAgIC8vIOacuuWKqOWAvOWPguaVsAogICAgbW9iaWxpdHk6IHsKICAgICAgICBiYXNlTW92ZVZhbHVlOiAxLCAgICAgIC8vIOWfuuehgOenu+WKqOS7t+WAvAogICAgfSwKICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQogICAgY2hlY2s6IHsKICAgICAgICBib251czogODAKICAgIH0KfTsKCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rgpjb25zdCBQT1NJVElPTl9UQUJMRVMgPSB7CiAgICAvLyDlhbUv5Y2S5L2N572u6KGoICjnuqLmlrnop4bop5IpCiAgICBzb2xkaWVyOiBbCiAgICAgICAgWzAsIDUsIDEwLCAxNSwgMjAsIDE1LCAxMCwgNSwgMF0sCiAgICAgICAgWzUsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCA1XSwKICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sCiAgICAgICAgWzEwLCAxNSwgMjUsIDMwLCAzMCwgMzAsIDI1LCAxNSwgMTBdLAogICAgICAgIFsxMCwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDEwXSwKICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdCiAgICBdLAogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpCiAgICBjaGFyaW90OiBbCiAgICAgICAgWzUsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDEwLCA1XSwKICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLAogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwKICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLAogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwKICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLAogICAgICAgIFsxMCwgMTAsIDUsIDE1LCAwLCAxNSwgNSwgMTAsIDEwXSwKICAgICAgICBbMCwgMTAsIDUsIDUsIDUsIDUsIDEwLCA1LCAwXQogICAgXSwKICAgIC8vIOmprOS9jee9ruihqCAo57qi5pa56KeG6KeSKQogICAgaG9yc2U6IFsKICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwKICAgICAgICBbMCwgNSwgMjUsIDEwLCAxMCwgMTAsIDI1LCA1LCAwXSwKICAgICAgICBbNSwgNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCA1LCA1XSwKICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sCiAgICAgICAgWzAsIDUsIDE1LCAyMCwgMjAsIDIwLCAxNSwgNSwgMF0sCiAgICAgICAgWzAsIDUsIDI1LCAyMCwgMCwgMjAsIDI1LCA1LCAwXSwKICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwKICAgICAgICBbNSwgMCwgNSwgNSwgMCwgNSwgNSwgMCwgNV0sCiAgICAgICAgWzAsIDAsIDAsIDUsIC0yMCwgNSwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdCiAgICBdLAogICAgLy8g54Ku5L2N572u6KGoICjnuqLmlrnop4bop5IpCiAgICBjYW5ub246IFsKICAgICAgICBbMTAsIDIwLCAxNSwgMTAsIDAsIDEwLCAxNSwgMjAsIDEwXSwKICAgICAgICBbMCwgNSwgNSwgMTAsIDEwLCAxMCwgNSwgNSwgMF0sCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLAogICAgICAgIFs1LCA1LCAxNSwgNSwgMjUsIDUsIDE1LCA1LCA1XSwKICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLAogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwKICAgICAgICBbMTAsIDEwLCAxNSwgMjAsIDMwLCAyMCwgMTUsIDEwLCAxMF0sIAogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0KICAgIF0sCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikKICAgIGVsZXBoYW50OiBbCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0KICAgIF0sCiAgICAvLyDlo6vkvY3nva7ooaggKOe6ouaWueinhuinkikKICAgIGFkdmlzb3I6IFsKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwKICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdLAogICAgICAgIFswLCAwLCAwLCAwLCAxMCwgMCwgMCwgMCwgMF0sCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0KICAgIF0KfTsKCi8vIOiOt+WPluaji+WtkOeahOadkOaWmeWAvApjb25zdCBnZXRNYXRlcmlhbFZhbHVlID0gKHBpZWNlLCBnYW1lU3RhZ2UgPSAnbWlkJykgPT4gewogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOwogICAgCiAgICAvLyDpkojlr7nmnInliIbpmLbmrrXmnZDmlpnlgLznmoTlhbXnp43vvIjlhbXjgIHngq7jgIHpqazvvInosIPmlbTmnZDmlpnlgLwKICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7CiAgICAgICAgdmFsdWUgPSB2YWx1ZVtnYW1lU3RhZ2VdIHx8IHZhbHVlLm1pZDsKICAgIH0KICAgIAogICAgcmV0dXJuIHZhbHVlOwp9OwoKLy8g6I635Y+W5qOL5a2Q55qE5L2N572u5YC8CmNvbnN0IGdldFBvc2l0aW9uVmFsdWUgPSAocGllY2UsIHIsIGMpID0+IHsKICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOwogICAgaWYgKCF0YWJsZSkgcmV0dXJuIDA7CiAgICAKICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqAogICAgY29uc3Qgcm93SWR4ID0gcGllY2UuY29sb3IgPT09ICdyZWQnID8gKDktIHIpIDogcjsKICAgIHJldHVybiB0YWJsZVtyb3dJZHhdW2NdIHx8IDA7Cn07CgovLyDmlLvlh7vkvY3lm77vvJo5MCDmoLznlKggM8OXVWludDMy44CC5pCc57Si5Y+25Y+q6ZyA44CM5piv5ZCm5pWM5o6n44CN77yb54K55qOLL1VJIOS7jeeUqOaOp+WItuiAheWIl+ihqOOAggpjb25zdCBBVFRBQ0tfV09SRFMgPSAzOwpjb25zdCBzY3JhdGNoUmVkQXR0YWNrID0gbmV3IFVpbnQzMkFycmF5KEFUVEFDS19XT1JEUyk7CmNvbnN0IHNjcmF0Y2hCbGFja0F0dGFjayA9IG5ldyBVaW50MzJBcnJheShBVFRBQ0tfV09SRFMpOwovLyB0cnVlPeaQnOe0ouWPtueUqOaUu+WHu+S9jeWbvu+8iOm7mOiupO+8ie+8m2ZhbHNlPeWPtuivhOS8sOS7jeW7uiAxMMOXOSDmjqfliLbogIXooajvvIhBL0LvvIkKbGV0IFNFQVJDSF9MRUFGX0FUVEFDS19CSVRTID0gdHJ1ZTsKCmNvbnN0IGNsZWFyQXR0YWNrQml0cyA9IChiaXRzKSA9PiB7CiAgICBiaXRzWzBdID0gMDsKICAgIGJpdHNbMV0gPSAwOwogICAgYml0c1syXSA9IDA7Cn07Cgpjb25zdCBzZXRBdHRhY2tCaXQgPSAoYml0cywgc3EpID0+IHsKICAgIGJpdHNbc3EgPj4+IDVdIHw9ICgxIDw8IChzcSAmIDMxKSk7Cn07Cgpjb25zdCBoYXNBdHRhY2tCaXQgPSAoYml0cywgc3EpID0+IChiaXRzW3NxID4+PiA1XSAmICgxIDw8IChzcSAmIDMxKSkpICE9PSAwOwoKY29uc3QgbWFrZUVtcHR5Q29udHJvbGxlckdyaWQgPSAoKSA9PgogICAgQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7CgovLyDkuLvor4TkvLDlh73mlbAgLSDor6bnu4bor4TkvLDmo4vnm5jlsYDlir/vvIhVSSAvIOeCueaji+WFs+ezuyAvIOaQnOe0ouWPtiAvIOagueiKgueCue+8iQovLyBvcHRpb25zLmZvclNlYXJjaExlYWY6IOS7hei3s+i/h+e7iOWxgCBnZXRWYWxpZE1vdmVz77yI5peg552A5bey5Zyo54i26IqC54K55aSE55CG77yJ77yb5Y+v55So5pS75Ye75L2N5Zu+5Luj5pu/5o6n5Yi26ICF6KGoCmNvbnN0IGV2YWx1YXRlQm9hcmQgPSAoYm9hcmQsIGlzUmVwbGF5ID0gZmFsc2UsIGN1cnJlbnRQbGF5ZXIgPSBudWxsLCBkZXB0aCA9IDAsIHNlYXJjaEluaXRpYXRvciA9IG51bGwsIGdhbWVTdGFnZSA9ICdtaWQnLCBvcHRpb25zID0gbnVsbCkgPT4gewogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOwogICAgLy8g57uf6K6hCiAgICBpZiAoY3VycmVudFBsYXllcikgewogICAgICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnRbY3VycmVudFBsYXllcl0rKzsKICAgIH0KICAgIGNvbnN0IGZvclNlYXJjaExlYWYgPSAhIShvcHRpb25zICYmIG9wdGlvbnMuZm9yU2VhcmNoTGVhZik7CiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gZm9yU2VhcmNoTGVhZiAmJiBTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUUzsKCiAgICBjb25zdCBvdXRwdXRQaGFzZSA9IGdhbWVTdGFnZTsKCiAgICAvLyDpgY3ljobmo4vnm5jvvJrlj6rmlLbpm4blrZDlipsvUFNU77yb552A5rOVK+WFs+ezu+e7n+S4gOWcqCBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyDkuIDmrKHlh6DkvZXnlJ/miJDvvIjlr7npvZDngq7vvIkKICAgIGxldCBwaWVjZXNJbmZvID0gW107CiAgICBsZXQgcmVkTWF0ZXJpYWwgPSAwLCByZWRQb3NpdGlvbiA9IDA7CiAgICBsZXQgYmxhY2tNYXRlcmlhbCA9IDAsIGJsYWNrUG9zaXRpb24gPSAwOwogICAgCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgewogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOwogICAgICAgICAgICAKICAgICAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7CiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uVmFsdWUgPSBnZXRQb3NpdGlvblZhbHVlKHBpZWNlLCByLCBjKTsKICAgICAgICAgICAgCiAgICAgICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsKICAgICAgICAgICAgICAgIHJlZE1hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7CiAgICAgICAgICAgICAgICByZWRQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgYmxhY2tNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOwogICAgICAgICAgICAgICAgYmxhY2tQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOwogICAgICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgICAgICBwaWVjZXNJbmZvLnB1c2goewogICAgICAgICAgICAgICAgcGllY2UsCiAgICAgICAgICAgICAgICByLAogICAgICAgICAgICAgICAgYywKICAgICAgICAgICAgICAgIG1vdmVzOiBbXSwKICAgICAgICAgICAgICAgIGFsbHlHdWFyZHM6IFtdLAogICAgICAgICAgICAgICAgbWF0ZXJpYWxWYWx1ZSwKICAgICAgICAgICAgICAgIHBvc2l0aW9uVmFsdWUsCiAgICAgICAgICAgICAgICB0aHJlYXRWYWx1ZTogMCwKICAgICAgICAgICAgICAgIHNhZmV0eVZhbHVlOiAwLAogICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDAsCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlOiAwLAogICAgICAgICAgICAgICAgdGhyZWF0OiBbXSwKICAgICAgICAgICAgICAgIHByb3RlY3Q6IFtdCiAgICAgICAgICAgIH0pOwogICAgICAgIH0KICAgIH0KICAgIAogICAgLy8g5pCc57Si5Y+277ya5aSN55So5pS75Ye75L2N5Zu+77yb54K55qOLL1VJ77ya5a6M5pW0IDEww5c5IOaOp+WItuiAheWIl+ihqAogICAgbGV0IGJvYXJkSW5mbzsKICAgIGlmICh1c2VBdHRhY2tCaXRzKSB7CiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOwogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOwogICAgICAgIGJvYXJkSW5mbyA9IHsKICAgICAgICAgICAgdXNlQXR0YWNrQml0czogdHJ1ZSwKICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLAogICAgICAgICAgICBibGFja0F0dGFjazogc2NyYXRjaEJsYWNrQXR0YWNrCiAgICAgICAgfTsKICAgIH0gZWxzZSB7CiAgICAgICAgYm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsKICAgIH0KICAgIGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMoYm9hcmQsIHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGRlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRJbmZvLCBmb3JTZWFyY2hMZWFmKTsKICAgIAogICAgLy8g56ys5LiJ5q2l77ya6K6h566X5oC75YiG77yI5Y+q6K6h566X5Ymp5L2Z5YiG5pWw77yM5Z+656GA5YiG5pWw5bey5Zyo5qOL55uY6YGN5Y6G5pe26K6h566X77yJCiAgICBsZXQgcmVkVGhyZWF0ID0gMCwgcmVkVGFjdGljID0gMCwgcmVkU2FmZXR5ID0gMCwgcmVkTW9iaWxpdHkgPSAwOwogICAgbGV0IGJsYWNrVGhyZWF0ID0gMCwgYmxhY2tUYWN0aWMgPSAwLCBibGFja1NhZmV0eSA9IDAsIGJsYWNrTW9iaWxpdHkgPSAwOwogICAgCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgewogICAgICAgIGNvbnN0IHsgcGllY2UsIHRocmVhdFZhbHVlLCB0YWN0aWNWYWx1ZSwgc2FmZXR5VmFsdWUsIG1vYmlsaXR5VmFsdWUgfSA9IGluZm87CiAgICAgICAgCiAgICAgICAgaWYgKHBpZWNlLmNvbG9yID09PSAncmVkJykgewogICAgICAgICAgICByZWRUaHJlYXQgKz0gdGhyZWF0VmFsdWU7CiAgICAgICAgICAgIHJlZFRhY3RpYyArPSB0YWN0aWNWYWx1ZTsKICAgICAgICAgICAgcmVkU2FmZXR5ICs9IHNhZmV0eVZhbHVlOwogICAgICAgICAgICByZWRNb2JpbGl0eSArPSBtb2JpbGl0eVZhbHVlOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGJsYWNrVGhyZWF0ICs9IHRocmVhdFZhbHVlOwogICAgICAgICAgICBibGFja1RhY3RpYyArPSB0YWN0aWNWYWx1ZTsKICAgICAgICAgICAgYmxhY2tTYWZldHkgKz0gc2FmZXR5VmFsdWU7CiAgICAgICAgICAgIGJsYWNrTW9iaWxpdHkgKz0gbW9iaWxpdHlWYWx1ZTsKICAgICAgICB9CiAgICB9CiAgICAKICAgIC8vIOiuoeeul+WxgOWKv+aAu+WIhgogICAgY29uc3QgcmVkVG90YWwgPSAKICAgICAgICByZWRNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwgKwogICAgICAgIHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArCiAgICAgICAgcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKwogICAgICAgIHJlZFRhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljICsKICAgICAgICByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArCiAgICAgICAgcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5OyAKICAgIAogICAgY29uc3QgYmxhY2tUb3RhbCA9IAogICAgICAgIGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsKICAgICAgICBibGFja1Bvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArCiAgICAgICAgYmxhY2tUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArCiAgICAgICAgYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArCiAgICAgICAgYmxhY2tTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArCiAgICAgICAgYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7CiAgICAKICAgIC8vIOi/lOWbnuivpue7huivhOS8sOe7k+aenAogICAgY29uc3QgX19ldmFsUmVzdWx0ID0gewogICAgICAgIHJlZDogewogICAgICAgICAgICB0b3RhbDogcmVkVG90YWwsCiAgICAgICAgICAgIG1hdGVyaWFsOiByZWRNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsCiAgICAgICAgICAgIHBvc2l0aW9uOiByZWRQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sCiAgICAgICAgICAgIHRocmVhdDogcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQsCiAgICAgICAgICAgIHRhY3RpYzogcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMsCiAgICAgICAgICAgIHNhZmV0eTogcmVkU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHksCiAgICAgICAgICAgIG1vYmlsaXR5OiByZWRNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksCiAgICAgICAgICAgIHBoYXNlOiBvdXRwdXRQaGFzZSwKICAgICAgICAgICAgd2VpZ2h0czogewogICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAuNCwKICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLjIsCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwKICAgICAgICAgICAgICAgIHNhZmV0eTogMC4xLAogICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAuMDUsCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUKICAgICAgICAgICAgfQogICAgICAgIH0sCiAgICAgICAgYmxhY2s6IHsKICAgICAgICAgICAgdG90YWw6IGJsYWNrVG90YWwsCiAgICAgICAgICAgIG1hdGVyaWFsOiBibGFja01hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwKICAgICAgICAgICAgcG9zaXRpb246IGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLAogICAgICAgICAgICB0aHJlYXQ6IGJsYWNrVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQsCiAgICAgICAgICAgIHRhY3RpYzogYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYywKICAgICAgICAgICAgc2FmZXR5OiBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LAogICAgICAgICAgICBtb2JpbGl0eTogYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksCiAgICAgICAgICAgIHBoYXNlOiBvdXRwdXRQaGFzZSwKICAgICAgICAgICAgd2VpZ2h0czogewogICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAuNCwKICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLjIsCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwKICAgICAgICAgICAgICAgIHNhZmV0eTogMC4xLAogICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAuMDUsCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUKICAgICAgICAgICAgfQogICAgICAgIH0sCiAgICAgICAgcGllY2VzSW5mbzogcGllY2VzSW5mbywKICAgICAgICBnYW1lU3RhZ2U6IGdhbWVTdGFnZSwKICAgICAgICBib2FyZEluZm86IGJvYXJkSW5mbwogICAgfTsKICAgIGlmICh0eXBlb2YgcGVyZlN0YXRzICE9PSAndW5kZWZpbmVkJyAmJiBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zICE9IG51bGwpIHsKICAgICAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsKICAgIH0KICAgIHJldHVybiBfX2V2YWxSZXN1bHQ7Cn07CgovLyDlsIYv5biF5L2N572u57yT5a2Y77ya5L6bIHBvc3QtbW92ZSBpc0NoZWNrIC8g6aOe5bCG5b+r6YCf5p+l6K+i77yM55SxIG1ha2UvdW5tYWtlIOe7tOaKpApsZXQgZ2VuZXJhbFBvc0NhY2hlID0geyByZWQ6IG51bGwsIGJsYWNrOiBudWxsIH07CgovLyDlsIbluIXku4XlnKjkuZ3lrqvlhoXvvIzmjInkuZ3lrqvmiavmj4/ljbPlj68KY29uc3QgZmluZEdlbmVyYWxQb3MgPSAoYm9hcmQsIGNvbG9yKSA9PiB7CiAgICBjb25zdCByb3dTdGFydCA9IGNvbG9yID09PSAncmVkJyA/IDAgOiA3OwogICAgY29uc3Qgcm93RW5kID0gY29sb3IgPT09ICdyZWQnID8gMiA6IDk7CiAgICBmb3IgKGxldCByID0gcm93U3RhcnQ7IHIgPD0gcm93RW5kOyByKyspIHsKICAgICAgICBmb3IgKGxldCBjID0gMzsgYyA8PSA1OyBjKyspIHsKICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICBpZiAocCAmJiBwLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBwLmNvbG9yID09PSBjb2xvcikgewogICAgICAgICAgICAgICAgcmV0dXJuIHsgciwgYyB9OwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQogICAgcmV0dXJuIG51bGw7Cn07Cgpjb25zdCBzeW5jR2VuZXJhbFBvc0NhY2hlID0gKGJvYXJkKSA9PiB7CiAgICBnZW5lcmFsUG9zQ2FjaGUucmVkID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsICdyZWQnKTsKICAgIGdlbmVyYWxQb3NDYWNoZS5ibGFjayA9IGZpbmRHZW5lcmFsUG9zKGJvYXJkLCAnYmxhY2snKTsKfTsKCmNvbnN0IGdldEdlbmVyYWxQb3MgPSAoYm9hcmQsIGNvbG9yKSA9PiB7CiAgICBjb25zdCBjYWNoZWQgPSBnZW5lcmFsUG9zQ2FjaGVbY29sb3JdOwogICAgaWYgKGNhY2hlZCkgewogICAgICAgIGNvbnN0IHAgPSBib2FyZFtjYWNoZWQucl0/LltjYWNoZWQuY107CiAgICAgICAgaWYgKHAgJiYgcC50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5jb2xvciA9PT0gY29sb3IpIHsKICAgICAgICAgICAgcmV0dXJuIGNhY2hlZDsKICAgICAgICB9CiAgICB9CiAgICBjb25zdCBwb3MgPSBmaW5kR2VuZXJhbFBvcyhib2FyZCwgY29sb3IpOwogICAgZ2VuZXJhbFBvc0NhY2hlW2NvbG9yXSA9IHBvczsKICAgIHJldHVybiBwb3M7Cn07CgovLyDmkJzntKLnlKjljp/lnLDotbDlrZAgLyDmgaLlpI3vvIjpgb/lhY3mr4/mrKHpgJLlvZIgYm9hcmQubWFw77yJ77yb5ZCM5q2l57u05oqk5bCG5L2N57yT5a2YCmNvbnN0IG1ha2VNb3ZlID0gKGJvYXJkLCBmcm9tLCB0bykgPT4gewogICAgY29uc3QgcGllY2UgPSBib2FyZFtmcm9tLnJdW2Zyb20uY107CiAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW3RvLnJdW3RvLmNdOwogICAgYm9hcmRbdG8ucl1bdG8uY10gPSBwaWVjZTsKICAgIGJvYXJkW2Zyb20ucl1bZnJvbS5jXSA9IG51bGw7CiAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogdG8uciwgYzogdG8uYyB9OwogICAgfQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgewogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSBudWxsOwogICAgfQogICAgcmV0dXJuIGNhcHR1cmVkOwp9OwoKY29uc3QgdW5tYWtlTW92ZSA9IChib2FyZCwgZnJvbSwgdG8sIGNhcHR1cmVkKSA9PiB7CiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOwogICAgYm9hcmRbZnJvbS5yXVtmcm9tLmNdID0gcGllY2U7CiAgICBib2FyZFt0by5yXVt0by5jXSA9IGNhcHR1cmVkOwogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgewogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtwaWVjZS5jb2xvcl0gPSB7IHI6IGZyb20uciwgYzogZnJvbS5jIH07CiAgICB9CiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IHsgcjogdG8uciwgYzogdG8uYyB9OwogICAgfQp9OwoKLy8g6LWw5a2Q5ZCO5piv5ZCm5L2/5bex5pa55bCG5LiN5a6J5YWo77yI6aOe5bCG5oiW6KKr5bCG77yJ44CC6LCD55So5YmN6aG75beyIG1ha2VNb3Zl44CCCmNvbnN0IGxlYXZlc093bktpbmdVbnNhZmUgPSAoYm9hcmQsIGNvbG9yKSA9PiB7CiAgICBwZXJmU3RhdHMubGVnYWxpdHlDaGVja3MrKzsKICAgIHJldHVybiBpc0ZseWluZ0dlbmVyYWwoYm9hcmQpIHx8IGlzQ2hlY2tSYXcoYm9hcmQsIGNvbG9yKTsKfTsKCi8vIOS7juS8quWQiOazleedgOazleS4rei/h+a7pOWHuuS4jemAgeWwhi/kuI3po57lsIbnmoTlkIjms5XnnYDms5XvvIhVSS/moLnoioLngrkv5byA5bGA5bqT5qCh6aqM77yJCi8vIOaQnOe0oueDrei3r+W+hOS9v+eUqOW7tui/n+WQiOazleaAp++8iOivlei1sOaXtuajgOa1i++8ie+8jOmBv+WFjeWvueWJquaeneacquinpuWPiueahOedgOazleWBmuWFqOmHj+i/h+a7pApjb25zdCBmaWx0ZXJMZWdhbE1vdmVzID0gKGJvYXJkLCBmcm9tLCBwaWVjZSwgcHNldWRvTW92ZXMpID0+IHsKICAgIGNvbnN0IHZhbGlkTW92ZXMgPSBbXTsKICAgIGZvciAoY29uc3QgdG8gb2YgcHNldWRvTW92ZXMpIHsKICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VNb3ZlKGJvYXJkLCBmcm9tLCB0byk7CiAgICAgICAgY29uc3QgaWxsZWdhbCA9IGxlYXZlc093bktpbmdVbnNhZmUoYm9hcmQsIHBpZWNlLmNvbG9yKTsKICAgICAgICB1bm1ha2VNb3ZlKGJvYXJkLCBmcm9tLCB0bywgY2FwdHVyZWQpOwogICAgICAgIGlmICghaWxsZWdhbCkgdmFsaWRNb3Zlcy5wdXNoKHRvKTsKICAgIH0KICAgIHJldHVybiB2YWxpZE1vdmVzOwp9OwoKLy8g5pCc57Si55So552A5rOV5YeG5aSH77yI6L276YeP77yJ77ya5LiN5bu65YWz57O75Zu+L+WogeiDgS/mnLrliqjmgKcKLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPXRydWXvvJrlj6rnlJ/miJDkvKrlkIjms5XvvIzlkIjms5XmgKflnKjor5XotbDml7bmo4DmtYsKLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPWZhbHNl77ya6aKE6L+H5ruk5ZCI5rOV552A77yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQovLyDngrnmo4vlhbPns7vku43otbDlrozmlbQgZXZhbHVhdGVCb2FyZO+8jOS4jeWPl+W9seWTjQpjb25zdCBwcmVwYXJlU2VhcmNoSW5mbyA9IChib2FyZCwgY3VycmVudFBsYXllciwgZ2FtZVN0YWdlLCBzZWFyY2hJbml0aWF0b3IgPSBudWxsLCBkZXB0aCA9IDApID0+IHsKICAgIGNvbnN0IF9fdDAgPSBwZXJmb3JtYW5jZS5ub3coKTsKICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50W2N1cnJlbnRQbGF5ZXJdKys7CgogICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2tSYXcoYm9hcmQsIGN1cnJlbnRQbGF5ZXIpOwogICAgY29uc3QgcGllY2VzSW5mbyA9IFtdOwogICAgY29uc3QgbGVnYWxNb3ZlTGlzdCA9IFtdOwogICAgY29uc3QgZGVmZXIgPSBTRUFSQ0hfREVGRVJfTEVHQUxJVFk7CgogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsKICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICBpZiAoIXBpZWNlIHx8IHBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSBjb250aW51ZTsKCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlKTsKICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IG1vdmVzIDogZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlLCBtb3Zlcyk7CiAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7CiAgICAgICAgICAgICAgICBwaWVjZSwKICAgICAgICAgICAgICAgIHIsCiAgICAgICAgICAgICAgICBjLAogICAgICAgICAgICAgICAgbW92ZXMsCiAgICAgICAgICAgICAgICBsZWdhbE1vdmVzOiB1c2VNb3ZlcwogICAgICAgICAgICB9KTsKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB1c2VNb3Zlcy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tpXTsKICAgICAgICAgICAgICAgIGxlZ2FsTW92ZUxpc3QucHVzaCh7IGZyb206IHsgciwgYyB9LCB0bywgc2NvcmU6IDAgfSk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IG1vdmVzLmxlbmd0aDsKICAgICAgICB9CiAgICB9CgogICAgLy8g6L276YePIGJvYXJkSW5mb++8muS7heiiq+Wwhuagh+W/lwogICAgY29uc3QgYm9hcmRJbmZvID0gewogICAgICAgIHJlZElzSW5DaGVjazogY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyBpbkNoZWNrIDogZmFsc2UsCiAgICAgICAgYmxhY2tJc0luQ2hlY2s6IGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgPyBpbkNoZWNrIDogZmFsc2UsCiAgICAgICAgZ2FtZVN0YXRlOiBudWxsCiAgICB9OwoKICAgIGlmIChsZWdhbE1vdmVMaXN0Lmxlbmd0aCA9PT0gMCkgewogICAgICAgIGNvbnN0IG9wcG9uZW50ID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7CiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IGluQ2hlY2sKICAgICAgICAgICAgPyB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfQogICAgICAgICAgICA6IHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9OwogICAgfSBlbHNlIHsKICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdwbGF5aW5nJyB9OwogICAgfQoKICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsKICAgIHJldHVybiB7IHBpZWNlc0luZm8sIGJvYXJkSW5mbywgbGVnYWxNb3ZlTGlzdCwgaW5DaGVjaywgZGVmZXJyZWRMZWdhbGl0eTogZGVmZXIgfTsKfTsKCi8vIOiuoeeul+ihjeeUn+WAvO+8muWogeiDgeWAvOOAgeWuieWFqOWAvOOAgeaImOacr+WAvOOAgeacuuWKqOWAvApjb25zdCBjYWxjdWxhdGVEZXJpdmVkVmFsdWVzID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyID0gbnVsbCwgZGVwdGggPSAwLCBzZWFyY2hJbml0aWF0b3IgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJywgYm9hcmRJbmZvID0gbnVsbCwgZm9yU2VhcmNoTGVhZiA9IGZhbHNlKSA9PiB7CiAgICAvLyDph43nva7miYDmnInooY3nlJ/lgLzvvIzpmaTkuobmnLrliqjlgLzvvIjlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpfvvIkKICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7CiAgICAgICAgaW5mby50aHJlYXRWYWx1ZSA9IDA7CiAgICAgICAgaW5mby5zYWZldHlWYWx1ZSA9IDA7CiAgICAgICAgaW5mby50YWN0aWNWYWx1ZSA9IDA7CiAgICAgICAgLy8g5L+d55WZ5py65Yqo5YC877yM5Zug5Li65bey5Zyo5pS26ZuG5qOL5a2Q5L+h5oGv5pe26K6h566XCiAgICB9CiAgICAKICAgIC8vIDEuIOiuoeeul+aji+WtkOWFs+ezu++8iOWogeiDgeiAheOAgeiiq+WogeiDgeiAheOAgeS/neaKpOiAheOAgeiiq+S/neaKpOiAhe+8iQogICAgaWYgKCFib2FyZEluZm8pIHsKICAgICAgICBib2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsKICAgIH0KICAgIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zKGJvYXJkLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pOwogICAgCiAgICAvLyAyLiDorqHnrpflqIHog4HlgLzvvIjmjInooqvlqIHog4HlrZDogZrlkIjvvIxTRUUg5q+P55uu5qCH5LiA5qyh77yJCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMocGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvKTsKICAgIAogICAgLy8gMy4g6K6h566X5a6J5YWo5YC8CiAgICBjYWxjdWxhdGVTYWZldHlWYWx1ZXMocGllY2VzSW5mbywgYm9hcmRJbmZvKTsKICAgIAogICAgLy8gNC4g6K6h566X5ri45oiP54q25oCB5bm25L+d5a2Y5YiwYm9hcmRJbmZvCiAgICAvLyDmkJzntKLlj7boioLngrnot7Pov4fvvJrml6DnnYAv5bCG5q275bey5Zyo54i26IqC54K55aSE55CG77yM5q2k5aSE5Y+q6ZyA6Z2Z5oCB5YiGCiAgICBpZiAoY3VycmVudFBsYXllciAmJiAhZm9yU2VhcmNoTGVhZikgewogICAgICAgIC8vIOajgOafpeW9k+WJjeeOqeWutuaYr+WQpuacieWQiOazlei1sOazlQogICAgICAgIGxldCBoYXNNb3ZlcyA9IGZhbHNlOwogICAgICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7CiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7CiAgICAgICAgICAgICAgICAvLyDojrflj5blvZPliY3mo4vlrZDnmoTmnInmlYjotbDms5UKICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0VmFsaWRNb3Zlcyhib2FyZCwgeyByOiBpbmZvLnIsIGM6IGluZm8uYyB9KTsKICAgICAgICAgICAgICAgIGlmIChtb3Zlcy5sZW5ndGggPiAwKSB7CiAgICAgICAgICAgICAgICAgICAgaGFzTW92ZXMgPSB0cnVlOwogICAgICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIAogICAgICAgIC8vIOWIpOaWrea4uOaIj+eKtuaAgQogICAgICAgIGxldCBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ3BsYXlpbmcnIH07CiAgICAgICAgaWYgKCFoYXNNb3ZlcykgewogICAgICAgICAgICAvLyDmsqHmnInlkIjms5XotbDms5XvvIzmo4Dmn6XmmK/lkKbooqvlsIblhpsKICAgICAgICAgICAgY29uc3QgaW5DaGVjayA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZElzSW5DaGVjayA6IGJvYXJkSW5mby5ibGFja0lzSW5DaGVjazsKICAgICAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgICAgICAgICAgCiAgICAgICAgICAgIGlmIChpbkNoZWNrKSB7CiAgICAgICAgICAgICAgICBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9OwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIAogICAgICAgIC8vIOS/neWtmOa4uOaIj+eKtuaAgeWIsGJvYXJkSW5mbwogICAgICAgIGJvYXJkSW5mby5nYW1lU3RhdGUgPSBnYW1lU3RhdGU7CiAgICB9Cn07CgovLyDmo4vlrZDlh6DkvZXmlrnlkJHooajvvIjpooTorqHnrpfohb8v55y85YGP56e777yM54Ot6Lev5b6E6YG/5YWNIE1hdGguc2lnbiAvIGRyLzLvvIkKY29uc3QgT1JUSF9ESVJTID0gWwogICAgWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF0KXTsKY29uc3QgRElBR19ESVJTID0gWwogICAgWzEsIDFdLCBbMSwgLTFdLCBbLTEsIDFdLCBbLTEsIC0xXQpdOwpjb25zdCBFTEVQSEFOVF9ESVJTID0gWwogICAgeyBkcjogMiwgZGM6IDIsIGV5ZURyOiAxLCBleWVEYzogMSB9LAogICAgeyBkcjogMiwgZGM6IC0yLCBleWVEcjogMSwgZXllRGM6IC0xIH0sCiAgICB7IGRyOiAtMiwgZGM6IDIsIGV5ZURyOiAtMSwgZXllRGM6IDEgfSwKICAgIHsgZHI6IC0yLCBkYzogLTIsIGV5ZURyOiAtMSwgZXllRGM6IC0xIH0KXTsKY29uc3QgSE9SU0VfRElSUyA9IFsKICAgIHsgZHI6IDIsIGRjOiAxLCBsZWdEcjogMSwgbGVnRGM6IDAgfSwKICAgIHsgZHI6IDIsIGRjOiAtMSwgbGVnRHI6IDEsIGxlZ0RjOiAwIH0sCiAgICB7IGRyOiAtMiwgZGM6IDEsIGxlZ0RyOiAtMSwgbGVnRGM6IDAgfSwKICAgIHsgZHI6IC0yLCBkYzogLTEsIGxlZ0RyOiAtMSwgbGVnRGM6IDAgfSwKICAgIHsgZHI6IDEsIGRjOiAyLCBsZWdEcjogMCwgbGVnRGM6IDEgfSwKICAgIHsgZHI6IDEsIGRjOiAtMiwgbGVnRHI6IDAsIGxlZ0RjOiAtMSB9LAogICAgeyBkcjogLTEsIGRjOiAyLCBsZWdEcjogMCwgbGVnRGM6IDEgfSwKICAgIHsgZHI6IC0xLCBkYzogLTIsIGxlZ0RyOiAwLCBsZWdEYzogLTEgfQpdOwoKLy8g6Z2e54Ku77ya5LiA5qyh5Yeg5L2V5omr5o+P5ZCM5pe25aGr5YWFIG1vdmVzICsgY29udHJvbCAvIHRocmVhdCAvIGd1YXJkIC8gbW9iaWxpdHnvvIjlr7npvZAgZmlsbENhbm5vblJlbGF0aW9uc++8iQovLyDor63kuYnkuI4gZ2V0UGllY2VNb3ZlcyArIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zIOaXp+aLhuWIhui3r+W+hOS4gOiHtO+8m2dldFBpZWNlTW92ZXMg5LuN5L6b552A5rOV55Sf5oiQ5L2/55SoCmNvbnN0IGZpbGxOb25DYW5ub25SZWxhdGlvbnMgPSAoYm9hcmQsIGluZm8sIHBvc0J5S2V5KSA9PiB7CiAgICBjb25zdCBwaWVjZSA9IGluZm8ucGllY2U7CiAgICBjb25zdCB7IHIsIGMgfSA9IGluZm87CiAgICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsKICAgIGNvbnN0IHsgYmFzZU1vdmVWYWx1ZSB9ID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5OwogICAgaW5mby5tb3ZlcyA9IFtdOwogICAgaW5mby5jb250cm9sID0gW107CiAgICBpbmZvLmFsbHlHdWFyZHMgPSBbXTsKICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsKCiAgICBjb25zdCBsaW5rVGhyZWF0ID0gKHRyLCB0YykgPT4gewogICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwb3NCeUtleS5nZXQodHIgKiA5ICsgdGMpOwogICAgICAgIGlmICh0YXJnZXRJbmZvKSB7CiAgICAgICAgICAgIGluZm8udGhyZWF0LnB1c2godGFyZ2V0SW5mbyk7CiAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7CiAgICAgICAgfQogICAgfTsKCiAgICBjb25zdCBsaW5rR3VhcmQgPSAodHIsIHRjKSA9PiB7CiAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBvc0J5S2V5LmdldCh0ciAqIDkgKyB0Yyk7CiAgICAgICAgaWYgKHRhcmdldEluZm8gJiYgdGFyZ2V0SW5mbyAhPT0gaW5mbykgewogICAgICAgICAgICBpbmZvLmd1YXJkLnB1c2godGFyZ2V0SW5mbyk7CiAgICAgICAgICAgIHRhcmdldEluZm8uZ3VhcmRlZEJ5LnB1c2goaW5mbyk7CiAgICAgICAgICAgIGluZm8uYWxseUd1YXJkcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOwogICAgICAgIH0KICAgIH07CgogICAgY29uc3QgYWRkU3F1YXJlID0gKHRyLCB0YykgPT4gewogICAgICAgIGlmICghaXNWYWxpZFBvcyh0ciwgdGMpKSByZXR1cm47CiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbdHJdW3RjXTsKICAgICAgICBpZiAoIXRhcmdldCkgewogICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7CiAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOwogICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7CiAgICAgICAgfSBlbHNlIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlLmNvbG9yKSB7CiAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsKICAgICAgICAgICAgbGlua1RocmVhdCh0ciwgdGMpOwogICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgewogICAgICAgICAgICBsaW5rR3VhcmQodHIsIHRjKTsKICAgICAgICB9CiAgICB9OwoKICAgIHN3aXRjaCAocGllY2UudHlwZSkgewogICAgICAgIGNhc2UgJ2dlbmVyYWwnOgogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOwogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOwogICAgICAgICAgICAgICAgaWYgKG5jID49IDMgJiYgbmMgPD0gNSkgewogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA+PSAwICYmIG5yIDw9IDIpIGFkZFNxdWFyZShuciwgbmMpOwogICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA3ICYmIG5yIDw9IDkpIGFkZFNxdWFyZShuciwgbmMpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIGNhc2UgJ2Fkdmlzb3InOgogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IERJQUdfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgZHIgPSBESUFHX0RJUlNbaV1bMF0sIGRjID0gRElBR19ESVJTW2ldWzFdOwogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOwogICAgICAgICAgICAgICAgaWYgKG5jID49IDMgJiYgbmMgPD0gNSkgewogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA+PSAwICYmIG5yIDw9IDIpIGFkZFNxdWFyZShuciwgbmMpOwogICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA3ICYmIG5yIDw9IDkpIGFkZFNxdWFyZShuciwgbmMpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIGNhc2UgJ2VsZXBoYW50JzoKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBFTEVQSEFOVF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBkID0gRUxFUEhBTlRfRElSU1tpXTsKICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIGQuZHIsIG5jID0gYyArIGQuZGM7CiAgICAgICAgICAgICAgICBjb25zdCBleWVSID0gciArIGQuZXllRHIsIGV5ZUMgPSBjICsgZC5leWVEYzsKICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYgYm9hcmRbZXllUl1bZXllQ10gPT09IG51bGwpIHsKICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPD0gNCkgYWRkU3F1YXJlKG5yLCBuYyk7CiAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDUpIGFkZFNxdWFyZShuciwgbmMpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIGNhc2UgJ2hvcnNlJzoKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBIT1JTRV9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBkID0gSE9SU0VfRElSU1tpXTsKICAgICAgICAgICAgICAgIGNvbnN0IGxlZ1IgPSByICsgZC5sZWdEciwgbGVnQyA9IGMgKyBkLmxlZ0RjOwogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobGVnUiwgbGVnQykgJiYgYm9hcmRbbGVnUl1bbGVnQ10gPT09IG51bGwpIHsKICAgICAgICAgICAgICAgICAgICBhZGRTcXVhcmUociArIGQuZHIsIGMgKyBkLmRjKTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICBicmVhazsKICAgICAgICBjYXNlICdjaGFyaW90JzoKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsKICAgICAgICAgICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7CiAgICAgICAgICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbbnJdW25jXTsKICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0ID09PSBudWxsKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5jb250cm9sLnB1c2goeyByOiBuciwgYzogbmMgfSk7CiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsKICAgICAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0LmNvbG9yICE9PSBwaWVjZS5jb2xvcikgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgbGlua1RocmVhdChuciwgbmMpOwogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxpbmtHdWFyZChuciwgbmMpOwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICBuciArPSBkcjsKICAgICAgICAgICAgICAgICAgICBuYyArPSBkYzsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICBicmVhazsKICAgICAgICBjYXNlICdzb2xkaWVyJzogewogICAgICAgICAgICBjb25zdCBmb3J3YXJkID0gaXNSZWQgPyAxIDogLTE7CiAgICAgICAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGlzUmVkID8gciA+PSA1IDogciA8PSA0OwogICAgICAgICAgICBhZGRTcXVhcmUociArIGZvcndhcmQsIGMpOwogICAgICAgICAgICBpZiAoY3Jvc3NlZFJpdmVyKSB7CiAgICAgICAgICAgICAgICBhZGRTcXVhcmUociwgYyAtIDEpOwogICAgICAgICAgICAgICAgYWRkU3F1YXJlKHIsIGMgKyAxKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgZGVmYXVsdDoKICAgICAgICAgICAgYnJlYWs7CiAgICB9CiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOwp9OwoKLy8g54Ku77ya5LiA5qyh5Zub5ZCR5bCE57q/5ZCM5pe25aGr5YWFIG1vdmVzICsgdGhyZWF0IC8gZ3VhcmQgLyBjb250cm9s77yI6YG/5YWNIGdldFBpZWNlTW92ZXMg5YaN5omr5LiA6YGN77yJCmNvbnN0IGZpbGxDYW5ub25SZWxhdGlvbnMgPSAoYm9hcmQsIGluZm8sIHBvc0J5S2V5KSA9PiB7CiAgICBjb25zdCBwaWVjZSA9IGluZm8ucGllY2U7CiAgICBjb25zdCB7IHIsIGMgfSA9IGluZm87CiAgICBjb25zdCB7IGJhc2VNb3ZlVmFsdWUgfSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eTsKICAgIGluZm8ubW92ZXMgPSBbXTsKICAgIGluZm8uY29udHJvbCA9IFtdOwogICAgbGV0IG1vYmlsaXR5VmFsdWUgPSAwOwoKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOwogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7CiAgICAgICAgbGV0IHNjcmVlbkZvdW5kQ291bnQgPSAwOwogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYgc2NyZWVuRm91bmRDb3VudCA8IDIpIHsKICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107CiAgICAgICAgICAgIGlmIChwICE9PSBudWxsKSB7CiAgICAgICAgICAgICAgICBzY3JlZW5Gb3VuZENvdW50Kys7CiAgICAgICAgICAgICAgICBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMikgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwb3NCeUtleS5nZXQobnIgKiA5ICsgbmMpOwogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRJbmZvICYmIHRhcmdldEluZm8gIT09IGluZm8pIHsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHAuY29sb3IgIT09IHBpZWNlLmNvbG9yKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLnRocmVhdC5wdXNoKHRhcmdldEluZm8pOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby50aHJlYXRlbmVkQnkucHVzaChpbmZvKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwLnR5cGUgIT09ICdnZW5lcmFsJykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5ndWFyZC5wdXNoKHRhcmdldEluZm8pOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocC5jb2xvciAhPT0gcGllY2UuY29sb3IpIHsKICAgICAgICAgICAgICAgICAgICAgICAgLy8g55uu5qCH5LiN5ZyoIHBpZWNlc0luZm8g5pe25LuN5L+d55WZ5Y+v6LWw5qC8CiAgICAgICAgICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMCkgewogICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOwogICAgICAgICAgICB9IGVsc2UgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDEpIHsKICAgICAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICB9CiAgICAgICAgICAgIG5yICs9IGRyOwogICAgICAgICAgICBuYyArPSBkYzsKICAgICAgICB9CiAgICB9CiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOwp9OwoKLy8g6K6h566X5qOL5a2Q5YWz57O777yI5aiB6IOB6ICF44CB6KKr5aiB6IOB6ICF44CB5L+d5oqk6ICF44CB6KKr5L+d5oqk6ICF77yJCi8vIOWQjOaXtuiuoeeul2JvYXJkSW5mb++8muS4uuaji+ebmOavj+S4quS9jee9rueZu+iusOaOp+WItuiAhQovLyDlpI3nlKggaW5mby5tb3ZlcyArIGFsbHlHdWFyZHPvvJvngq7nlKjkuIDmrKHlsITnur8KY29uc3QgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMgPSAoYm9hcmQsIHBpZWNlc0luZm8sIGJvYXJkSW5mbykgPT4gewogICAgLy8g5Yid5aeL5YyW5qOL5a2Q5YWz57O75pWw57uECiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgewogICAgICAgIGluZm8udGhyZWF0ID0gW107ICAgICAgICAgICAvLyDmo4Dmn6Xov5nkuKrmo4vlrZDlj6/ku6XlqIHog4Hlk6rkupvmo4vlrZAKICAgICAgICBpbmZvLnRocmVhdGVuZWRCeSA9IFtdOyAgICAgLy8g5qOA5p+l6L+Z5Liq5qOL5a2Q6KKr5ZOq5Lqb5qOL5a2Q5aiB6IOBCiAgICAgICAgaW5mby5ndWFyZCA9IFtdOyAgICAgICAvLyDmo4Dmn6Xov5nkuKrmo4vlrZDlj6/ku6Xkv53miqTlk6rkupvmo4vlrZAKICAgICAgICBpbmZvLmd1YXJkZWRCeSA9IFtdOyAgICAgIC8vIOajgOafpei/meS4quaji+WtkOiiq+WTquS6m+aji+WtkOS/neaKpAogICAgICAgIGluZm8uY29udHJvbCA9IFtdOyAgICAgIC8vIOajgOafpei/meS4quaji+WtkOWPr+S7peaOp+WItueahOWTquS6m+S9jee9rgogICAgfQogICAgCiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VBdHRhY2tCaXRzKTsKICAgIC8vIOWmguaenGJvYXJkSW5mb+S4uuepuu+8jOWImeWIneWni+WMluaOp+WItuiAheWIl+ihqO+8iOeCueajiy9VSSDot6/lvoTvvIkKICAgIGlmICghYm9hcmRJbmZvKSB7CiAgICAgICAgYm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsKICAgIH0KCiAgICBjb25zdCBwb3NCeUtleSA9IG5ldyBNYXAoKTsKICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7CiAgICAgICAgcG9zQnlLZXkuc2V0KGluZm8uciAqIDkgKyBpbmZvLmMsIGluZm8pOwogICAgfQogICAgCiAgICAvLyDlpITnkIbmr4/kuKrmo4vlrZDvvJrkuIDmrKHlh6DkvZXlkIzml7bloasgbW92ZXMgKyDlhbPns7vvvIjngq4v6Z2e54Ku57uf5LiA5qih5byP77yJCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgewogICAgICAgIGlmIChpbmZvLnBpZWNlLnR5cGUgPT09ICdjYW5ub24nKSB7CiAgICAgICAgICAgIGZpbGxDYW5ub25SZWxhdGlvbnMoYm9hcmQsIGluZm8sIHBvc0J5S2V5KTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgICBmaWxsTm9uQ2Fubm9uUmVsYXRpb25zKGJvYXJkLCBpbmZvLCBwb3NCeUtleSk7CiAgICAgICAgfQoKICAgICAgICBjb25zdCBjb250cm9sID0gaW5mby5jb250cm9sOwogICAgICAgIAogICAgICAgIGlmICh1c2VBdHRhY2tCaXRzKSB7CiAgICAgICAgICAgIC8vIOaQnOe0ouWPtu+8muWPquiusOOAjOivpeiJsuaYr+WQpuaUu+WHu+ivpeagvOOAje+8jOS4jeW7uuaOp+WItuiAheaVsOe7hAogICAgICAgICAgICBjb25zdCBiaXRzID0gaW5mby5waWVjZS5jb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkQXR0YWNrIDogYm9hcmRJbmZvLmJsYWNrQXR0YWNrOwogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbnRyb2wubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IHBvcyA9IGNvbnRyb2xbaV07CiAgICAgICAgICAgICAgICBzZXRBdHRhY2tCaXQoYml0cywgcG9zLnIgKiA5ICsgcG9zLmMpOwogICAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgLy8g54K55qOLL1VJ77ya5o6n5Yi26ICF5YiX6KGo55u05o6l5byV55SoIHBpZWNlc0luZm8g5p2h55uuCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29udHJvbC5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgY29uc3QgcG9zID0gY29udHJvbFtpXTsKICAgICAgICAgICAgICAgIGJvYXJkSW5mb1twb3Mucl1bcG9zLmNdLnB1c2goaW5mbyk7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CiAgICAKICAgIC8vIOmihOiuoeeul+WwhuWGm+eKtuaAgQogICAgbGV0IHJlZElzSW5DaGVjayA9IGZhbHNlOwogICAgbGV0IGJsYWNrSXNJbkNoZWNrID0gZmFsc2U7CiAgICAKICAgIGxldCByZWRHZW5lcmFsSW5mbyA9IG51bGw7CiAgICBsZXQgYmxhY2tHZW5lcmFsSW5mbyA9IG51bGw7CiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgewogICAgICAgIGlmIChpbmZvLnBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgewogICAgICAgICAgICBpZiAoaW5mby5waWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsKICAgICAgICAgICAgICAgIHJlZEdlbmVyYWxJbmZvID0gaW5mbzsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGJsYWNrR2VuZXJhbEluZm8gPSBpbmZvOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQogICAgCiAgICBpZiAocmVkR2VuZXJhbEluZm8pIHsKICAgICAgICBmb3IgKGNvbnN0IHRocmVhdGVuZXIgb2YgcmVkR2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7CiAgICAgICAgICAgIGlmICh0aHJlYXRlbmVyLnBpZWNlLmNvbG9yID09PSAnYmxhY2snKSB7CiAgICAgICAgICAgICAgICByZWRJc0luQ2hlY2sgPSB0cnVlOwogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CiAgICAKICAgIGlmIChibGFja0dlbmVyYWxJbmZvKSB7CiAgICAgICAgZm9yIChjb25zdCB0aHJlYXRlbmVyIG9mIGJsYWNrR2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7CiAgICAgICAgICAgIGlmICh0aHJlYXRlbmVyLnBpZWNlLmNvbG9yID09PSAncmVkJykgewogICAgICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOwogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CiAgICAKICAgIGlmIChyZWRHZW5lcmFsSW5mbyAmJiBibGFja0dlbmVyYWxJbmZvICYmIHJlZEdlbmVyYWxJbmZvLmMgPT09IGJsYWNrR2VuZXJhbEluZm8uYykgewogICAgICAgIGxldCBoYXNQaWVjZUJldHdlZW4gPSBmYWxzZTsKICAgICAgICBjb25zdCBzdGFydFIgPSBNYXRoLm1pbihyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpICsgMTsKICAgICAgICBjb25zdCBlbmRSID0gTWF0aC5tYXgocmVkR2VuZXJhbEluZm8uciwgYmxhY2tHZW5lcmFsSW5mby5yKSAtIDE7CiAgICAgICAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsKICAgICAgICAgICAgaWYgKGJvYXJkW3JdW3JlZEdlbmVyYWxJbmZvLmNdKSB7CiAgICAgICAgICAgICAgICBoYXNQaWVjZUJldHdlZW4gPSB0cnVlOwogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgaWYgKCFoYXNQaWVjZUJldHdlZW4pIHsKICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsKICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOwogICAgICAgIH0KICAgIH0KICAgIAogICAgYm9hcmRJbmZvLnJlZElzSW5DaGVjayA9IHJlZElzSW5DaGVjazsKICAgIGJvYXJkSW5mby5ibGFja0lzSW5DaGVjayA9IGJsYWNrSXNJbkNoZWNrOwp9OwoKLy8g552A5rOV5o6S5bqP5Ye95pWw77ya5qC55o2u5LyY5YWI57qn5o6S5bqP552A5rOVCi8vIOiiq+WwhuaXtu+8muWQg+WwhuWtkCA+IOWPjeWwhiA+IOWFtuWug+WQg+WtkCA+IOi1sOWwhumAg+mAuCA+IOWeq+Wwhi/lhbbkvZkKLy8g5pyq6KKr5bCG5pe277yaCi8vIDEuIOS8mOWFiOWkhOeQhuaIkeaWueaXoOS/neaKpOeahOiiq+WNleWQkeWogeiDgeeahOaji+WtkOaJp+ihjOmAg+i3keedgOazle+8jOWmguacieWkmuS4quaji+WtkOaMieadkOaWmeWAvOS7jumrmOWIsOS9juaOkuW6jwovLyAyLiDlhbbmrKHlpITnkIbmiJHmlrnljZXlkJHlqIHog4Hlr7nmlrnml6Dkv53miqTmo4vlrZDnmoTmo4vlrZDmiafooYzlkIPlrZDnnYDms5XvvIzlpoLmnInlpJrkuKrmo4vlrZDmjInmo4vlrZDmnZDmlpnlgLzku47pq5jliLDkvY7mjpLluo8KLy8gMy4g5pyA5ZCO5aSE55CG5LiN5raJ5Y+K5ZCD5ZKM6KKr5ZCD55qE552A5rOV77yM6KaB5rGC6YG/5YWN56e75Yqo5Yiw6KKr5ZCD55qE5L2N572uCmNvbnN0IHNvcnRNb3ZlcyA9IChtb3ZlcywgYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIHBpZWNlc0luZm8sIGdhbWVTdGFnZSA9ICdtaWQnLCBib2FyZEluZm8gPSBudWxsLCBzZWFyY2hIZXVyaXN0aWNzID0gbnVsbCkgPT4gewogICAgLy8g5L2/55So5Lyg5YWl55qEZ2FtZVN0YWdl5Y+C5pWw77yM6YG/5YWN6YeN5aSN6LCD55SoZ2V0R2FtZVBoYXNlCiAgICAKICAgIC8vIOeUqOmihOiuoeeul+eahOiiq+WwhueKtuaAge+8iOS4jeiDveeUqCBib2FyZEluZm8uY2hlY2tz77ya6YKj5piv4oCc6LCB5Zyo5bCG5Yab4oCd77yM5LiN5piv4oCc6LCB6KKr5bCG4oCd77yJCiAgICBjb25zdCBjdXJyZW50SXNJbkNoZWNrID0gYm9hcmRJbmZvCiAgICAgICAgPyAoKGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnICYmIGJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8CiAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgJiYgYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKSkKICAgICAgICA6IGlzQ2hlY2soYm9hcmQsIGN1cnJlbnRQbGF5ZXIpOwoKICAgIC8vIOiiq+WwhuaXtuaUtumbhuato+WcqOWwhuWGm+eahOaVjOaWueaji+WtkOS9jee9ru+8jOeUqOS6juS8mOWFiOWQg+WwhuWtkAogICAgbGV0IGNoZWNrZXJLZXlzID0gbnVsbDsKICAgIGlmIChjdXJyZW50SXNJbkNoZWNrICYmIHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7CiAgICAgICAgY29uc3QgZ2VuZXJhbEluZm8gPSBwaWVjZXNJbmZvLmZpbmQoCiAgICAgICAgICAgIHAgPT4gcC5waWVjZSAmJiBwLnBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBwLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyCiAgICAgICAgKTsKICAgICAgICBpZiAoZ2VuZXJhbEluZm8gJiYgZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7CiAgICAgICAgICAgIGNoZWNrZXJLZXlzID0gbmV3IFNldCgKICAgICAgICAgICAgICAgIGdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeQogICAgICAgICAgICAgICAgICAgIC5maWx0ZXIodCA9PiB0LnBpZWNlICYmIHQucGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpCiAgICAgICAgICAgICAgICAgICAgLm1hcCh0ID0+IGAke3Qucn0sJHt0LmN9YCkKICAgICAgICAgICAgKTsKICAgICAgICB9CiAgICB9CgogICAgY29uc3QgdHRNb3ZlID0gc2VhcmNoSGV1cmlzdGljcz8udHRNb3ZlIHx8IG51bGw7CiAgICBjb25zdCBraWxsZXJzID0gc2VhcmNoSGV1cmlzdGljcz8ua2lsbGVycyB8fCBudWxsOwogICAgCiAgICAvLyDkuLrmr4/kuKrnnYDms5XorqHnrpfkvJjlhYjnuqfliIbmlbDlubbkv53lrZjljp/lp4vntKLlvJUKICAgIC8vIOaOkuW6j+Wxgue6p++8mlRULW1vdmUgPiDlupTlsIYv5ZCD5a2Q562J6Z2Z5oCB5LyY5YWI57qnID4ga2lsbGVyID4gaGlzdG9yeQogICAgbW92ZXMuZm9yRWFjaCgobW92ZSwgaW5kZXgpID0+IHsKICAgICAgICBjb25zdCB7IGZyb20sIHRvIH0gPSBtb3ZlOwogICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbZnJvbS5yXVtmcm9tLmNdOwogICAgICAgIGNvbnN0IHBpZWNlVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOwoKICAgICAgICBjb25zdCB0YXJnZXRQaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOwogICAgICAgIGNvbnN0IHRhcmdldFBpZWNlVmFsdWUgPSB0YXJnZXRQaWVjZSA/IGdldE1hdGVyaWFsVmFsdWUodGFyZ2V0UGllY2UsIGdhbWVTdGFnZSkgOiAwOwogICAgICAgIAogICAgICAgIGxldCBwcmlvcml0eSA9IDQ7CiAgICAgICAgbGV0IHNjb3JlID0gMDsKCiAgICAgICAgaWYgKHR0TW92ZSAmJiBpc1NhbWVNb3ZlKG1vdmUsIHR0TW92ZSkpIHsKICAgICAgICAgICAgcHJpb3JpdHkgPSAtMTsKICAgICAgICAgICAgc2NvcmUgPSAxMDAwMDAwOwogICAgICAgIH0gZWxzZSBpZiAoY3VycmVudElzSW5DaGVjaykgewogICAgICAgICAgICAvLyDooqvlsIbvvJrlkIjms5XnnYDms5XlnYflt7Lop6PpmaTlsIblhpvvvJvkvJjlhYjlkIPlsIblrZDvvIzlhbbmrKHlkIPlrZAv5Yqo5bCG77yI5LiN5o6i5rWL5Y+N5bCG77yJCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVzQ2hlY2tlciA9IHRhcmdldFBpZWNlICYmIGNoZWNrZXJLZXlzICYmIGNoZWNrZXJLZXlzLmhhcyhgJHt0by5yfSwke3RvLmN9YCk7CiAgICAgICAgICAgIGlmIChjYXB0dXJlc0NoZWNrZXIpIHsKICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMDsKICAgICAgICAgICAgICAgIHNjb3JlID0gMTAwMDAgKyB0YXJnZXRQaWVjZVZhbHVlOwogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7CiAgICAgICAgICAgICAgICAvLyBNVlYtTFZB77ya6LS15a2Q5LyY5YWI5ZCD44CB5L6/5a6c5a2Q5LyY5YWI5Y675ZCDCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDI7CiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWUgKiAxNiAtIHBpZWNlVmFsdWU7CiAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDM7CiAgICAgICAgICAgICAgICBzY29yZSA9IHBpZWNlVmFsdWU7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDQ7CiAgICAgICAgICAgICAgICBzY29yZSA9IDA7CiAgICAgICAgICAgIH0KICAgICAgICB9IGVsc2UgaWYgKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5sZW5ndGggPiAwKSB7CiAgICAgICAgICAgIGNvbnN0IGlzVGhyZWF0ZW5lZFBpZWNlID0gYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMuc29tZShwID0+IHAuciA9PT0gZnJvbS5yICYmIHAuYyA9PT0gZnJvbS5jKTsKICAgICAgICAgICAgaWYgKGlzVGhyZWF0ZW5lZFBpZWNlKSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDE7CiAgICAgICAgICAgICAgICBzY29yZSA9IHBpZWNlVmFsdWU7CiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsKICAgICAgICAgICAgICAgIGNvbnN0IGlzQ2FuQ2FwdHVyZSA9IGJvYXJkSW5mby5jYW5DYXB0dXJlICYmIGJvYXJkSW5mby5jYW5DYXB0dXJlLnNvbWUocCA9PiBwLnIgPT09IHRvLnIgJiYgcC5jID09PSB0by5jKTsKICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gaXNDYW5DYXB0dXJlID8gMiA6IDM7CiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDQ7CiAgICAgICAgICAgICAgICBzY29yZSA9IDA7CiAgICAgICAgICAgIH0KICAgICAgICB9IGVsc2UgaWYgKGJvYXJkSW5mbyAmJiBib2FyZEluZm8uY2FuQ2FwdHVyZSAmJiBib2FyZEluZm8uY2FuQ2FwdHVyZS5sZW5ndGggPiAwKSB7CiAgICAgICAgICAgIGNvbnN0IGlzQ2FuQ2FwdHVyZSA9IGJvYXJkSW5mby5jYW5DYXB0dXJlLnNvbWUocCA9PiBwLnIgPT09IHRvLnIgJiYgcC5jID09PSB0by5jKTsKICAgICAgICAgICAgaWYgKGlzQ2FuQ2FwdHVyZSkgewogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOwogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOwogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDM7CiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDQ7CiAgICAgICAgICAgICAgICBzY29yZSA9IDA7CiAgICAgICAgICAgIH0KICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7CiAgICAgICAgICAgIC8vIOaXoOWogeiDgeihqOaXtu+8iOaQnOe0oui9u+mHj+i3r+W+hO+8ie+8mk1WVi1MVkEg5ZCD5a2Q5o6S5bqPCiAgICAgICAgICAgIHByaW9yaXR5ID0gMzsKICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlICogMTYgLSBwaWVjZVZhbHVlOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIHByaW9yaXR5ID0gNDsKICAgICAgICAgICAgc2NvcmUgPSAwOwogICAgICAgIH0KCiAgICAgICAgLy8ga2lsbGVyIC8gaGlzdG9yee+8muS4jeimhuebliBUVCDkuI7pq5jkvJjlhYjnuqflkIPlrZAv5bqU5bCGCiAgICAgICAgaWYgKHByaW9yaXR5ID49IDApIHsKICAgICAgICAgICAgaWYgKCF0YXJnZXRQaWVjZSAmJiBraWxsZXJzICYmIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc1swXSkpIHsKICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gTWF0aC5taW4ocHJpb3JpdHksIDIpOwogICAgICAgICAgICAgICAgc2NvcmUgKz0gODAwMDsKICAgICAgICAgICAgfSBlbHNlIGlmICghdGFyZ2V0UGllY2UgJiYga2lsbGVycyAmJiBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNbMV0pKSB7CiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IE1hdGgubWluKHByaW9yaXR5LCAyKTsKICAgICAgICAgICAgICAgIHNjb3JlICs9IDcwMDA7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgc2NvcmUgKz0gZ2V0SGlzdG9yeVNjb3JlKG1vdmUpOwogICAgICAgIH0KICAgICAgICAKICAgICAgICBtb3ZlLnByaW9yaXR5ID0gcHJpb3JpdHk7CiAgICAgICAgbW92ZS5zb3J0U2NvcmUgPSBzY29yZTsKICAgICAgICBtb3ZlLm9yaWdpbmFsSW5kZXggPSBpbmRleDsKICAgIH0pOwogICAgCiAgICAvLyDmoLnmja7kvJjlhYjnuqfjgIHliIbmlbDlkozljp/lp4vntKLlvJXmjpLluo/nnYDms5UKICAgIG1vdmVzLnNvcnQoKGEsIGIpID0+IHsKICAgICAgICAvLyDpppblhYjmjInkvJjlhYjnuqfmjpLluo/vvIzkvJjlhYjnuqcwID4gMSA+IDIgPiAzID4gNAogICAgICAgIGlmIChhLnByaW9yaXR5ICE9PSBiLnByaW9yaXR5KSB7CiAgICAgICAgICAgIHJldHVybiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eTsKICAgICAgICB9CiAgICAgICAgLy8g5LyY5YWI57qn55u45ZCM5pe277yM5oyJ5YiG5pWw5LuO6auY5Yiw5L2O5o6S5bqPCiAgICAgICAgaWYgKGEuc29ydFNjb3JlICE9PSBiLnNvcnRTY29yZSkgewogICAgICAgICAgICByZXR1cm4gYi5zb3J0U2NvcmUgLSBhLnNvcnRTY29yZTsKICAgICAgICB9CiAgICAgICAgLy8g5LyY5YWI57qn5ZKM5YiG5pWw6YO955u45ZCM5pe277yM5oyJ5Y6f5aeL57Si5byV5o6S5bqP77yM5L+d5oyB56iz5a6aCiAgICAgICAgcmV0dXJuIGEub3JpZ2luYWxJbmRleCAtIGIub3JpZ2luYWxJbmRleDsKICAgIH0pOwogICAgCiAgICByZXR1cm4gbW92ZXM7Cn07CgovLyDmo4Dmn6Xnm67moIfkvY3nva7mmK/lkKblj6/mjqXlj5fvvIjpgb/lhY3mmI7mmL7pgIHlkIMv5LqP5o2i77yJCi8vIOS8mOWMlueJiO+8muaOpeWPl+mihOiuoeeul+eahGJvYXJkSW5mb+WSjHBpZWNlc0luZm/vvIzpgb/lhY3ph43lpI3orqHnrpcKY29uc3QgaXNQb3NpdGlvbkFjY2VwdGFibGUgPSAoYm9hcmQsIGZyb20sIHRvLCBjdXJyZW50UGxheWVyLCBib2FyZEluZm8gPSBudWxsLCBwaWVjZXNJbmZvID0gbnVsbCwgdHJ5TW92ZVBpZWNlID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcpID0+IHsKICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gdHJ5TW92ZVBpZWNlIHx8IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsKICAgIGNvbnN0IHRhcmdldFBpZWNlID0gYm9hcmRbdG8ucl1bdG8uY107CiAgICBjb25zdCBpc0NhcHR1cmUgPSB0YXJnZXRQaWVjZSAmJiB0YXJnZXRQaWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcjsKCiAgICAvLyDmlLbpm4bmiYDmnInmo4vlrZDkv6Hmga/vvIzlj6rlnKjmsqHmnInmj5Dkvpvml7borqHnrpcKICAgIGxldCBsb2NhbFBpZWNlc0luZm8gPSBwaWVjZXNJbmZvOwogICAgaWYgKCFsb2NhbFBpZWNlc0luZm8pIHsKICAgICAgICBsb2NhbFBpZWNlc0luZm8gPSBbXTsKICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgewogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsKICAgICAgICAgICAgICAgIGlmIChwaWVjZSkgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IGFsbHlHdWFyZHMgPSBbXTsKICAgICAgICAgICAgICAgICAgICBjb25zdCBtb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSwgYWxseUd1YXJkcyk7CiAgICAgICAgICAgICAgICAgICAgbG9jYWxQaWVjZXNJbmZvLnB1c2goewogICAgICAgICAgICAgICAgICAgICAgICBwaWVjZSwKICAgICAgICAgICAgICAgICAgICAgICAgciwgYywgbW92ZXMsIGFsbHlHdWFyZHMsCiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsVmFsdWU6IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSksCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogW10sCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeTogW10sCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkOiBbXSwKICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwKICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogMCwKICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eVZhbHVlOiAwLAogICAgICAgICAgICAgICAgICAgICAgICB0YWN0aWNWYWx1ZTogMAogICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIC8vIOiuoeeul+aji+WtkOWFs+ezu+WSjOaOp+WItuS/oeaBr++8jOWPquWcqOayoeacieaPkOS+m+aXtuiuoeeulwogICAgbGV0IGxvY2FsQm9hcmRJbmZvID0gYm9hcmRJbmZvOwogICAgaWYgKCFsb2NhbEJvYXJkSW5mbykgewogICAgICAgIGxvY2FsQm9hcmRJbmZvID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7CiAgICAgICAgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMoYm9hcmQsIGxvY2FsUGllY2VzSW5mbywgbG9jYWxCb2FyZEluZm8pOwogICAgfQoKICAgIGNvbnN0IGNvbnRyb2xsZXJzID0gbG9jYWxCb2FyZEluZm9bdG8ucl1bdG8uY10gfHwgW107CiAgICBsZXQgaGFzQWxseUNvbnRyb2xsZXIgPSBmYWxzZTsKICAgIGxldCBoYXNFbmVteUNvbnRyb2xsZXIgPSBmYWxzZTsKCiAgICAvLyDmjqfliLbogIXlj6/og73mmK8gcGllY2VzSW5mbyDlvJXnlKgge3BpZWNlLHIsY30g5oiW5pen57uT5p6EIHtjb2xvcix0eXBlLHIsY30KICAgIGNvbnN0IGNvbnRyb2xsZXJDb2xvciA9IChjb250cm9sbGVyKSA9PgogICAgICAgIGNvbnRyb2xsZXIucGllY2UgPyBjb250cm9sbGVyLnBpZWNlLmNvbG9yIDogY29udHJvbGxlci5jb2xvcjsKCiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgY29udHJvbGxlcnMpIHsKICAgICAgICAvLyDmjpLpmaTmraPlnKjnp7vliqjnmoTmo4vlrZDmnKzouqvvvIjotbDlkI7lroPkuI3lho3ku47ljp/kvY3mjqfliLbnm67moIfvvIkKICAgICAgICBpZiAobW92aW5nUGllY2UgJiYgY29udHJvbGxlci5yID09PSBmcm9tLnIgJiYgY29udHJvbGxlci5jID09PSBmcm9tLmMpIHsKICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgfQogICAgICAgIGlmIChjb250cm9sbGVyQ29sb3IoY29udHJvbGxlcikgPT09IGN1cnJlbnRQbGF5ZXIpIHsKICAgICAgICAgICAgaGFzQWxseUNvbnRyb2xsZXIgPSB0cnVlOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbGxlciA9IHRydWU7CiAgICAgICAgfQogICAgfQoKICAgIGlmIChpc0NhcHR1cmUpIHsKICAgICAgICAvLyDnmb3lkIPvvJrnm67moIfmnKrooqvmlYzmlrnkv53miqQKICAgICAgICBpZiAoIWhhc0VuZW15Q29udHJvbGxlcikgewogICAgICAgICAgICByZXR1cm4gdHJ1ZTsKICAgICAgICB9CiAgICAgICAgLy8g566A5Y2VIFNFRe+8muWFiOW+l+ebruagh+WIhu+8jOiLpeS8muiiq+WPjeWQg+WImeWGjeWkseW3seaWueaji+WtkAogICAgICAgIGNvbnN0IHRhcmdldFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZSh0YXJnZXRQaWVjZSwgZ2FtZVN0YWdlKTsKICAgICAgICBjb25zdCBvdXJWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUobW92aW5nUGllY2UsIGdhbWVTdGFnZSk7CiAgICAgICAgbGV0IHNlZSA9IHRhcmdldFZhbHVlIC0gb3VyVmFsdWU7CiAgICAgICAgLy8g6Iul5pyJ5bex5pa557un57ut5L+d5oqk77yM57KX55Wl6K6k5Li65Y+v6IO95YaN5ZCD5Zue5pyA5L2O5Lu35YC855qE5pWM5pa55L+d5oqk6ICFCiAgICAgICAgaWYgKGhhc0FsbHlDb250cm9sbGVyKSB7CiAgICAgICAgICAgIGNvbnN0IGVuZW15R3VhcmRWYWx1ZXMgPSBjb250cm9sbGVycwogICAgICAgICAgICAgICAgLmZpbHRlcihjID0+IGNvbnRyb2xsZXJDb2xvcihjKSAhPT0gY3VycmVudFBsYXllciAmJiAhKGMuciA9PT0gZnJvbS5yICYmIGMuYyA9PT0gZnJvbS5jKSkKICAgICAgICAgICAgICAgIC5tYXAoYyA9PiB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW2Mucl1bYy5jXTsKICAgICAgICAgICAgICAgICAgICByZXR1cm4gcCA/IGdldE1hdGVyaWFsVmFsdWUocCwgZ2FtZVN0YWdlKSA6IDA7CiAgICAgICAgICAgICAgICB9KQogICAgICAgICAgICAgICAgLmZpbHRlcih2ID0+IHYgPiAwKQogICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IGEgLSBiKTsKICAgICAgICAgICAgaWYgKGVuZW15R3VhcmRWYWx1ZXMubGVuZ3RoID4gMCkgewogICAgICAgICAgICAgICAgc2VlICs9IGVuZW15R3VhcmRWYWx1ZXNbMF07CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgLy8g5piO5pi+5LqP5o2i77yI5aaC6L2m5o2i5peg5qC55YW15LiU5Lya6KKr5Y+N5ZCD77yJ5YiZ6L+H5ruk77yb5bmz5o2iL+i1muaNoueVmee7meaQnOe0ogogICAgICAgIHJldHVybiBzZWUgPj0gMDsKICAgIH0KCiAgICAvLyDpnZ7lkIPlrZDvvJrnm67moIfku4XooqvmlYzmlrnmjqfliLbliJnop4bkuLrpgIHlkIMKICAgIGlmIChjb250cm9sbGVycy5sZW5ndGggPT09IDApIHsKICAgICAgICByZXR1cm4gdHJ1ZTsKICAgIH0KICAgIHJldHVybiAhaGFzRW5lbXlDb250cm9sbGVyIHx8IGhhc0FsbHlDb250cm9sbGVyOwp9OwoKLy8gU0VFIOaOkuW6j+WkjeeUqOe8k+WGsu+8jOmZjeS9juWPtuivhOS8sCBHQwpjb25zdCBzZWVBdHRhY2tlclNjcmF0Y2ggPSBbXTsKY29uc3Qgc2VlR3VhcmRTY3JhdGNoID0gW107CgovLyDmnInmoLnlrZDnroDljJYgU0VF77yI5LiO5pen5a6e546w6YCQ6KGM562J5Lu377yJ77yb5q+P5Liq55uu5qCH5Y+q5bqU6LCD55So5LiA5qyhCmNvbnN0IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmUgPSAodGhyZWF0ZW5lZFBpZWNlKSA9PiB7CiAgICBjb25zdCBhdHRhY2tlcnMgPSBzZWVBdHRhY2tlclNjcmF0Y2g7CiAgICBjb25zdCBndWFyZHMgPSBzZWVHdWFyZFNjcmF0Y2g7CiAgICBhdHRhY2tlcnMubGVuZ3RoID0gMDsKICAgIGd1YXJkcy5sZW5ndGggPSAwOwogICAgY29uc3QgcmF3QXR0YWNrZXJzID0gdGhyZWF0ZW5lZFBpZWNlLnRocmVhdGVuZWRCeTsKICAgIGNvbnN0IHJhd0d1YXJkcyA9IHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnk7CiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJhd0F0dGFja2Vycy5sZW5ndGg7IGkrKykgYXR0YWNrZXJzLnB1c2gocmF3QXR0YWNrZXJzW2ldKTsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF3R3VhcmRzLmxlbmd0aDsgaSsrKSBndWFyZHMucHVzaChyYXdHdWFyZHNbaV0pOwogICAgYXR0YWNrZXJzLnNvcnQoKGEsIGIpID0+IGEubWF0ZXJpYWxWYWx1ZSAtIGIubWF0ZXJpYWxWYWx1ZSk7CiAgICBndWFyZHMuc29ydCgoYSwgYikgPT4gYS5tYXRlcmlhbFZhbHVlIC0gYi5tYXRlcmlhbFZhbHVlKTsKCiAgICBsZXQgZXhjaGFuZ2VTY29yZSA9IDA7CiAgICBsZXQgYXR0YWNrZXJJbmRleCA9IDA7CiAgICBsZXQgZ3VhcmRJbmRleCA9IDA7CiAgICBjb25zdCB0YXJnZXRWYWx1ZSA9IHRocmVhdGVuZWRQaWVjZS5tYXRlcmlhbFZhbHVlOwoKICAgIHdoaWxlIChhdHRhY2tlckluZGV4IDwgYXR0YWNrZXJzLmxlbmd0aCAmJiBndWFyZEluZGV4IDwgZ3VhcmRzLmxlbmd0aCkgewogICAgICAgIGlmIChndWFyZEluZGV4ID09PSAwKSB7CiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gdGFyZ2V0VmFsdWU7CiAgICAgICAgfQogICAgICAgIGV4Y2hhbmdlU2NvcmUgLT0gYXR0YWNrZXJzW2F0dGFja2VySW5kZXhdLm1hdGVyaWFsVmFsdWU7CiAgICAgICAgaWYgKGF0dGFja2VySW5kZXggKyAxIDwgYXR0YWNrZXJzLmxlbmd0aCkgewogICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IGd1YXJkc1tndWFyZEluZGV4XS5tYXRlcmlhbFZhbHVlOwogICAgICAgIH0KICAgICAgICBhdHRhY2tlckluZGV4Kys7CiAgICAgICAgZ3VhcmRJbmRleCsrOwogICAgfQogICAgcmV0dXJuIGV4Y2hhbmdlU2NvcmU7Cn07CgovLyDorqHnrpflqIHog4HlgLzvvIjln7rkuo7lrozmlbTnmoTlqIHog4HlhbPns7vvvIkKLy8g5oyJ6KKr5aiB6IOB5a2Q6IGa5ZCI77ya5q+P5Liq55uu5qCH5pyA5aSa5LiA5qyhIFNFRe+8m+WIhuWAvOWKoOe7mSB0aHJlYXRlbmVkQnlbMF0KLy8g77yI5YWz57O75p6E5bu65oyJIHBpZWNlc0luZm8g6aG65bqPIHB1c2jvvIzmlYXkuI7ml6figJzmlLvlh7vmlrnlpJblsYLpgY3ljobpppbmrKHorqHliIbigJ3lvZLlsZ7kuIDoh7TvvIkKY29uc3QgY2FsY3VsYXRlVGhyZWF0VmFsdWVzID0gKHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbyA9IG51bGwpID0+IHsKICAgIC8vIOe7n+iuoQogICAgaWYgKGN1cnJlbnRQbGF5ZXIpIHsKICAgICAgICBwZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnRbY3VycmVudFBsYXllcl0rKzsKICAgIH0KCiAgICAvLyDliJ3lp4vljJblqIHog4Hnsbvlnovnu5/orqHkv6Hmga8KICAgIGlmIChib2FyZEluZm8pIHsKICAgICAgICBib2FyZEluZm8uY2hlY2tzID0gW107ICAgICAgLy8g5bCG5Yab5L+h5oGvCiAgICAgICAgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMgPSBbXTsgIC8vIOiiq+aNieeahOaji+WtkAogICAgICAgIGJvYXJkSW5mby5jYW5DYXB0dXJlID0gW107ICAvLyDlj6/lkIPnmoTmo4vlrZAKICAgIH0KCiAgICBjb25zdCBjaGVja0JvbnVzID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmNoZWNrLmJvbnVzOwogICAgY29uc3QgY2FuQ2FwdHVyZVNlZW4gPSBuZXcgU2V0KCk7CgogICAgZm9yIChsZXQgdGkgPSAwOyB0aSA8IHBpZWNlc0luZm8ubGVuZ3RoOyB0aSsrKSB7CiAgICAgICAgY29uc3QgdGhyZWF0ZW5lZFBpZWNlID0gcGllY2VzSW5mb1t0aV07CiAgICAgICAgY29uc3QgYXR0YWNrZXJzID0gdGhyZWF0ZW5lZFBpZWNlLnRocmVhdGVuZWRCeTsKICAgICAgICBpZiAoIWF0dGFja2VycyB8fCBhdHRhY2tlcnMubGVuZ3RoID09PSAwKSBjb250aW51ZTsKCiAgICAgICAgLy8gdGhyZWF0ZW5lZEJ5WzBdID0gcGllY2VzSW5mbyDpobrluo/kuIvmnIDlhYjmjILkuIrlqIHog4HnmoTmlLvlh7vmlrnvvIjkuI7ml6fpppbmrKHorqHliIbkuIDoh7TvvIkKICAgICAgICBjb25zdCBmaXJzdEF0dGFja2VyID0gYXR0YWNrZXJzWzBdOwoKICAgICAgICAvLyDlsIblhpvvvJrlj6rnu5nlsI/pop3lhYjmiYvliIbvvIznu53kuI3mjInlsIYv5biF5p2Q5paZ5YC85YGaIFNFRQogICAgICAgIGlmICh0aHJlYXRlbmVkUGllY2UucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgewogICAgICAgICAgICBpZiAoYm9hcmRJbmZvKSB7CiAgICAgICAgICAgICAgICBmb3IgKGxldCBhaSA9IDA7IGFpIDwgYXR0YWNrZXJzLmxlbmd0aDsgYWkrKykgewogICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jaGVja3MucHVzaCh7CiAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja2VyOiBhdHRhY2tlcnNbYWldLAogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHRocmVhdGVuZWRQaWVjZSwKICAgICAgICAgICAgICAgICAgICAgICAgaXNDaGVjazogdHJ1ZQogICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gY2hlY2tCb251czsKICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgfQoKICAgICAgICBjb25zdCBoYXNHdWFyZCA9IHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnkgJiYgdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeS5sZW5ndGggPiAwOwoKICAgICAgICAvLyDlj6rmiorlr7nmlLvlh7vmlrnmnInliKnnmoTlqIHog4HorqHlhaUgdGhyZWF0VmFsdWXvvIjljZXlkJHorqHlhaXvvIzkuI3lgZogc2FmZXR5IOWvueensOaJo+WIhu+8iQogICAgICAgIGlmICghaGFzR3VhcmQpIHsKICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsKICAgICAgICAgICAgaWYgKGJvYXJkSW5mbykgewogICAgICAgICAgICAgICAgLy8g5pS75Ye75pa55ZCM6Imy77ya6KaB5LmI5YWo5pivIGN1cnJlbnRQbGF5ZXLvvIjorrAgY2FuQ2FwdHVyZe+8ie+8jOimgeS5iOWFqOS4jeaYr++8iOiusCB0aHJlYXRlbmVkUGllY2Vz77yJCiAgICAgICAgICAgICAgICBpZiAoZmlyc3RBdHRhY2tlci5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgewogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGFpID0gMDsgYWkgPCBhdHRhY2tlcnMubGVuZ3RoOyBhaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBhdHRhY2tlcnNbYWldOwogICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbkNhcHR1cmVTZWVuLmhhcyhpbmZvKSkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FuQ2FwdHVyZVNlZW4uYWRkKGluZm8pOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUucHVzaChpbmZvKTsKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMucHVzaCh0aHJlYXRlbmVkUGllY2UpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgLy8gU0VFIOavj+ebruagh+S4gOasoe+8m+acieagueS4lOS6pOaNouS7jei1muWImeaKmOWNiuiuoeWFpQogICAgICAgICAgICBjb25zdCBzc2VTY29yZSA9IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmUodGhyZWF0ZW5lZFBpZWNlKTsKICAgICAgICAgICAgaWYgKHNzZVNjb3JlID4gMCkgewogICAgICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSBzc2VTY29yZSAqIDAuNTsKICAgICAgICAgICAgfQogICAgICAgICAgICAvLyBzc2VTY29yZSA8PSAw77ya5LqP5o2iL+W5s+aNou+8jOS4jeiusOWogeiDgeWIhgogICAgICAgIH0KICAgIH0KfTsKCi8vIOiuoeeul+WuieWFqOWAvCAtIOmHjeaehOeJiO+8muWfuuS6jmJvYXJkSW5mb+eahOaOp+WItuWFs+ezuwpjb25zdCBjYWxjdWxhdGVTYWZldHlWYWx1ZXMgPSAocGllY2VzSW5mbywgYm9hcmRJbmZvKSA9PiB7CiAgICAvLyAxLiDmib7liLDlsIblkozluIUKICAgIGNvbnN0IGdlbmVyYWxJbmZvID0gW107CiAgICBwaWVjZXNJbmZvLmZvckVhY2goaW5mbyA9PiB7CiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgewogICAgICAgICAgICBnZW5lcmFsSW5mby5wdXNoKGluZm8pOwogICAgICAgIH0KICAgIH0pOwoKICAgIGNvbnN0IHVzZUF0dGFja0JpdHMgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMpOwogICAgCiAgICBmb3IgKGNvbnN0IGdlbmVyYWwgb2YgZ2VuZXJhbEluZm8pIHsKICAgICAgICBjb25zdCBnZW5lcmFsQ29sb3IgPSBnZW5lcmFsLnBpZWNlLmNvbG9yOwogICAgICAgIGNvbnN0IGVuZW15Q29sb3IgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgIGNvbnN0IGVuZW15Qml0cyA9IHVzZUF0dGFja0JpdHMKICAgICAgICAgICAgPyAoZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkQXR0YWNrIDogYm9hcmRJbmZvLmJsYWNrQXR0YWNrKQogICAgICAgICAgICA6IG51bGw7CiAgICAgICAgCiAgICAgICAgLy8g5qOA5p+l5bCG5biF55qE5o6n5Yi254K55piv5ZCm6KKr5pWM5pa55qOL5a2Q5o6n5Yi2CiAgICAgICAgZm9yIChjb25zdCBjb250cm9sUG9zIG9mIGdlbmVyYWwuY29udHJvbCkgewogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IGNvbnRyb2xQb3M7CiAgICAgICAgICAgIGxldCBoYXNFbmVteUNvbnRyb2w7CiAgICAgICAgICAgIGlmICh1c2VBdHRhY2tCaXRzKSB7CiAgICAgICAgICAgICAgICBoYXNFbmVteUNvbnRyb2wgPSBoYXNBdHRhY2tCaXQoZW5lbXlCaXRzLCByICogOSArIGMpOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgY29uc3QgcG9zaXRpb25Db250cm9sbGVycyA9IGJvYXJkSW5mb1tyXVtjXTsKICAgICAgICAgICAgICAgIC8vIOWFvOWuuSBwaWVjZXNJbmZvIOW8leeUqOS4juaXpyB7Y29sb3J9IOe7k+aehAogICAgICAgICAgICAgICAgaGFzRW5lbXlDb250cm9sID0gcG9zaXRpb25Db250cm9sbGVycy5zb21lKGNvbnRyb2xsZXIgPT4gewogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gY29udHJvbGxlci5waWVjZSA/IGNvbnRyb2xsZXIucGllY2UuY29sb3IgOiBjb250cm9sbGVyLmNvbG9yOwogICAgICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gZW5lbXlDb2xvcjsKICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyDlpoLmnpzkvY3nva7mnInmlYzmlrnmo4vlrZDmjqfliLbvvIzmiaM1MOeahOWuieWFqOWAvAogICAgICAgICAgICBpZiAoaGFzRW5lbXlDb250cm9sKSB7CiAgICAgICAgICAgICAgICBnZW5lcmFsLnNhZmV0eVZhbHVlIC09IDUwOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQp9OwoKLy8gLS0tIFR5cGVzIChJbmxpbmVkIHRvIGF2b2lkIGltcG9ydCBpc3N1ZXMgaW4gV29ya2VyKSAtLS0KLy8gLy8gdHlwZSBDb2xvciAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgJ3JlZCcgfCAnYmxhY2snOwovLyAvLyB0eXBlIFBpZWNlVHlwZSAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgJ2dlbmVyYWwnIHwgJ2Fkdmlzb3InIHwgJ2VsZXBoYW50JyB8ICdob3JzZScgfCAnY2hhcmlvdCcgfCAnY2Fubm9uJyB8ICdzb2xkaWVyJzsKLy8gLy8gaW50ZXJmYWNlIFBpZWNlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5Ci8vIC8vIGludGVyZmFjZSBQb3NpdGlvbiAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQovLyAvLyBpbnRlcmZhY2UgTW92ZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQovLyAvLyB0eXBlIEJvYXJkIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAoUGllY2UgfCBudWxsKVtdW107CgovLyAtLS0gT3BlbmluZyBCb29rIFR5cGVzIC0tLQovLyBPcGVuaW5nIEJvb2sgRW50cnkgLSByZXByZXNlbnRzIHBvc3NpYmxlIG1vdmVzIGZvciBhIHBvc2l0aW9uCi8vIGludGVyZmFjZSBCb29rRW50cnkgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkKCi8vIEluZGl2aWR1YWwgbW92ZSBpbiBvcGVuaW5nIGJvb2sgd2l0aCBtZXRhZGF0YQovLyBpbnRlcmZhY2UgQm9va01vdmUgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkKCi8vIC0tLSBab2JyaXN0IEhhc2hpbmcgZm9yIE9wZW5pbmcgQm9vayAtLS0KLy8gRWFjaCBwaWVjZSB0eXBlL2NvbG9yL3Bvc2l0aW9uIGdldHMgYSB1bmlxdWUgcmFuZG9tIDUzLWJpdCBpbnRlZ2VyCi8vIFVzZXMgc2VlZGVkIFJORyBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nCmNsYXNzIFpvYnJpc3RIYXNoZXIgewogICAgaGFzaFRhYmxlOyAgLy8gW3Jvd11bY29sXVtwaWVjZUluZGV4XQogICAgcGllY2VUb0luZGV4OwoKICAgIGNvbnN0cnVjdG9yKCkgewogICAgICAgIHRoaXMucGllY2VUb0luZGV4ID0gbmV3IE1hcChbCiAgICAgICAgICAgIFsncmVkLWdlbmVyYWwnLCAwXSwKICAgICAgICAgICAgWydyZWQtYWR2aXNvcicsIDFdLAogICAgICAgICAgICBbJ3JlZC1lbGVwaGFudCcsIDJdLAogICAgICAgICAgICBbJ3JlZC1ob3JzZScsIDNdLAogICAgICAgICAgICBbJ3JlZC1jaGFyaW90JywgNF0sCiAgICAgICAgICAgIFsncmVkLWNhbm5vbicsIDVdLAogICAgICAgICAgICBbJ3JlZC1zb2xkaWVyJywgNl0sCiAgICAgICAgICAgIFsnYmxhY2stZ2VuZXJhbCcsIDddLAogICAgICAgICAgICBbJ2JsYWNrLWFkdmlzb3InLCA4XSwKICAgICAgICAgICAgWydibGFjay1lbGVwaGFudCcsIDldLAogICAgICAgICAgICBbJ2JsYWNrLWhvcnNlJywgMTBdLAogICAgICAgICAgICBbJ2JsYWNrLWNoYXJpb3QnLCAxMV0sCiAgICAgICAgICAgIFsnYmxhY2stY2Fubm9uJywgMTJdLAogICAgICAgICAgICBbJ2JsYWNrLXNvbGRpZXInLCAxM10sCiAgICAgICAgXSk7CgogICAgICAgIC8vIEluaXRpYWxpemUgcmFuZG9tIGhhc2ggdmFsdWVzIHVzaW5nIHNlZWRlZCBSTkcgKDUzLWJpdCBpbnRlZ2VycyB0byBhdm9pZCBwcmVjaXNpb24gaXNzdWVzKQogICAgICAgIHRoaXMuaGFzaFRhYmxlID0gW107CiAgICAgICAgY29uc3QgTUFYX1NBRkUgPSAweDFGRkZGRkZGRkZGRkZGOyAvLyAyXjUzIC0gMQogICAgICAgIAogICAgICAgIC8vIFNpbXBsZSBzZWVkZWQgUk5HIChMQ0cgLSBMaW5lYXIgQ29uZ3J1ZW50aWFsIEdlbmVyYXRvcikKICAgICAgICBsZXQgc2VlZCA9IDEyMzQ1Njc4OTsgLy8gRml4ZWQgc2VlZCBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nCiAgICAgICAgY29uc3Qgc2VlZGVkUmFuZG9tID0gKCkgPT4gewogICAgICAgICAgICBzZWVkID0gKHNlZWQgKiAxMTAzNTE1MjQ1ICsgMTIzNDUpICYgMHg3ZmZmZmZmZjsKICAgICAgICAgICAgcmV0dXJuIHNlZWQgLyAweDdmZmZmZmZmOwogICAgICAgIH07CgogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgewogICAgICAgICAgICB0aGlzLmhhc2hUYWJsZVtyXSA9IFtdOwogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgewogICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY10gPSBbXTsKICAgICAgICAgICAgICAgIGZvciAobGV0IHAgPSAwOyBwIDwgMTQ7IHArKykgewogICAgICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIGRldGVybWluaXN0aWMgNTMtYml0IGludGVnZXIKICAgICAgICAgICAgICAgICAgICB0aGlzLmhhc2hUYWJsZVtyXVtjXVtwXSA9IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CgogICAgICAgIC8vIOWPtuivhOS8sOe8k+WtmOmUru+8mmJvYXJkSGFzaCBeIGluaXRpYXRvcktleSBeIHN0YWdlS2V5CiAgICAgICAgdGhpcy5ldmFsSW5pdGlhdG9yS2V5cyA9IHsKICAgICAgICAgICAgcmVkOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpLAogICAgICAgICAgICBibGFjazogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKQogICAgICAgIH07CiAgICAgICAgdGhpcy5ldmFsU3RhZ2VLZXlzID0gewogICAgICAgICAgICBlYXJseTogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwKICAgICAgICAgICAgbWlkOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpLAogICAgICAgICAgICBsYXRlOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpCiAgICAgICAgfTsKICAgIH0KCiAgICBwaWVjZUluZGV4KHBpZWNlT3JLZXkpIHsKICAgICAgICBpZiAocGllY2VPcktleSA9PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkOwogICAgICAgIGlmICh0eXBlb2YgcGllY2VPcktleSA9PT0gJ3N0cmluZycpIHJldHVybiB0aGlzLnBpZWNlVG9JbmRleC5nZXQocGllY2VPcktleSk7CiAgICAgICAgcmV0dXJuIHRoaXMucGllY2VUb0luZGV4LmdldChgJHtwaWVjZU9yS2V5LmNvbG9yfS0ke3BpZWNlT3JLZXkudHlwZX1gKTsKICAgIH0KCiAgICBldmFsQ2FjaGVLZXkoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKSB7CiAgICAgICAgY29uc3Qgc3RhZ2VLZXkgPSB0aGlzLmV2YWxTdGFnZUtleXNbZ2FtZVN0YWdlXSB8fCB0aGlzLmV2YWxTdGFnZUtleXMubWlkOwogICAgICAgIHJldHVybiB0aGlzLmhhc2goYm9hcmQpIF4gdGhpcy5ldmFsSW5pdGlhdG9yS2V5c1tzZWFyY2hJbml0aWF0b3JdIF4gc3RhZ2VLZXk7CiAgICB9CgogICAgZXZhbENhY2hlS2V5RnJvbUhhc2goYm9hcmRIYXNoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSkgewogICAgICAgIGNvbnN0IHN0YWdlS2V5ID0gdGhpcy5ldmFsU3RhZ2VLZXlzW2dhbWVTdGFnZV0gfHwgdGhpcy5ldmFsU3RhZ2VLZXlzLm1pZDsKICAgICAgICByZXR1cm4gYm9hcmRIYXNoIF4gdGhpcy5ldmFsSW5pdGlhdG9yS2V5c1tzZWFyY2hJbml0aWF0b3JdIF4gc3RhZ2VLZXk7CiAgICB9CgogICAgLyoqCiAgICAgKiDmlbDlgLwgVFQga2V577ya5oqK6KGM5qOL5pa557yW56CB6L+b5pyA5L2O5L2N77yM6YG/5YWNIGBoYXNoIF4gc2lkZUtleWAg5ZyoIEpTIFRvSW50MzIKICAgICAqIOS4i+S6p+eUn+i3qOe6oum7keeisOaSnu+8iOmCo+S8muS9vyBUVCDor6/lkb3kuK3lubbmlLnlj5jmkJzntKLmoJEv5qOL5Yqb77yJ44CCCiAgICAgKiDnrYnku7fkuo7ml6flrZfnrKbkuLIga2V5IGAke2hhc2h9OiR7c2lkZX1gIOeahOWMuuWIhuiDveWKm+OAggogICAgICovCiAgICB0dEtleUZyb21IYXNoKGJvYXJkSGFzaCwgc2lkZSkgewogICAgICAgIGNvbnN0IGggPSBib2FyZEhhc2ggfCAwOyAvLyBePSDpk77nu5Pmnpzlt7LmmK8gSW50MzIKICAgICAgICByZXR1cm4gaCAqIDIgKyAoc2lkZSA9PT0gJ3JlZCcgPyAwIDogMSk7CiAgICB9CgogICAgLyoqCiAgICAgKiBDb21wdXRlIGhhc2ggZm9yIGEgYm9hcmQgcG9zaXRpb24KICAgICAqLwogICAgaGFzaChib2FyZCkgewogICAgICAgIGxldCBoID0gMDsKICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsKICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBwaWVjZUlkeCA9IHRoaXMucGllY2VJbmRleChwaWVjZSk7CiAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlSWR4ICE9PSB1bmRlZmluZWQpIHsKICAgICAgICAgICAgICAgICAgICAgICAgaCBePSB0aGlzLmhhc2hUYWJsZVtyXVtjXVtwaWVjZUlkeF07CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybiBoOwogICAgfQoKICAgIC8qKgogICAgICogTWlycm9yIGEgYm9hcmQgaG9yaXpvbnRhbGx5IChmb3Igc3ltbWV0cnkgZGV0ZWN0aW9uKQogICAgICovCiAgICBtaXJyb3JCb2FyZChib2FyZCkgewogICAgICAgIGNvbnN0IG1pcnJvcmVkID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkpOwogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgewogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgewogICAgICAgICAgICAgICAgbWlycm9yZWRbcl1bOCAtIGNdID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgcmV0dXJuIG1pcnJvcmVkOwogICAgfQoKICAgIC8qKgogICAgICogTWlycm9yIGEgbW92ZSBob3Jpem9udGFsbHkKICAgICAqLwogICAgbWlycm9yTW92ZShtb3ZlKSB7CiAgICAgICAgcmV0dXJuIHsKICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogOCAtIG1vdmUuZnJvbS5jIH0sCiAgICAgICAgICAgIHRvOiB7IHI6IG1vdmUudG8uciwgYzogOCAtIG1vdmUudG8uYyB9CiAgICAgICAgfTsKICAgIH0KCiAgICAvKioKICAgICAqIEluY3JlbWVudGFsbHkgdXBkYXRlIGhhc2ggYWZ0ZXIgYSBtb3ZlIChYT1Ig6Ieq6YCG77ya5YaN6LCD55So5LiA5qyh5Y+v6L+Y5Y6fKS4KICAgICAqIG1vdmluZ1BpZWNlIC8gY2FwdHVyZWRQaWVjZSDlj6/kuLrmo4vlrZDlr7nosaHmiJYgJ2NvbG9yLXR5cGUnIOWtl+espuS4suOAggogICAgICog6aG75ZyoIG1ha2VNb3ZlIOS5i+WJjeWPluW+lyBtb3ZpbmdQaWVjZe+8jGNhcHR1cmVkIOeUqCBtYWtlTW92ZSDov5Tlm57lgLzjgIIKICAgICAqLwogICAgdXBkYXRlSGFzaChjdXJyZW50SGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkUGllY2UpIHsKICAgICAgICBsZXQgbmV3SGFzaCA9IGN1cnJlbnRIYXNoOwogICAgICAgIGNvbnN0IG1vdmluZ0lkeCA9IHRoaXMucGllY2VJbmRleChtb3ZpbmdQaWVjZSk7CiAgICAgICAgaWYgKG1vdmluZ0lkeCAhPT0gdW5kZWZpbmVkKSB7CiAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXVttb3ZpbmdJZHhdOwogICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUudG8ucl1bbW92ZS50by5jXVttb3ZpbmdJZHhdOwogICAgICAgIH0KICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgewogICAgICAgICAgICBjb25zdCBjYXB0dXJlZElkeCA9IHRoaXMucGllY2VJbmRleChjYXB0dXJlZFBpZWNlKTsKICAgICAgICAgICAgaWYgKGNhcHR1cmVkSWR4ICE9PSB1bmRlZmluZWQpIHsKICAgICAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS50by5yXVttb3ZlLnRvLmNdW2NhcHR1cmVkSWR4XTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICByZXR1cm4gbmV3SGFzaDsKICAgIH0KfQoKLyoqCiAqIE9wZW5pbmcgQm9vayBNYW5hZ2VyCiAqLwpjbGFzcyBPcGVuaW5nQm9vayB7CiAgICBib29rOyAgLy8gWm9icmlzdCBoYXNoIC0+IG1vdmVzCiAgICBoYXNoZXI7CiAgICBlbmFibGVkOwogICAgbWF4UGx5OyAgLy8gTWF4aW11bSBwbHkgdG8gdXNlIG9wZW5pbmcgYm9vayAoZS5nLiwgMjApCgogICAgY29uc3RydWN0b3IobWF4UGx5ID0gMTIpIHsKICAgICAgICB0aGlzLmJvb2sgPSBuZXcgTWFwKCk7CiAgICAgICAgdGhpcy5oYXNoZXIgPSBuZXcgWm9icmlzdEhhc2hlcigpOwogICAgICAgIHRoaXMuZW5hYmxlZCA9IHRydWU7CiAgICAgICAgdGhpcy5tYXhQbHkgPSBtYXhQbHk7CiAgICAgICAgdGhpcy5pbml0aWFsaXplQm9vaygpOwogICAgfQoKICAgIC8qKgogICAgICogSW5pdGlhbGl6ZSB3aXRoIGNvbW1vbiBDaGluZXNlIENoZXNzIG9wZW5pbmdzCiAgICAgKi8KICAgIGluaXRpYWxpemVCb29rKCkgewogICAgICAgIC8vIEFkZCBjbGFzc2ljIENoaW5lc2UgQ2hlc3Mgb3BlbmluZ3MgbWFudWFsbHkKICAgICAgICAKICAgICAgICAvKgogICAgICAgIC8vIDEuIOS4reeCrui/h+ays+i9puWvueWxj+mjjumprOW5s+eCruWvuei9piAoQ2VudHJhbCBDYW5ub24gdnMgU2NyZWVuIEhvcnNlcykKICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lKFsKICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDcsIGM6IDcgfSwgdG86IHsgcjogNywgYzogNCB9IH0sICAvLyAxLiDngq7kuozlubPkupQKICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDcgfSwgdG86IHsgcjogMiwgYzogNiB9IH0sICAvLyAxLi4uIOmprDjov5s3CiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA3IH0sIHRvOiB7IHI6IDcsIGM6IDYgfSB9LCAgLy8gMi4g6ams5LqM6L+b5LiJCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiA4IH0sIHRvOiB7IHI6IDAsIGM6IDcgfSB9LCAgLy8gMi4uLiDovaY55bmzOCAgICAgICAgICAgCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA4IH0sIHRvOiB7IHI6IDksIGM6IDcgfSB9LCAgLy8gMy4g6L2m5LiA5bmz5LqMCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAzLCBjOiA2IH0sIHRvOiB7IHI6IDQsIGM6IDYgfSB9LCAgLy8gMy4uLiDljZI36L+bMQogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogNyB9LCB0bzogeyByOiAzLCBjOiA3IH0gfSwgIC8vIDQuIOi9puS6jOi/m+WFrQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogMSB9LCB0bzogeyByOiAyLCBjOiAyIH0gfSwgIC8vIDQuLi4g6amsMui/mzMKICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDYsIGM6IDIgfSwgdG86IHsgcjogNSwgYzogMiB9IH0sICAvLyA1LiDlhbXkuIPov5vkuIAKICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDIsIGM6IDcgfSwgdG86IHsgcjogMiwgYzogOCB9IH0sICAvLyA1Li4uIOeCrjjlubM5CiAgICAgICAgICAgIHsgZnJvbTogeyByOiAzLCBjOiA3IH0sIHRvOiB7IHI6IDMsIGM6IDYgfSB9LCAgLy8gNi4g6L2m5LqM5bmz5LiJCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAyLCBjOiA4IH0sIHRvOiB7IHI6IDEsIGM6IDggfSB9LCAgLy8gNi4uLiDngq456YCAMSAgICAgICAgICAKICAgICAgICBdLCBbODUsIDg1LCA5NSwgOTAsIDkwLCA4NSwgODUsIDgwLCA4NSwgODUsIDg1LCA4NV0pOwoKICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKFsKICAgICAgICAgICAgJ+eCruS6jOW5s+S6lCcsICfpqaw46L+bNycsICfpqazkuozov5vkuIknLCAn6L2mOeW5szgnLCAn6L2m5LiA5bmz5LqMJywgJ+WNkjfov5sxJywKICAgICAgICAgICAgJ+i9puS6jOi/m+WFrScsICfpqawy6L+bMycsICflhbXkuIPov5vkuIAnLCAn54KuOOW5szknLCAn6L2m5LqM5bmz5LiJJywgJ+eCrjnpgIAxJywKICAgICAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsKCiAgICAgICAgICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyhbCiAgICAgICAgICAgICfngq7kuozlubPkupQg6amsOOi/mzcg6ams5LqM6L+b5LiJIOi9pjnlubM4IOi9puS4gOW5s+S6jCDljZI36L+bMSDovabkuozov5vlha0g6amsMui/mzMg5YW15LiD6L+b5LiAIOeCrjjlubM5IOi9puS6jOW5s+S4iSDngq456YCAMScKICAgICAgICBdLCBbODUsIDg1LCA5NSwgOTAsIDkwLCA4NSwgODUsIDgwLCA4NSwgODUsIDg1LCA4NV0pOwogICAgICAgICovCiAgICB9CgogICAgLyoqCiAgICAgKiBBZGQgYW4gb3BlbmluZyBsaW5lIHRvIHRoZSBib29rCiAgICAgKiBAcGFyYW0gbW92ZXMgQXJyYXkgb2YgbW92ZXMgcmVwcmVzZW50aW5nIGFuIG9wZW5pbmcgbGluZQogICAgICogQHBhcmFtIHdlaWdodHMgT3B0aW9uYWwgd2VpZ2h0cyBmb3IgZWFjaCBtb3ZlIChkZWZhdWx0IDEwMCBmb3IgYWxsKQogICAgICovCiAgICBhZGRPcGVuaW5nTGluZShtb3Zlcywgd2VpZ2h0cykgewogICAgICAgIC8vIFN0YXJ0IHdpdGggaW5pdGlhbCBib2FyZCBwb3NpdGlvbgogICAgICAgIGNvbnN0IGJvYXJkID0gdGhpcy5jcmVhdGVJbml0aWFsQm9hcmQoKTsKICAgICAgICBsZXQgY3VycmVudEhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKGJvYXJkKTsKCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtb3Zlcy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbaV07CiAgICAgICAgICAgIGNvbnN0IHdlaWdodCA9IHdlaWdodHM/LltpXSA/PyAxMDA7CgogICAgICAgICAgICAvLyBHZXQgb3IgY3JlYXRlIGJvb2sgZW50cnkgZm9yIHRoaXMgcG9zaXRpb24KICAgICAgICAgICAgbGV0IGVudHJ5ID0gdGhpcy5ib29rLmdldChjdXJyZW50SGFzaCk7CiAgICAgICAgICAgIGlmICghZW50cnkpIHsKICAgICAgICAgICAgICAgIGVudHJ5ID0geyBtb3ZlczogW10gfTsKICAgICAgICAgICAgICAgIHRoaXMuYm9vay5zZXQoY3VycmVudEhhc2gsIGVudHJ5KTsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgLy8gQWRkIG1vdmUgaWYgbm90IGFscmVhZHkgcHJlc2VudAogICAgICAgICAgICBjb25zdCBleGlzdGluZ01vdmUgPSBlbnRyeS5tb3Zlcy5maW5kKAogICAgICAgICAgICAgICAgbSA9PiBtLmZyb20uciA9PT0gbW92ZS5mcm9tLnIgJiYgbS5mcm9tLmMgPT09IG1vdmUuZnJvbS5jICYmCiAgICAgICAgICAgICAgICAgICAgIG0udG8uciA9PT0gbW92ZS50by5yICYmIG0udG8uYyA9PT0gbW92ZS50by5jCiAgICAgICAgICAgICk7CgogICAgICAgICAgICBpZiAoIWV4aXN0aW5nTW92ZSkgewogICAgICAgICAgICAgICAgZW50cnkubW92ZXMucHVzaCh7CiAgICAgICAgICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogbW92ZS5mcm9tLmMgfSwKICAgICAgICAgICAgICAgICAgICB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IG1vdmUudG8uYyB9LAogICAgICAgICAgICAgICAgICAgIHdlaWdodDogd2VpZ2h0CiAgICAgICAgICAgICAgICB9KTsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSB3ZWlnaHQgaWYgbW92ZSBhbHJlYWR5IGV4aXN0cyAodGFrZSBtYXhpbXVtKQogICAgICAgICAgICAgICAgZXhpc3RpbmdNb3ZlLndlaWdodCA9IE1hdGgubWF4KGV4aXN0aW5nTW92ZS53ZWlnaHQsIHdlaWdodCk7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIC8vIE1ha2UgdGhlIG1vdmUgb24gdGhlIGJvYXJkCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXTsKICAgICAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBib2FyZFttb3ZlLnRvLnJdW21vdmUudG8uY107CiAgICAgICAgICAgIAogICAgICAgICAgICBpZiAoIXBpZWNlKSBicmVhazsgLy8gSW52YWxpZCBsaW5lCgogICAgICAgICAgICBjb25zdCBwaWVjZUtleSA9IGAke3BpZWNlLmNvbG9yfS0ke3BpZWNlLnR5cGV9YDsKICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBjYXB0dXJlZCA/IGAke2NhcHR1cmVkLmNvbG9yfS0ke2NhcHR1cmVkLnR5cGV9YCA6IHVuZGVmaW5lZDsKCiAgICAgICAgICAgIC8vIFVwZGF0ZSBoYXNoIGluY3JlbWVudGFsbHkKICAgICAgICAgICAgY3VycmVudEhhc2ggPSB0aGlzLmhhc2hlci51cGRhdGVIYXNoKGN1cnJlbnRIYXNoLCBtb3ZlLCBwaWVjZUtleSwgY2FwdHVyZWRLZXkpOwoKICAgICAgICAgICAgLy8gQXBwbHkgbW92ZQogICAgICAgICAgICBib2FyZFttb3ZlLnRvLnJdW21vdmUudG8uY10gPSBwaWVjZTsKICAgICAgICAgICAgYm9hcmRbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXSA9IG51bGw7CiAgICAgICAgfQogICAgfQoKICAgIC8qKgogICAgICogR2V0IGJlc3QgbW92ZSBmcm9tIG9wZW5pbmcgYm9vayBmb3IgY3VycmVudCBwb3NpdGlvbgogICAgICogQHBhcmFtIGJvYXJkIEN1cnJlbnQgYm9hcmQgc3RhdGUKICAgICAqIEBwYXJhbSBwbHkgQ3VycmVudCBwbHkgbnVtYmVyICgwID0gc3RhcnQgb2YgZ2FtZSkKICAgICAqIEByZXR1cm5zIE1vdmUgZnJvbSBib29rLCBvciBudWxsIGlmIHBvc2l0aW9uIG5vdCBpbiBib29rCiAgICAgKi8KICAgIGdldEJvb2tNb3ZlKGJvYXJkLCBwbHkpewogICAgICAgIC8vIERvbid0IHVzZSBib29rIGlmIGRpc2FibGVkIG9yIHBhc3QgbWF4IHBseQogICAgICAgIGlmICghdGhpcy5lbmFibGVkIHx8IHBseSA+PSB0aGlzLm1heFBseSkgewogICAgICAgICAgICBjb25zb2xlLmxvZygnT3BlbmluZyBib29rIGRpc2FibGVkIG9yIHBhc3QgbWF4IHBseScsIHsgZW5hYmxlZDogdGhpcy5lbmFibGVkLCBtYXhQbHk6IHRoaXMubWF4UGx5LCBwbHk6IHBseSB9KTsKICAgICAgICAgICAgcmV0dXJuIG51bGw7CiAgICAgICAgfQogICAgICAgIAogICAgICAgIC8vY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBnZXRCb29rTW92ZSBjYWxsZWQnLCB7IHBseSB9KTsKICAgICAgICAKICAgICAgICAvLyBUcnkgdG8gZmluZCBtb3ZlIGZvciBjdXJyZW50IHBvc2l0aW9uCiAgICAgICAgY29uc3QgaGFzaCA9IHRoaXMuaGFzaGVyLmhhc2goYm9hcmQpOwogICAgICAgIC8vY29uc29sZS5sb2coJ0N1cnJlbnQgcG9zaXRpb24gaGFzaDonLCBoYXNoKTsKICAgICAgICAKICAgICAgICBsZXQgZW50cnkgPSB0aGlzLmJvb2suZ2V0KGhhc2gpOwogICAgICAgIC8vY29uc29sZS5sb2coJ0VudHJ5IGZvdW5kIGZvciBjdXJyZW50IGhhc2g6JywgZW50cnkgPyBlbnRyeS5tb3Zlcy5sZW5ndGggKyAnIG1vdmVzJyA6ICdudWxsJyk7CiAgICAgICAgaWYgKGVudHJ5ICYmIGVudHJ5Lm1vdmVzLmxlbmd0aCA+IDApIHsKICAgICAgICAgICAgY29uc29sZS5sb2coJ0FsbCBwb3NzaWJsZSBib29rIG1vdmVzIHdpdGggd2VpZ2h0czonLCBKU09OLnN0cmluZ2lmeShlbnRyeS5tb3ZlcykpOwogICAgICAgICAgICAvLyBDYWxjdWxhdGUgdG90YWwgd2VpZ2h0CiAgICAgICAgICAgIGNvbnN0IHRvdGFsV2VpZ2h0ID0gZW50cnkubW92ZXMucmVkdWNlKChzdW0sIG1vdmUpID0+IHN1bSArIG1vdmUud2VpZ2h0LCAwKTsKICAgICAgICAgICAgY29uc29sZS5sb2coJ1RvdGFsIHdlaWdodDonLCB0b3RhbFdlaWdodCk7CiAgICAgICAgfQogICAgICAgIAogICAgICAgIGxldCBtaXJyb3JlZE1vdmUgPSBmYWxzZTsKCiAgICAgICAgLy8gSWYgbm90IGZvdW5kLCB0cnkgbWlycm9yZWQgcG9zaXRpb24KICAgICAgICBpZiAoIWVudHJ5IHx8IGVudHJ5Lm1vdmVzLmxlbmd0aCA9PT0gMCkgewogICAgICAgICAgICBjb25zdCBtaXJyb3JlZEJvYXJkID0gdGhpcy5oYXNoZXIubWlycm9yQm9hcmQoYm9hcmQpOwogICAgICAgICAgICBjb25zdCBtaXJyb3JlZEhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKG1pcnJvcmVkQm9hcmQpOwogICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gZW50cnkgZm91bmQsIHRyeWluZyBtaXJyb3JlZCBwb3NpdGlvbjonLCBtaXJyb3JlZEhhc2gpOwogICAgICAgICAgICAKICAgICAgICAgICAgZW50cnkgPSB0aGlzLmJvb2suZ2V0KG1pcnJvcmVkSGFzaCk7CiAgICAgICAgICAgIGlmIChlbnRyeSAmJiBlbnRyeS5tb3Zlcy5sZW5ndGggPiAwKSB7CiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdFbnRyeSBmb3VuZCBmb3IgbWlycm9yZWQgaGFzaDonLCBlbnRyeS5tb3Zlcy5sZW5ndGggKyAnIG1vdmVzJyk7CiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdPcmlnaW5hbCBtaXJyb3IgbW92ZXM6JywgSlNPTi5zdHJpbmdpZnkoZW50cnkubW92ZXMpKTsKICAgICAgICAgICAgICAgIG1pcnJvcmVkTW92ZSA9IHRydWU7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdObyBlbnRyeSBmb3VuZCBmb3IgbWlycm9yZWQgaGFzaCcpOwogICAgICAgICAgICB9CiAgICAgICAgfQoKICAgICAgICBpZiAoIWVudHJ5IHx8IGVudHJ5Lm1vdmVzLmxlbmd0aCA9PT0gMCkgewogICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgbW92ZSBub3QgZm91bmQgZm9yIGN1cnJlbnQgcG9zaXRpb24nKTsKICAgICAgICAgICAgcmV0dXJuIG51bGw7CiAgICAgICAgfQoKICAgICAgICAvLyBTZWxlY3QgbW92ZSBiYXNlZCBvbiB3ZWlnaHRzCiAgICAgICAgY29uc3Qgc2VsZWN0ZWRNb3ZlID0gdGhpcy5zZWxlY3RXZWlnaHRlZE1vdmUoZW50cnkubW92ZXMpOwogICAgICAgIGNvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgbW92ZSBzZWxlY3RlZDonLCBzZWxlY3RlZE1vdmUpOwogICAgICAgIAogICAgICAgIC8vIElmIHdlIHVzZWQgbWlycm9yZWQgcG9zaXRpb24sIG1pcnJvciB0aGUgbW92ZSBiYWNrCiAgICAgICAgaWYgKHNlbGVjdGVkTW92ZSAmJiBtaXJyb3JlZE1vdmUpIHsKICAgICAgICAgICAgLy8gY29uc29sZS5sb2coJ1NlbGVjdGVkIG1pcnJvciBtb3ZlIGJlZm9yZSBjb252ZXJzaW9uOicsIEpTT04uc3RyaW5naWZ5KHNlbGVjdGVkTW92ZSkpOwogICAgICAgICAgICBjb25zdCBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQgPSB0aGlzLmhhc2hlci5taXJyb3JNb3ZlKHNlbGVjdGVkTW92ZSk7CiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdDb252ZXJ0ZWQgbWlycm9yIG1vdmU6JywgSlNPTi5zdHJpbmdpZnkobWlycm9yZWRNb3ZlQ29udmVydGVkKSk7CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgbWlycm9yZWQgbW92ZSBoYXMgdmFsaWQgc3RydWN0dXJlCiAgICAgICAgICAgIGlmIChtaXJyb3JlZE1vdmVDb252ZXJ0ZWQgJiYgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20gJiYgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvICYmCiAgICAgICAgICAgICAgICB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tLmMgPT09ICdudW1iZXInICYmCiAgICAgICAgICAgICAgICB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQudG8uYyA9PT0gJ251bWJlcicpIHsKICAgICAgICAgICAgICAgIHJldHVybiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQ7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTWlycm9yZWQgbW92ZSBoYXMgaW52YWxpZCBzdHJ1Y3R1cmUsIHJldHVybmluZyBudWxsJyk7CiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsKICAgICAgICAgICAgfQogICAgICAgIH0gZWxzZSBpZiAoc2VsZWN0ZWRNb3ZlKSB7CiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBzZWxlY3RlZCBtb3ZlIGhhcyB2YWxpZCBzdHJ1Y3R1cmUKICAgICAgICAgICAgaWYgKHNlbGVjdGVkTW92ZS5mcm9tICYmIHNlbGVjdGVkTW92ZS50byAmJgogICAgICAgICAgICAgICAgdHlwZW9mIHNlbGVjdGVkTW92ZS5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBzZWxlY3RlZE1vdmUuZnJvbS5jID09PSAnbnVtYmVyJyAmJgogICAgICAgICAgICAgICAgdHlwZW9mIHNlbGVjdGVkTW92ZS50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLnRvLmMgPT09ICdudW1iZXInKSB7CiAgICAgICAgICAgICAgICByZXR1cm4gc2VsZWN0ZWRNb3ZlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlbGVjdGVkIG1vdmUgaGFzIGludmFsaWQgc3RydWN0dXJlLCByZXR1cm5pbmcgbnVsbCcpOwogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgCiAgICAgICAgcmV0dXJuIG51bGw7CiAgICB9CgogICAgLyoqCiAgICAgKiBTZWxlY3QgYSBtb3ZlIHJhbmRvbWx5IGJhc2VkIG9uIHdlaWdodHMKICAgICAqIEhpZ2hlciB3ZWlnaHQgPSBtb3JlIGxpa2VseSB0byBiZSBzZWxlY3RlZAogICAgICovCiAgICBzZWxlY3RXZWlnaHRlZE1vdmUobW92ZXMpIHsKICAgICAgICAvLyBDYWxjdWxhdGUgdG90YWwgd2VpZ2h0CiAgICAgICAgY29uc3QgdG90YWxXZWlnaHQgPSBtb3Zlcy5yZWR1Y2UoKHN1bSwgbW92ZSkgPT4gc3VtICsgbW92ZS53ZWlnaHQsIDApOwoKICAgICAgICAvLyBHZW5lcmF0ZSByYW5kb20gbnVtYmVyCiAgICAgICAgbGV0IHJhbmRvbSA9IE1hdGgucmFuZG9tKCkgKiB0b3RhbFdlaWdodDsKCiAgICAgICAgLy8gU2VsZWN0IG1vdmUKICAgICAgICBmb3IgKGNvbnN0IG1vdmUgb2YgbW92ZXMpIHsKICAgICAgICAgICAgcmFuZG9tIC09IG1vdmUud2VpZ2h0OwogICAgICAgICAgICBpZiAocmFuZG9tIDw9IDApIHsKICAgICAgICAgICAgICAgIHJldHVybiB7CiAgICAgICAgICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogbW92ZS5mcm9tLmMgfSwgdG86IHsgcjogbW92ZS50by5yLCBjOiBtb3ZlLnRvLmMgfQogICAgICAgICAgICAgICAgfTsKICAgICAgICAgICAgfQogICAgICAgIH0KCiAgICAgICAgLy8gRmFsbGJhY2sgKHNob3VsZCBuZXZlciByZWFjaCBoZXJlKQogICAgICAgIHJldHVybiB7CiAgICAgICAgICAgIGZyb206IHsgcjogbW92ZXNbMF0uZnJvbS5yLCBjOiBtb3Zlc1swXS5mcm9tLmMgfSwgdG86IHsgcjogbW92ZXNbMF0udG8uciwgYzogbW92ZXNbMF0udG8uYyB9CiAgICAgICAgfTsKICAgIH0KCiAgICAvKioKICAgICAqIEhlbHBlciB0byBjcmVhdGUgaW5pdGlhbCBib2FyZCAobmVlZGVkIGZvciBib29rIGluaXRpYWxpemF0aW9uKQogICAgICovCiAgICBjcmVhdGVJbml0aWFsQm9hcmQoKSB7CiAgICAgICAgY29uc3QgYm9hcmQgPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKSk7CiAgICAgICAgCiAgICAgICAgLy8gUmVkIHBpZWNlcyAoYm90dG9tIC0gcj0wLTIpCiAgICAgICAgYm9hcmRbMF1bMF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbMF1bMV0gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAncmVkJyB9OwogICAgICAgIGJvYXJkWzBdWzJdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFswXVszXSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFswXVs0XSA9IHsgdHlwZTogJ2dlbmVyYWwnLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFswXVs1XSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFswXVs2XSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbMF1bN10gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAncmVkJyB9OwogICAgICAgIGJvYXJkWzBdWzhdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAncmVkJyB9OwogICAgICAgIGJvYXJkWzJdWzFdID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdyZWQnIH07CiAgICAgICAgYm9hcmRbMl1bN10gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFszXVswXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFszXVsyXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFszXVs0XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFszXVs2XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsKICAgICAgICBib2FyZFszXVs4XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsKCiAgICAgICAgLy8gQmxhY2sgcGllY2VzICh0b3AgLSByPTctOSkKICAgICAgICBib2FyZFs5XVswXSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzldWzFdID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzldWzJdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzldWzNdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAnYmxhY2snIH07CiAgICAgICAgYm9hcmRbOV1bNF0gPSB7IHR5cGU6ICdnZW5lcmFsJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs5XVs1XSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzldWzZdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzldWzddID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzldWzhdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAnYmxhY2snIH07CiAgICAgICAgYm9hcmRbN11bMV0gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzddWzddID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs2XVswXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzZdWzJdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07CiAgICAgICAgYm9hcmRbNl1bNF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsKICAgICAgICBib2FyZFs2XVs2XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9OwogICAgICAgIGJvYXJkWzZdWzhdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07CgogICAgICAgIHJldHVybiBib2FyZDsKICAgIH0KCiAgICAvKioKICAgICAqIEVuYWJsZSBvciBkaXNhYmxlIG9wZW5pbmcgYm9vawogICAgICovCiAgICBzZXRFbmFibGVkKGVuYWJsZWQpIHsKICAgICAgICB0aGlzLmVuYWJsZWQgPSBlbmFibGVkOwogICAgfQoKICAgIC8qKgogICAgICogQ2hlY2sgaWYgb3BlbmluZyBib29rIGlzIGVuYWJsZWQKICAgICAqLwogICAgaXNFbmFibGVkKCkgewogICAgICAgIHJldHVybiB0aGlzLmVuYWJsZWQ7CiAgICB9CgogICAgLyoqCiAgICAgKiBHZXQgc3RhdGlzdGljcyBhYm91dCB0aGUgb3BlbmluZyBib29rCiAgICAgKi8KICAgIGdldFN0YXRzKCkgewogICAgICAgIGxldCB0b3RhbE1vdmVzID0gMDsKICAgICAgICB0aGlzLmJvb2suZm9yRWFjaChlbnRyeSA9PiB7CiAgICAgICAgICAgIHRvdGFsTW92ZXMgKz0gZW50cnkubW92ZXMubGVuZ3RoOwogICAgICAgIH0pOwoKICAgICAgICByZXR1cm4gewogICAgICAgICAgICBwb3NpdGlvbnM6IHRoaXMuYm9vay5zaXplLAogICAgICAgICAgICB0b3RhbE1vdmVzCiAgICAgICAgfTsKICAgIH0KCiAgICAvKioKICAgICAqIEFkZCBvcGVuaW5nIGxpbmUgZnJvbSB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uCiAgICAgKiBAcGFyYW0gbm90YXRpb24gQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uIChlLmcuLCBbJ+eCruS6jOW5s+S6lCcsICfpqaw46L+bNyddKQogICAgICogQHBhcmFtIHdlaWdodHMgT3B0aW9uYWwgYXJyYXkgb2Ygd2VpZ2h0cyBmb3IgZWFjaCBtb3ZlCiAgICAgKi8KICAgIGFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKG5vdGF0aW9uLCB3ZWlnaHRzKSB7CiAgICAgICAgLy8gQ29udmVydCB0cmFkaXRpb25hbCBub3RhdGlvbiB0byBjb29yZGluYXRlIGZvcm1hdAogICAgICAgIGNvbnN0IG1vdmVzID0gdGhpcy5ub3RhdGlvblRvTW92ZXMobm90YXRpb24pOwogICAgICAgIC8vIEFkZCB0aGUgbW92ZXMgdG8gdGhlIG9wZW5pbmcgYm9vawogICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmUobW92ZXMsIHdlaWdodHMpOwogICAgfQoKICAgIC8qKgogICAgICogQWRkIG9wZW5pbmcgbGluZSBmcm9tIHN0cmluZyB3aXRoIHNwYWNlLXNlcGFyYXRlZCB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uCiAgICAgKiBAcGFyYW0gbm90YXRpb25BcnJheSBBcnJheSBvZiBzdHJpbmdzLCBlYWNoIGNvbnRhaW5pbmcgc3BhY2Utc2VwYXJhdGVkIG1vdmVzIChlLmcuLCBbJ+eCruS6jOW5s+S6lCDpqaw46L+bNyDovabkuIDlubPkuownXSkKICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIGFycmF5IG9mIHdlaWdodHMgZm9yIGVhY2ggbW92ZQogICAgICovCiAgICBhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcobm90YXRpb25BcnJheSwgd2VpZ2h0cykgewogICAgICAgIC8vIFByb2Nlc3MgZWFjaCBzdHJpbmcgaW4gdGhlIGFycmF5CiAgICAgICAgaWYgKCFub3RhdGlvbkFycmF5IHx8ICFBcnJheS5pc0FycmF5KG5vdGF0aW9uQXJyYXkpIHx8IG5vdGF0aW9uQXJyYXkubGVuZ3RoID09PSAwKSB7CiAgICAgICAgICAgIHJldHVybjsKICAgICAgICB9CiAgICAgICAgbm90YXRpb25BcnJheS5mb3JFYWNoKG5vdGF0aW9uU3RyaW5nID0+IHsKICAgICAgICAgICAgLy8gU3BsaXQgdGhlIHN0cmluZyBieSBzcGFjZXMgdG8gZ2V0IGluZGl2aWR1YWwgbW92ZXMKICAgICAgICAgICAgY29uc3Qgbm90YXRpb24gPSBub3RhdGlvblN0cmluZy5zcGxpdCgnICcpLmZpbHRlcihtb3ZlID0+IG1vdmUudHJpbSgpICE9PSAnJyk7CiAgICAgICAgICAgIC8vIENhbGwgZXhpc3RpbmcgZnVuY3Rpb24gdG8gYWRkIHRoZSBsaW5lCiAgICAgICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tTm90YXRpb24obm90YXRpb24sIHdlaWdodHMpOwogICAgICAgIH0pOwogICAgfQoKICAgIC8qKgogICAgICogQ29udmVydCBjb29yZGluYXRlLWJhc2VkIG1vdmVzIHRvIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24KICAgICAqIEBwYXJhbSBib2FyZEhpc3RvcnkgQXJyYXkgb2YgYm9hcmQgc3RhdGVzIHJlcHJlc2VudGluZyB0aGUgZ2FtZSBoaXN0b3J5CiAgICAgKiBAcGFyYW0gbW92ZUhpc3RvcnkgQXJyYXkgb2YgbW92ZXMgaW4gY29vcmRpbmF0ZSBmb3JtYXQKICAgICAqIEByZXR1cm5zIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbgogICAgICovCiAgICBtb3Zlc1RvTm90YXRpb24oYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSkgewogICAgICAgIGNvbnN0IG5vdGF0aW9uID0gW107CiAgICAgICAgbGV0IGN1cnJlbnRDb2xvciA9ICdyZWQnOyAvLyBSZWQgbW92ZXMgZmlyc3QKCiAgICAgICAgLy8gVHlwZSB0byBwaWVjZSBjaGFyYWN0ZXIgbWFwcGluZwogICAgICAgIGNvbnN0IHR5cGVUb1BpZWNlID0gewogICAgICAgICAgICAnZ2VuZXJhbCc6IHsgJ3JlZCc6ICfluIUnLCAnYmxhY2snOiAn5bCGJyB9LAogICAgICAgICAgICAnYWR2aXNvcic6IHsgJ3JlZCc6ICfku5UnLCAnYmxhY2snOiAn5aOrJyB9LAogICAgICAgICAgICAnZWxlcGhhbnQnOiB7ICdyZWQnOiAn55u4JywgJ2JsYWNrJzogJ+ixoScgfSwKICAgICAgICAgICAgJ2hvcnNlJzogeyAncmVkJzogJ+mprCcsICdibGFjayc6ICfpqawnIH0sCiAgICAgICAgICAgICdjaGFyaW90JzogeyAncmVkJzogJ+i9picsICdibGFjayc6ICfovaYnIH0sCiAgICAgICAgICAgICdjYW5ub24nOiB7ICdyZWQnOiAn54KuJywgJ2JsYWNrJzogJ+eCricgfSwKICAgICAgICAgICAgJ3NvbGRpZXInOiB7ICdyZWQnOiAn5YW1JywgJ2JsYWNrJzogJ+WNkicgfQogICAgICAgIH07CgogICAgICAgIC8vIENvbHVtbiBtYXBwaW5nIChjb29yZGluYXRlIDAtOCB0byB0cmFkaXRpb25hbCDkuZ0t5LiAIGZvciByZWQsIDktMSBmb3IgYmxhY2spCiAgICAgICAgY29uc3QgY29sVG9DaGluZXNlID0gWyfkuZ0nLCAn5YWrJywgJ+S4gycsICflha0nLCAn5LqUJywgJ+WbmycsICfkuIknLCAn5LqMJywgJ+S4gCddOwogICAgICAgIGNvbnN0IGNvbFRvQXJhYmljID0gWyc5JywgJzgnLCAnNycsICc2JywgJzUnLCAnNCcsICczJywgJzInLCAnMSddOwoKICAgICAgICAvLyBEaWdpdCB0byBDaGluZXNlIG51bWJlciBtYXBwaW5nIGZvciBzdGVwcwogICAgICAgIGNvbnN0IGRpZ2l0VG9DaGluZXNlID0gWycnLCAn5LiAJywgJ+S6jCcsICfkuIknLCAn5ZubJywgJ+S6lCcsICflha0nLCAn5LiDJywgJ+WFqycsICfkuZ0nXTsKCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIHRoZXJlIGFyZSBtdWx0aXBsZSBzYW1lLXR5cGUgcGllY2VzIGluIHRoZSBzYW1lIGNvbHVtbgogICAgICAgIGNvbnN0IGhhc1NhbWVUeXBlSW5Db2x1bW4gPSAoYm9hcmQsIHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgZXhjbHVkZVJvdykgPT4gewogICAgICAgICAgICBsZXQgY291bnQgPSAwOwogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY29sXTsKICAgICAgICAgICAgICAgIGlmIChyID09PSBleGNsdWRlUm93KSBjb250aW51ZTsKICAgICAgICAgICAgICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSBwaWVjZVR5cGUgJiYgcGllY2UuY29sb3IgPT09IGNvbG9yKSB7CiAgICAgICAgICAgICAgICAgICAgY291bnQrKzsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICByZXR1cm4gY291bnQgPiAwOwogICAgICAgIH07CgogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBkZXRlcm1pbmUgZnJvbnQvYmFjayBtYXJrZXIKICAgICAgICBjb25zdCBnZXRGcm9udEJhY2tNYXJrZXIgPSAoYm9hcmQsIHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgY3VycmVudFJvdykgPT4gewogICAgICAgICAgICBjb25zdCBzYW1lVHlwZVBpZWNlcyA9IFtdOwogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY29sXTsKICAgICAgICAgICAgICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSBwaWVjZVR5cGUgJiYgcGllY2UuY29sb3IgPT09IGNvbG9yKSB7CiAgICAgICAgICAgICAgICAgICAgc2FtZVR5cGVQaWVjZXMucHVzaChyKTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAoc2FtZVR5cGVQaWVjZXMubGVuZ3RoIDw9IDEpIHJldHVybiAnJzsKICAgICAgICAgICAgaWYgKGNvbG9yID09PSAncmVkJykgewogICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yIcj03LTnvvInvvIxy5YC86LaK5aSn6LaK6Z2g6L+R5pWM5pa577yM5pivIuWJjSIKICAgICAgICAgICAgICAgIGNvbnN0IHNvcnRlZFJvd3MgPSBbLi4uc2FtZVR5cGVQaWVjZXNdLnNvcnQoKGEsIGIpID0+IGIgLSBhKTsgLy8gSGlnaGVyIHJvd3MgZmlyc3QgPSBjbG9zZXIgdG8gb3Bwb25lbnQKICAgICAgICAgICAgICAgIHJldHVybiBzb3J0ZWRSb3dzWzBdID09PSBjdXJyZW50Um93ID8gJ+WJjScgOiAn5ZCOJzsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8iHI9MC0y77yJ77yMcuWAvOi2iuWwj+i2iumdoOi/keaVjOaWue+8jOaYryLliY0iCiAgICAgICAgICAgICAgICBjb25zdCBzb3J0ZWRSb3dzID0gWy4uLnNhbWVUeXBlUGllY2VzXS5zb3J0KChhLCBiKSA9PiBhIC0gYik7IC8vIExvd2VyIHJvd3MgZmlyc3QgPSBjbG9zZXIgdG8gb3Bwb25lbnQKICAgICAgICAgICAgICAgIHJldHVybiBzb3J0ZWRSb3dzWzBdID09PSBjdXJyZW50Um93ID8gJ+WJjScgOiAn5ZCOJzsKICAgICAgICAgICAgfQogICAgICAgIH07CgogICAgICAgIC8vIFByb2Nlc3MgZWFjaCBtb3ZlCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtb3ZlSGlzdG9yeS5sZW5ndGg7IGkrKykgewogICAgICAgICAgICBjb25zdCBtb3ZlID0gbW92ZUhpc3RvcnlbaV07CiAgICAgICAgICAgIGNvbnN0IGJvYXJkQmVmb3JlID0gYm9hcmRIaXN0b3J5W2ldOwogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkQmVmb3JlW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107CiAgICAgICAgICAgIAogICAgICAgICAgICBpZiAoIXBpZWNlKSB7CiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBwaWVjZSBmb3VuZCBhdCBmcm9tIHBvc2l0aW9uOicsIG1vdmUuZnJvbSk7CiAgICAgICAgICAgICAgICBjb250aW51ZTsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2UudHlwZTsKICAgICAgICAgICAgY29uc3QgcGllY2VDaGFyID0gdHlwZVRvUGllY2VbcGllY2VUeXBlXVtwaWVjZS5jb2xvcl07CiAgICAgICAgICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUgYXJlIG11bHRpcGxlIHNhbWUtdHlwZSBwaWVjZXMgaW4gdGhlIHNhbWUgY29sdW1uCiAgICAgICAgICAgIGNvbnN0IGhhc0R1cGxpY2F0ZSA9IGhhc1NhbWVUeXBlSW5Db2x1bW4oYm9hcmRCZWZvcmUsIHBpZWNlVHlwZSwgcGllY2UuY29sb3IsIG1vdmUuZnJvbS5jLCBtb3ZlLmZyb20ucik7CiAgICAgICAgICAgIC8vIEdldCBmcm9udC9iYWNrIG1hcmtlciBpZiBuZWVkZWQKICAgICAgICAgICAgY29uc3QgcG9zaXRpb25NYXJrZXIgPSBoYXNEdXBsaWNhdGUgPyBnZXRGcm9udEJhY2tNYXJrZXIoYm9hcmRCZWZvcmUsIHBpZWNlVHlwZSwgcGllY2UuY29sb3IsIG1vdmUuZnJvbS5jLCBtb3ZlLmZyb20ucikgOiAnJzsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIERldGVybWluZSBub3RhdGlvbiBiYXNlZCBvbiBwaWVjZSB0eXBlIGFuZCBtb3ZlIGRpcmVjdGlvbgogICAgICAgICAgICBsZXQgbm90YXRpb25TdHI7CiAgICAgICAgICAgIAogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnaG9yc2UnIHx8IHBpZWNlVHlwZSA9PT0gJ2Fkdmlzb3InIHx8IHBpZWNlVHlwZSA9PT0gJ2VsZXBoYW50JykgewogICAgICAgICAgICAgICAgLy8gRGlhZ29uYWwgbW92aW5nIHBpZWNlcyAtIG9ubHkgdXNlIOi/my/pgIAsIHJlY29yZCB0YXJnZXQgY29sdW1uCiAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLnRvLmNdIHx8ICcnOwogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/ov5vvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6YCACiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gbW92ZS50by5yID4gbW92ZS5mcm9tLnIgPyAn6L+bJyA6ICfpgIAnOwogICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dG9Db2x9YDsKICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCECiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY10gfHwgJyc7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS50by5jXSB8fCAnJzsKICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIhyPTDvvInvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6L+b77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+mAgAogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IG1vdmUudG8uciA8IG1vdmUuZnJvbS5yID8gJ+i/mycgOiAn6YCAJzsKICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3RvQ29sfWA7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcgfHwgcGllY2VUeXBlID09PSAnY2hhcmlvdCcgfHwgcGllY2VUeXBlID09PSAnY2Fubm9uJyB8fCBwaWVjZVR5cGUgPT09ICdzb2xkaWVyJykgewogICAgICAgICAgICAgICAgLy8gU3RyYWlnaHQgbW92aW5nIHBpZWNlcyAtIOi/my/pgIAv5bmzCiAgICAgICAgICAgICAgICBpZiAobW92ZS5mcm9tLmMgPT09IG1vdmUudG8uYykgewogICAgICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIG1vdmUgLSDov5sv6YCACiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RlcHMgPSBNYXRoLmFicyhtb3ZlLnRvLnIgLSBtb3ZlLmZyb20ucik7CiAgICAgICAgICAgICAgICAgICAgLy8g6L+b5piv6Z2g6L+R5pWM5pa555qE5pa55ZCR77yM6YCA5piv6L+c56a75pWM5pa555qE5pa55ZCRCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+i/m++8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/pgIAKICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6L+b77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+mAgAogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IChpc1JlZCA/IG1vdmUudG8uciA+IG1vdmUuZnJvbS5yIDogbW92ZS50by5yIDwgbW92ZS5mcm9tLnIpID8gJ+i/mycgOiAn6YCAJzsKICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY107CiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBzdGVwcyBpcyBhIHZhbGlkIG51bWJlciBiZXR3ZWVuIDEtOQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWxpZFN0ZXBzID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oOSwgTWF0aC5yb3VuZChzdGVwcyB8fCAxKSkpOwogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke2RpZ2l0VG9DaGluZXNlW3ZhbGlkU3RlcHNdIHx8ICcnfWA7CiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCECiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdOwogICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgc3RlcHMgaXMgYSB2YWxpZCBudW1iZXIKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsaWRTdGVwcyA9IE1hdGgucm91bmQoc3RlcHMgfHwgMSk7CiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dmFsaWRTdGVwc31gOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBtb3ZlIC0g5bmzCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdIHx8ICcnOwogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLnRvLmNdIHx8ICcnOwogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH3lubMke3RvQ29sfWA7CiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCECiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdIHx8ICcnOwogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLnRvLmNdIHx8ICcnOwogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH3lubMke3RvQ29sfWA7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignVW5rbm93biBwaWVjZSB0eXBlOicsIHBpZWNlVHlwZSk7CiAgICAgICAgICAgICAgICBjb250aW51ZTsKICAgICAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICAgICAgbm90YXRpb24ucHVzaChub3RhdGlvblN0cik7CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBTd2l0Y2ggY29sb3IgZm9yIG5leHQgbW92ZQogICAgICAgICAgICBjdXJyZW50Q29sb3IgPSBjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgIH0KICAgICAgICAKICAgICAgICByZXR1cm4gbm90YXRpb247CiAgICB9CgogICAgLyoqCiAgICAgKiBDb252ZXJ0IHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24gdG8gY29vcmRpbmF0ZSBtb3ZlcwogICAgICogQHBhcmFtIG5vdGF0aW9uIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbgogICAgICogQHJldHVybnMgQXJyYXkgb2YgbW92ZXMgaW4gY29vcmRpbmF0ZSBmb3JtYXQKICAgICAqLwogICAgbm90YXRpb25Ub01vdmVzKG5vdGF0aW9uLCBpbml0aWFsQm9hcmQgPSBudWxsKSB7CiAgICAgICAgLy8g56Gu5L+dbm90YXRpb27mmK/mlbDnu4TkuJTkuI3kuLrnqboKICAgICAgICBpZiAoIW5vdGF0aW9uIHx8ICFBcnJheS5pc0FycmF5KG5vdGF0aW9uKSB8fCBub3RhdGlvbi5sZW5ndGggPT09IDApIHsKICAgICAgICAgICAgcmV0dXJuIFtdOwogICAgICAgIH0KICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOwogICAgICAgIGxldCBjdXJyZW50Q29sb3IgPSAncmVkJzsgLy8gUmVkIG1vdmVzIGZpcnN0CgogICAgICAgIC8vIFBpZWNlIGNoYXJhY3RlciB0byB0eXBlIG1hcHBpbmcKICAgICAgICBjb25zdCBwaWVjZU1hcCA9IHsKICAgICAgICAgICAgJ+Wwhic6ICdnZW5lcmFsJywgJ+W4hSc6ICdnZW5lcmFsJywKICAgICAgICAgICAgJ+Wjqyc6ICdhZHZpc29yJywgJ+S7lSc6ICdhZHZpc29yJywKICAgICAgICAgICAgJ+ixoSc6ICdlbGVwaGFudCcsICfnm7gnOiAnZWxlcGhhbnQnLAogICAgICAgICAgICAn6amsJzogJ2hvcnNlJywKICAgICAgICAgICAgJ+i9pic6ICdjaGFyaW90JywKICAgICAgICAgICAgJ+eCric6ICdjYW5ub24nLAogICAgICAgICAgICAn5Y2SJzogJ3NvbGRpZXInLCAn5YW1JzogJ3NvbGRpZXInCiAgICAgICAgfTsKCiAgICAgICAgLy8gQ29sdW1uIG1hcHBpbmcgKHRyYWRpdGlvbmFsIG5vdGF0aW9uIHVzZXMgMS05IGZyb20gcmlnaHQgdG8gbGVmdCkKICAgICAgICBjb25zdCBjb2xNYXAgPSB7CiAgICAgICAgICAgICfkuIAnOiA4LCAnMSc6IDgsCiAgICAgICAgICAgICfkuownOiA3LCAnMic6IDcsCiAgICAgICAgICAgICfkuIknOiA2LCAnMyc6IDYsCiAgICAgICAgICAgICflm5snOiA1LCAnNCc6IDUsCiAgICAgICAgICAgICfkupQnOiA0LCAnNSc6IDQsCiAgICAgICAgICAgICflha0nOiAzLCAnNic6IDMsCiAgICAgICAgICAgICfkuIMnOiAyLCAnNyc6IDIsCiAgICAgICAgICAgICflhasnOiAxLCAnOCc6IDEsCiAgICAgICAgICAgICfkuZ0nOiAwLCAnOSc6IDAKICAgICAgICB9OwoKICAgICAgICAvLyBDaGluZXNlIG51bWJlciB0byBkaWdpdCBtYXBwaW5nCiAgICAgICAgY29uc3QgY2hpbmVzZU51bWJlck1hcCA9IHsKICAgICAgICAgICAgJ+S4gCc6IDEsICcxJzogMSwKICAgICAgICAgICAgJ+S6jCc6IDIsICcyJzogMiwKICAgICAgICAgICAgJ+S4iSc6IDMsICczJzogMywKICAgICAgICAgICAgJ+Wbmyc6IDQsICc0JzogNCwKICAgICAgICAgICAgJ+S6lCc6IDUsICc1JzogNSwKICAgICAgICAgICAgJ+WFrSc6IDYsICc2JzogNiwKICAgICAgICAgICAgJ+S4gyc6IDcsICc3JzogNywKICAgICAgICAgICAgJ+WFqyc6IDgsICc4JzogOCwKICAgICAgICAgICAgJ+S5nSc6IDksICc5JzogOQogICAgICAgIH07CgogICAgICAgIC8vIEluaXRpYWwgcG9zaXRpb25zIG9mIHBpZWNlcyAocmVkIGFuZCBibGFjaykKICAgICAgICAvLyDkv67lpI3vvJrkuI7mlrDlnZDmoIfns7vnu5/kv53mjIHkuIDoh7TvvIznuqLmlrnlnKjlupXpg6jvvIhyPTAtMu+8ie+8jOm7keaWueWcqOmhtumDqO+8iHI9Ny0577yJCiAgICAgICAgY29uc3QgZGVmYXVsdEluaXRpYWxQb3NpdGlvbnMgPSB7CiAgICAgICAgICAgICdyZWQtZ2VuZXJhbCc6IHsgcjogMCwgYzogNCB9LAogICAgICAgICAgICAncmVkLWFkdmlzb3InOiBbeyByOiAwLCBjOiAzIH0sIHsgcjogMCwgYzogNSB9XSwKICAgICAgICAgICAgJ3JlZC1lbGVwaGFudCc6IFt7IHI6IDAsIGM6IDIgfSwgeyByOiAwLCBjOiA2IH1dLAogICAgICAgICAgICAncmVkLWhvcnNlJzogW3sgcjogMCwgYzogMSB9LCB7IHI6IDAsIGM6IDcgfV0sCiAgICAgICAgICAgICdyZWQtY2hhcmlvdCc6IFt7IHI6IDAsIGM6IDAgfSwgeyByOiAwLCBjOiA4IH1dLAogICAgICAgICAgICAncmVkLWNhbm5vbic6IFt7IHI6IDIsIGM6IDEgfSwgeyByOiAyLCBjOiA3IH1dLAogICAgICAgICAgICAncmVkLXNvbGRpZXInOiBbeyByOiAzLCBjOiAwIH0sIHsgcjogMywgYzogMiB9LCB7IHI6IDMsIGM6IDQgfSwgeyByOiAzLCBjOiA2IH0sIHsgcjogMywgYzogOCB9XSwKICAgICAgICAgICAgJ2JsYWNrLWdlbmVyYWwnOiB7IHI6IDksIGM6IDQgfSwKICAgICAgICAgICAgJ2JsYWNrLWFkdmlzb3InOiBbeyByOiA5LCBjOiAzIH0sIHsgcjogOSwgYzogNSB9XSwKICAgICAgICAgICAgJ2JsYWNrLWVsZXBoYW50JzogW3sgcjogOSwgYzogMiB9LCB7IHI6IDksIGM6IDYgfV0sCiAgICAgICAgICAgICdibGFjay1ob3JzZSc6IFt7IHI6IDksIGM6IDEgfSwgeyByOiA5LCBjOiA3IH1dLAogICAgICAgICAgICAnYmxhY2stY2hhcmlvdCc6IFt7IHI6IDksIGM6IDAgfSwgeyByOiA5LCBjOiA4IH1dLAogICAgICAgICAgICAnYmxhY2stY2Fubm9uJzogW3sgcjogNywgYzogMSB9LCB7IHI6IDcsIGM6IDcgfV0sCiAgICAgICAgICAgICdibGFjay1zb2xkaWVyJzogW3sgcjogNiwgYzogMCB9LCB7IHI6IDYsIGM6IDIgfSwgeyByOiA2LCBjOiA0IH0sIHsgcjogNiwgYzogNiB9LCB7IHI6IDYsIGM6IDggfV0KICAgICAgICB9OwoKICAgICAgICAvLyBUcmFjayBwaWVjZSBwb3NpdGlvbnMgYXMgbW92ZXMgYXJlIG1hZGUKICAgICAgICBsZXQgcGllY2VQb3NpdGlvbnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGRlZmF1bHRJbml0aWFsUG9zaXRpb25zKSk7CiAgICAgICAgCiAgICAgICAgLy8gSWYgaW5pdGlhbCBib2FyZCBpcyBwcm92aWRlZCwgaW5pdGlhbGl6ZSBwaWVjZSBwb3NpdGlvbnMgZnJvbSBpdAogICAgICAgIGlmIChpbml0aWFsQm9hcmQpIHsKICAgICAgICAgICAgLy8gUmVzZXQgcGllY2UgcG9zaXRpb25zIGJhc2VkIG9uIGluaXRpYWwgYm9hcmQKICAgICAgICAgICAgcGllY2VQb3NpdGlvbnMgPSB7CiAgICAgICAgICAgICAgICAncmVkLWdlbmVyYWwnOiB7IHI6IC0xLCBjOiAtMSB9LAogICAgICAgICAgICAgICAgJ3JlZC1hZHZpc29yJzogW10sCiAgICAgICAgICAgICAgICAncmVkLWVsZXBoYW50JzogW10sCiAgICAgICAgICAgICAgICAncmVkLWhvcnNlJzogW10sCiAgICAgICAgICAgICAgICAncmVkLWNoYXJpb3QnOiBbXSwKICAgICAgICAgICAgICAgICdyZWQtY2Fubm9uJzogW10sCiAgICAgICAgICAgICAgICAncmVkLXNvbGRpZXInOiBbXSwKICAgICAgICAgICAgICAgICdibGFjay1nZW5lcmFsJzogeyByOiAtMSwgYzogLTEgfSwKICAgICAgICAgICAgICAgICdibGFjay1hZHZpc29yJzogW10sCiAgICAgICAgICAgICAgICAnYmxhY2stZWxlcGhhbnQnOiBbXSwKICAgICAgICAgICAgICAgICdibGFjay1ob3JzZSc6IFtdLAogICAgICAgICAgICAgICAgJ2JsYWNrLWNoYXJpb3QnOiBbXSwKICAgICAgICAgICAgICAgICdibGFjay1jYW5ub24nOiBbXSwKICAgICAgICAgICAgICAgICdibGFjay1zb2xkaWVyJzogW10KICAgICAgICAgICAgfTsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIFBvcHVsYXRlIHBpZWNlIHBvc2l0aW9ucyBmcm9tIGluaXRpYWwgYm9hcmQKICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7CiAgICAgICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gaW5pdGlhbEJvYXJkW3JdW2NdOwogICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZSkgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtwaWVjZS5jb2xvcn0tJHtwaWVjZS50eXBlfWA7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2tleV0gPSB7IHIsIGMgfTsKICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2tleV0ucHVzaCh7IHIsIGMgfSk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CgogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBmaW5kIHBpZWNlIHBvc2l0aW9uCiAgICAgICAgY29uc3QgZmluZFBpZWNlUG9zaXRpb24gPSAocGllY2VUeXBlLCBjb2xvciwgY29sLCBkaXJlY3Rpb24sIGJvYXJkLCBmcm9udEJhY2tNYXJrZXIgPSBudWxsKSA9PiB7CiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbG9yfS0ke3BpZWNlVHlwZX1gOwogICAgICAgICAgICBjb25zdCBwb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1trZXldOwoKICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcG9zaXRpb25zIGV4aXN0IGFuZCBhcmUgdmFsaWQKICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnMpIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIHBvc2l0aW9ucyBmb3VuZCBmb3IgcGllY2U6Jywga2V5KTsKICAgICAgICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgICAgICB9CgogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcpIHsKICAgICAgICAgICAgICAgIHJldHVybiBwb3NpdGlvbnM7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIC8vIEZpbmQgcGllY2VzIG9uIHRoZSBzcGVjaWZpZWQgY29sdW1uCiAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBwb3NpdGlvbnMuZmlsdGVyKHBvcyA9PiBwb3MuYyA9PT0gY29sKTsKCiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkgewogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gY2FuZGlkYXRlcyBmb3VuZCBmb3IgcGllY2U6Jywga2V5LCAnb24gY29sdW1uOicsIGNvbCk7CiAgICAgICAgICAgICAgICAvLyBBZGRpdGlvbmFsIGRlYnVnIGluZm8gZm9yIGNhbm5vbgogICAgICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2Nhbm5vbicgJiYgY29sb3IgPT09ICdibGFjaycpIHsKICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnREVCVUc6IENhbmRpZGF0ZXMgYWZ0ZXIgZmlsdGVyOicsIGNhbmRpZGF0ZXMpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMSkgewogICAgICAgICAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZXNbMF07CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIC8vIElmIGZyb250L2JhY2sgbWFya2VyIGlzIHByb3ZpZGVkLCB1c2UgaXQgdG8gZGV0ZXJtaW5lIHRoZSBwaWVjZQogICAgICAgICAgICBpZiAoZnJvbnRCYWNrTWFya2VyID09PSAn5YmNJykgewogICAgICAgICAgICAgICAgLy8g5YmN54Ku77ya6Z2g6L+R5pWM5pa555qE5qOL5a2QCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJpy5YC86L6D5aSn55qE5pu06Z2g6L+R5pWM5pa577yI5YmN77yJCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJpy5YC86L6D5bCP55qE5pu06Z2g6L+R5pWM5pa577yI5YmN77yJCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6CiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsKICAgICAgICAgICAgfSBlbHNlIGlmIChmcm9udEJhY2tNYXJrZXIgPT09ICflkI4nKSB7CiAgICAgICAgICAgICAgICAvLyDlkI7ngq7vvJrpnaDov5Hlt7HmlrnnmoTmo4vlrZAKICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8mnLlgLzovoPlsI/nmoTmm7TpnaDov5Hlt7HmlrnvvIjlkI7vvIkKICAgICAgICAgICAgICAgIC8vIOm7keaWue+8mnLlgLzovoPlpKfnmoTmm7TpnaDov5Hlt7HmlrnvvIjlkI7vvIkKICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyAKICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoKICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOwogICAgICAgICAgICB9CgogICAgICAgICAgICAvLyBJZiBtdWx0aXBsZSBwaWVjZXMgb24gdGhlIHNhbWUgY29sdW1uIGFuZCBubyBtYXJrZXIsIGRldGVybWluZSBiYXNlZCBvbiBkaXJlY3Rpb24KICAgICAgICAgICAgLy8g5a+55LqO5ZCM5LiA5YiX55qE5qOL5a2Q77yM6YCa6L+H5q+U6L6DcuWAvOadpeWMuuWIhgogICAgICAgICAgICBpZiAoZGlyZWN0aW9uID09PSAn6L+bJykgewogICAgICAgICAgICAgICAgLy8g6L+b5piv5ZCR5pWM5pa55pa55ZCR56e75Yqo77yM5omA5Lul6YCJ5oup5pu06Z2g6L+R5bex5pa555qE5qOL5a2Q77yI5ZCO77yJCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6CiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsKICAgICAgICAgICAgfSBlbHNlIGlmIChkaXJlY3Rpb24gPT09ICfpgIAnKSB7CiAgICAgICAgICAgICAgICAvLyDpgIDmmK/lkJHlt7HmlrnmlrnlkJHnp7vliqjvvIzmiYDku6XpgInmi6nmm7TpnaDov5HmlYzmlrnnmoTmo4vlrZDvvIjliY3vvIkKICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyAKICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoKICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOwogICAgICAgICAgICB9CgogICAgICAgICAgICByZXR1cm4gY2FuZGlkYXRlc1swXTsgLy8gRGVmYXVsdCB0byBmaXJzdCBpZiBkaXJlY3Rpb24gaXMgJ+W5sycgYW5kIG5vIG1hcmtlcgogICAgICAgIH07CgogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byB1cGRhdGUgcGllY2UgcG9zaXRpb24KICAgICAgICBjb25zdCB1cGRhdGVQaWVjZVBvc2l0aW9uID0gKHBpZWNlVHlwZSwgY29sb3IsIG9sZFBvcywgbmV3UG9zKSA9PiB7CiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbG9yfS0ke3BpZWNlVHlwZX1gOwogICAgICAgICAgICBjb25zdCBwb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1trZXldOwoKICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcG9zaXRpb25zIGV4aXN0IGFuZCBhcmUgdmFsaWQKICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnMpIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogTm8gcG9zaXRpb25zIGZvdW5kIGZvciBwaWVjZTonLCBrZXkpOwogICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICB9CgogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcpIHsKICAgICAgICAgICAgICAgIHBvc2l0aW9ucy5yID0gbmV3UG9zLnI7CiAgICAgICAgICAgICAgICBwb3NpdGlvbnMuYyA9IG5ld1Bvcy5jOwogICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICB9CgogICAgICAgICAgICBjb25zdCBpbmRleCA9IHBvc2l0aW9ucy5maW5kSW5kZXgocG9zID0+IHBvcy5yID09PSBvbGRQb3MuciAmJiBwb3MuYyA9PT0gb2xkUG9zLmMpOwogICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKSB7CiAgICAgICAgICAgICAgICBwb3NpdGlvbnNbaW5kZXhdLnIgPSBuZXdQb3MucjsKICAgICAgICAgICAgICAgIHBvc2l0aW9uc1tpbmRleF0uYyA9IG5ld1Bvcy5jOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBDb3VsZCBub3QgZmluZCBwaWVjZSBwb3NpdGlvbiB0byB1cGRhdGU6Jywgb2xkUG9zLCAnaW4nLCBwb3NpdGlvbnMpOwogICAgICAgICAgICB9CiAgICAgICAgfTsKCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIHBvc2l0aW9uIGlzIHZhbGlkCiAgICAgICAgY29uc3QgaXNWYWxpZFBvcyA9IChyLCBjKSA9PiByID49IDAgJiYgciA8IDEwICYmIGMgPj0gMCAmJiBjIDwgOTsKCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBob3JzZSBtb3ZlcwogICAgICAgIGNvbnN0IGdldEhvcnNlTW92ZXMgPSAocG9zLCBjb2xvcikgPT4gewogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOwogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOwogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsKICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsKICAgICAgICAgICAgICAgIHsgZHI6IC0yLCBkYzogLTEgfSwgeyBkcjogLTIsIGRjOiAxIH0sCiAgICAgICAgICAgICAgICB7IGRyOiAtMSwgZGM6IC0yIH0sIHsgZHI6IC0xLCBkYzogMiB9LAogICAgICAgICAgICAgICAgeyBkcjogMSwgZGM6IC0yIH0sIHsgZHI6IDEsIGRjOiAyIH0sCiAgICAgICAgICAgICAgICB7IGRyOiAyLCBkYzogLTEgfSwgeyBkcjogMiwgZGM6IDEgfQogICAgICAgICAgICBdOwoKICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGhvcnNlIGNhbiBtb3ZlIGluIHRoZSBkaXJlY3Rpb24KICAgICAgICAgICAgY29uc3QgY2FuTW92ZSA9IChkciwgZGMsIGJsb2NrZWRSLCBibG9ja2VkQykgPT4gewogICAgICAgICAgICAgICAgaWYgKCFpc1ZhbGlkUG9zKHIgKyBibG9ja2VkUiwgYyArIGJsb2NrZWRDKSkgcmV0dXJuIGZhbHNlOwogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7CiAgICAgICAgICAgIH07CgogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0sIGluZGV4KSA9PiB7CiAgICAgICAgICAgICAgICBjb25zdCBibG9ja2VkUiA9IGRyID4gMCA/IDEgOiBkciA8IDAgPyAtMSA6IDA7CiAgICAgICAgICAgICAgICBjb25zdCBibG9ja2VkQyA9IGRjID4gMCA/IDEgOiBkYyA8IDAgPyAtMSA6IDA7CiAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBwYXRoIGlzIGJsb2NrZWQKICAgICAgICAgICAgICAgIGlmICgoaW5kZXggPCAyIHx8IGluZGV4ID49IDYpICYmIGJsb2NrZWRSICE9PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgLy8gVmVydGljYWwgYmxvY2tlZAogICAgICAgICAgICAgICAgICAgIGlmICghY2FuTW92ZShkciwgZGMsIGJsb2NrZWRSLCAwKSkgcmV0dXJuOwogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChibG9ja2VkQyAhPT0gMCkgewogICAgICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgYmxvY2tlZAogICAgICAgICAgICAgICAgICAgIGlmICghY2FuTW92ZShkciwgZGMsIDAsIGJsb2NrZWRDKSkgcmV0dXJuOwogICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7CiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOwogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobmV3UiwgbmV3QykpIHsKICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfSk7CgogICAgICAgICAgICByZXR1cm4gbW92ZXM7CiAgICAgICAgfTsKCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBlbGVwaGFudCBtb3ZlcwogICAgICAgIGNvbnN0IGdldEVsZXBoYW50TW92ZXMgPSAocG9zLCBjb2xvcikgPT4gewogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOwogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOwogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsKICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsKICAgICAgICAgICAgICAgIHsgZHI6IC0yLCBkYzogLTIgfSwgeyBkcjogLTIsIGRjOiAyIH0sCiAgICAgICAgICAgICAgICB7IGRyOiAyLCBkYzogLTIgfSwgeyBkcjogMiwgZGM6IDIgfQogICAgICAgICAgICBdOwoKICAgICAgICAgICAgLy8gRWxlcGhhbnQncyB0ZXJyaXRvcnkgLSByZWQgZWxlcGhhbnRzIGNhbiBvbmx5IGJlIGluIHI8PTQsIGJsYWNrIGVsZXBoYW50cyBpbiByPj01CiAgICAgICAgICAgIGNvbnN0IGlzSW5UZXJyaXRvcnkgPSAocikgPT4gewogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IHIgPD0gNCA6IHIgPj0gNTsKICAgICAgICAgICAgfTsKCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSkgPT4gewogICAgICAgICAgICAgICAgY29uc3QgbWlkUiA9IHIgKyBkciAvIDI7CiAgICAgICAgICAgICAgICBjb25zdCBtaWRDID0gYyArIGRjIC8gMjsKICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7CiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOwoKICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIG1pZCBwb3NpdGlvbiBpcyBlbXB0eSBhbmQgbmV3IHBvc2l0aW9uIGlzIHZhbGlkCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhtaWRSLCBtaWRDKSAmJiBpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpICYmIGlzSW5UZXJyaXRvcnkobmV3UikpIHsKICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfSk7CgogICAgICAgICAgICByZXR1cm4gbW92ZXM7CiAgICAgICAgfTsKCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBhZHZpc29yIG1vdmVzCiAgICAgICAgY29uc3QgZ2V0QWR2aXNvck1vdmVzID0gKHBvcywgY29sb3IpID0+IHsKICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsKICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsKICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7CiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbCiAgICAgICAgICAgICAgICB7IGRyOiAtMSwgZGM6IC0xIH0sIHsgZHI6IC0xLCBkYzogMSB9LAogICAgICAgICAgICAgICAgeyBkcjogMSwgZGM6IC0xIH0sIHsgZHI6IDEsIGRjOiAxIH0KICAgICAgICAgICAgXTsKCiAgICAgICAgICAgIC8vIEFkdmlzb3IncyB0ZXJyaXRvcnkgKHBhbGFjZSkgLSByZWQgYWR2aXNvcnMgaW4gcj0wLTIsYz0zLTUsIGJsYWNrIGFkdmlzb3JzIGluIHI9Ny05LGM9My01CiAgICAgICAgICAgIGNvbnN0IGlzSW5QYWxhY2UgPSAociwgYykgPT4gewogICAgICAgICAgICAgICAgY29uc3QgclJhbmdlID0gY29sb3IgPT09ICdyZWQnID8gWzAsIDJdIDogWzcsIDldOwogICAgICAgICAgICAgICAgcmV0dXJuIHIgPj0gclJhbmdlWzBdICYmIHIgPD0gclJhbmdlWzFdICYmIGMgPj0gMyAmJiBjIDw9IDU7CiAgICAgICAgICAgIH07CgogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0pID0+IHsKICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7CiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOwogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobmV3UiwgbmV3QykgJiYgaXNJblBhbGFjZShuZXdSLCBuZXdDKSkgewogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9KTsKCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsKICAgICAgICB9OwoKICAgICAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgYm9hcmQgdG8gdHJhY2sgbW92ZXMKICAgICAgICBsZXQgdGVtcEJvYXJkID0gdGhpcy5jcmVhdGVJbml0aWFsQm9hcmQoKTsKICAgICAgICAKICAgICAgICAvLyBFbnN1cmUgdGVtcEJvYXJkIGlzIHByb3Blcmx5IGluaXRpYWxpemVkCiAgICAgICAgaWYgKCF0ZW1wQm9hcmQgfHwgdGVtcEJvYXJkLmxlbmd0aCAhPT0gMTApIHsKICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBib2FyZCBpbml0aWFsaXphdGlvbicpOwogICAgICAgICAgICByZXR1cm4gW107CiAgICAgICAgfQogICAgICAgIAogICAgICAgIC8vIFZlcmlmeSBhbGwgcm93cyBoYXZlIDkgY29sdW1ucwogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTA7IGkrKykgewogICAgICAgICAgICBpZiAoIXRlbXBCb2FyZFtpXSB8fCB0ZW1wQm9hcmRbaV0ubGVuZ3RoICE9PSA5KSB7CiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbaV0gPSBBcnJheSg5KS5maWxsKG51bGwpOwogICAgICAgICAgICB9CiAgICAgICAgfQoKICAgICAgICBjb25zb2xlLmxvZygnVG90YWwgbW92ZXM6Jywgbm90YXRpb24ubGVuZ3RoKTsKICAgICAgICBub3RhdGlvbi5mb3JFYWNoKG1vdmVOb3RhdGlvbiA9PiB7CgoKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIFBhcnNlIHRoZSBtb3ZlIG5vdGF0aW9uIC0ga2VlcCBsYXN0IGdyb3VwIG9wdGlvbmFsCiAgICAgICAgICAgIGNvbnN0IHJlZ2V4ID0gLyhb5YmN5ZCOXSk/KFvlsIbluIXlo6vku5XosaHnm7jpqazovabngq7lhbXljZJdKShb5LiA5LqM5LiJ5Zub5LqU5YWt5LiD5YWr5LmdMTIzNDU2Nzg5XSkoW+i/m+mAgOW5s10pKFvkuIDkuozkuInlm5vkupTlha3kuIPlhavkuZ0xMjM0NTY3ODldKT8vOwogICAgICAgICAgICBjb25zdCBtYXRjaCA9IG1vdmVOb3RhdGlvbi5tYXRjaChyZWdleCk7CgogICAgICAgICAgICBpZiAoIW1hdGNoKSB7CiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIG1vdmUgbm90YXRpb246JywgbW92ZU5vdGF0aW9uKTsKICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgY29uc3QgWywgZnJvbnRCYWNrTWFya2VyLCBwaWVjZUNoYXIsIGZyb21Db2xOb3RhdGlvbiwgZGlyZWN0aW9uLCB0b0NvbE9yU3RlcE5vdGF0aW9uXSA9IG1hdGNoOwogICAgICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZU1hcFtwaWVjZUNoYXJdOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8gR2V0IGNvbHVtbiBtYXBwaW5nIGJhc2VkIG9uIGN1cnJlbnQgY29sb3IgKGJsYWNrIHNlZXMgY29sdW1ucyBtaXJyb3JlZCkKICAgICAgICAgICAgbGV0IGZyb21Db2wgPSBjb2xNYXBbZnJvbUNvbE5vdGF0aW9uXTsKICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgewogICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrIChmcm9tIGJsYWNrJ3MgcGVyc3BlY3RpdmUpCiAgICAgICAgICAgICAgICBmcm9tQ29sID0gOCAtIGZyb21Db2w7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIC8vIEZpbmQgdGhlIGN1cnJlbnQgcG9zaXRpb24gb2YgdGhlIHBpZWNlCiAgICAgICAgICAgIGNvbnN0IGZyb21Qb3MgPSBmaW5kUGllY2VQb3NpdGlvbihwaWVjZVR5cGUsIGN1cnJlbnRDb2xvciwgZnJvbUNvbCwgZGlyZWN0aW9uLCB0ZW1wQm9hcmQsIGZyb250QmFja01hcmtlcik7CgogICAgICAgICAgICBpZiAoIWZyb21Qb3MpIHsKICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBmaW5kIHBpZWNlIHBvc2l0aW9uIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIGxldCB0b1BvczsKCiAgICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT09ICflubMnKSB7CiAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIG1vdmVtZW50CiAgICAgICAgICAgICAgICBsZXQgdG9Db2wgPSBjb2xNYXBbdG9Db2xPclN0ZXBOb3RhdGlvbl07CiAgICAgICAgICAgICAgICBpZiAodG9Db2wgPT09IHVuZGVmaW5lZCkgewogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbjonLCB0b0NvbE9yU3RlcE5vdGF0aW9uLCAnZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsKICAgICAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjayB3aGVuIG1vdmluZyBob3Jpem9udGFsbHkKICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsKICAgICAgICAgICAgICAgICAgICB0b0NvbCA9IDggLSB0b0NvbDsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgdG9Qb3MgPSB7IHI6IGZyb21Qb3MuciwgYzogdG9Db2wgfTsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIG9yIGRpYWdvbmFsIG1vdmVtZW50CiAgICAgICAgICAgICAgICBjb25zdCBzdGVwcyA9IGNoaW5lc2VOdW1iZXJNYXBbdG9Db2xPclN0ZXBOb3RhdGlvbl07CiAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgaWYgKHN0ZXBzID09PSB1bmRlZmluZWQpIHsKICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHN0ZXAgY291bnQ6JywgdG9Db2xPclN0ZXBOb3RhdGlvbiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdob3JzZScpIHsKICAgICAgICAgICAgICAgICAgICAvLyBIb3JzZSBtb3ZlcyBpbiBMLXNoYXBlCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEhvcnNlTW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsKICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247CiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07CiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgaG9yc2U6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgewogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbgogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gewogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykKICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOgogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOwogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOwogICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdlbGVwaGFudCcpIHsKICAgICAgICAgICAgICAgICAgICAvLyBFbGVwaGFudCBtb3ZlcyBkaWFnb25hbGx5IDIgc3RlcHMKICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0RWxlcGhhbnRNb3Zlcyhmcm9tUG9zLCBjdXJyZW50Q29sb3IpOwogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbgogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvbE5vdGF0aW9uID0gdG9Db2xPclN0ZXBOb3RhdGlvbjsKICAgICAgICAgICAgICAgICAgICBsZXQgdGFyZ2V0Q29sID0gY29sTWFwW3RhcmdldENvbE5vdGF0aW9uXTsKICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uIGZvciBlbGVwaGFudDonLCB0YXJnZXRDb2xOb3RhdGlvbiwgJ2luIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sKICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldENvbCA9IDggLSB0YXJnZXRDb2w7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIG1vdmUgdGhhdCBtYXRjaGVzIGJvdGggZGlyZWN0aW9uIGFuZCB0YXJnZXQgY29sdW1uCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7CiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQogICAgICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyAKICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yID4gZnJvbVBvcy5yIDogbW92ZS5yIDwgZnJvbVBvcy5yKSA6CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7CiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbgogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2x1bW5NYXRjaCA9IG1vdmUuYyA9PT0gdGFyZ2V0Q29sOwogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7CiAgICAgICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2Fkdmlzb3InKSB7CiAgICAgICAgICAgICAgICAgICAgLy8gQWR2aXNvciBtb3ZlcyBkaWFnb25hbGx5IDEgc3RlcAogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRBZHZpc29yTW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsKICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247CiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07CiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgYWR2aXNvcjonLCB0YXJnZXRDb2xOb3RhdGlvbiwgJ2luIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sKICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldENvbCA9IDggLSB0YXJnZXRDb2w7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIG1vdmUgdGhhdCBtYXRjaGVzIGJvdGggZGlyZWN0aW9uIGFuZCB0YXJnZXQgY29sdW1uCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7CiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQogICAgICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyAKICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yID4gZnJvbVBvcy5yIDogbW92ZS5yIDwgZnJvbVBvcy5yKSA6CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7CiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbgogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2x1bW5NYXRjaCA9IG1vdmUuYyA9PT0gdGFyZ2V0Q29sOwogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7CiAgICAgICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgIC8vIFN0cmFpZ2h0IGxpbmUgbW92ZW1lbnQgKGNoYXJpb3QsIGNhbm5vbiwgc29sZGllcikKICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RlcCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyAoY3VycmVudENvbG9yID09PSAncmVkJyA/IDEgOiAtMSkgKiBzdGVwcyA6CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gLTEgOiAxKSAqIHN0ZXBzOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSBmcm9tUG9zLnIgKyBzdGVwOwogICAgICAgICAgICAgICAgICAgIGlmIChuZXdSIDwgMCB8fCBuZXdSID49IDEwKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgcm93IHBvc2l0aW9uIGFmdGVyIG1vdmU6JywgbmV3UiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSB7IHI6IG5ld1IsIGM6IGZyb21Qb3MuYyB9OwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CgogICAgICAgICAgICBpZiAoIXRvUG9zKSB7CiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZGV0ZXJtaW5lIHRhcmdldCBwb3NpdGlvbiBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOwogICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICB9CgogICAgICAgICAgICAvLyBBZGQgdGhlIG1vdmUgdG8gdGhlIGxpc3QKICAgICAgICAgICAgbW92ZXMucHVzaCh7IGZyb206IHsgcjogZnJvbVBvcy5yLCBjOiBmcm9tUG9zLmMgfSwgdG86IHsgcjogdG9Qb3MuciwgYzogdG9Qb3MuYyB9IH0pOwoKICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUncyBhIGNhcHR1cmVkIHBpZWNlCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkUGllY2UgPSB0ZW1wQm9hcmRbdG9Qb3Mucl1bdG9Qb3MuY107CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBJZiB0aGVyZSdzIGEgY2FwdHVyZWQgcGllY2UsIHJlbW92ZSBpdCBmcm9tIHBpZWNlUG9zaXRpb25zCiAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlKSB7CiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGAke2NhcHR1cmVkUGllY2UuY29sb3J9LSR7Y2FwdHVyZWRQaWVjZS50eXBlfWA7CiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZFBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XTsKICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgaWYgKGNhcHR1cmVkUG9zaXRpb25zKSB7CiAgICAgICAgICAgICAgICAgICAgLy8g5bCGL+W4heS4jeS8muiiq+WQg+aOie+8jOaJgOS7peWPquWkhOeQhuWFtuS7luaji+WtkAogICAgICAgICAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlLnR5cGUgIT09ICdnZW5lcmFsJykgewogICAgICAgICAgICAgICAgICAgICAgICAvLyBSZW1vdmUgdGhlIGNhcHR1cmVkIHBvc2l0aW9uIGZyb20gdGhlIGFycmF5CiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNhcHR1cmVkUG9zaXRpb25zKSkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlZFBvc2l0aW9ucyA9IGNhcHR1cmVkUG9zaXRpb25zLmZpbHRlcihwb3MgPT4gCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zICYmIChwb3MuciAhPT0gdG9Qb3MuciB8fCBwb3MuYyAhPT0gdG9Qb3MuYykKICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV0gPSB1cGRhdGVkUG9zaXRpb25zOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBWZXJpZnkgcmVtb3ZhbCB3YXMgc3VjY2Vzc2Z1bAogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RpbGxFeGlzdHMgPSB1cGRhdGVkUG9zaXRpb25zLnNvbWUocG9zID0+IAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiBwb3MuciA9PT0gdG9Qb3MuciAmJiBwb3MuYyA9PT0gdG9Qb3MuYwogICAgICAgICAgICAgICAgICAgICAgICAgICAgKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzdGlsbEV4aXN0cykgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogQ2FwdHVyZWQgcGllY2Ugc3RpbGwgZXhpc3RzIGluIHBpZWNlUG9zaXRpb25zIScpOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygn4pyFIFNVQ0NFU1M6IENhcHR1cmVkIHBpZWNlIHJlbW92ZWQgZnJvbSBwaWVjZVBvc2l0aW9ucycpOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBVbmV4cGVjdGVkIG5vbi1hcnJheSBwb3NpdGlvbnMgZm9yIHBpZWNlOicsIGNhcHR1cmVkS2V5KTsKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBObyBwb3NpdGlvbnMgZm91bmQgZm9yIGNhcHR1cmVkIHBpZWNlOicsIGNhcHR1cmVkS2V5KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICAgICAgLy8gVmVyaWZ5IHRoZSBjYXB0dXJlZCBwaWVjZSBoYXMgYmVlbiByZW1vdmVkCiAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlKSB7CiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGAke2NhcHR1cmVkUGllY2UuY29sb3J9LSR7Y2FwdHVyZWRQaWVjZS50eXBlfWA7CiAgICAgICAgICAgICAgICBjb25zdCBmaW5hbFBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XTsKICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpbmFsUG9zaXRpb25zKSkgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0aWxsRXhpc3RzID0gZmluYWxQb3NpdGlvbnMuc29tZShwb3MgPT4gCiAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiBwb3MuciA9PT0gdG9Qb3MuciAmJiBwb3MuYyA9PT0gdG9Qb3MuYwogICAgICAgICAgICAgICAgICAgICk7CiAgICAgICAgICAgICAgICAgICAgaWYgKHN0aWxsRXhpc3RzKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0VSUk9SOiBDYXB0dXJlZCBwaWVjZSBzdGlsbCBleGlzdHMgaW4gcGllY2VQb3NpdGlvbnM6JywgY2FwdHVyZWRQaWVjZSwgJ2F0JywgdG9Qb3MpOwogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTVUNDRVNTOiBDYXB0dXJlZCBwaWVjZSByZW1vdmVkIGZyb20gcGllY2VQb3NpdGlvbnMnKTsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIE1ha2UgdGhlIG1vdmUgb24gdGhlIHRlbXBvcmFyeSBib2FyZCBmaXJzdCBiZWZvcmUgdXBkYXRpbmcgcGllY2UgcG9zaXRpb25zCiAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKGZyb21Qb3MuciwgZnJvbVBvcy5jKSAmJiBpc1ZhbGlkUG9zKHRvUG9zLnIsIHRvUG9zLmMpICYmIAogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2Zyb21Qb3Mucl0gJiYgdGVtcEJvYXJkW3RvUG9zLnJdKSB7CiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IHRlbXBCb2FyZFtmcm9tUG9zLnJdW2Zyb21Qb3MuY107CiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbdG9Qb3Mucl1bdG9Qb3MuY10gPSBwaWVjZTsKICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtmcm9tUG9zLnJdW2Zyb21Qb3MuY10gPSBudWxsOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBJbnZhbGlkIHBvc2l0aW9ucyBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24sIGZyb21Qb3MsIHRvUG9zKTsKICAgICAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBwaWVjZSBwb3NpdGlvbiBpbiBwaWVjZVBvc2l0aW9ucwogICAgICAgICAgICB1cGRhdGVQaWVjZVBvc2l0aW9uKHBpZWNlVHlwZSwgY3VycmVudENvbG9yLCBmcm9tUG9zLCB0b1Bvcyk7CiAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAvLyBTd2l0Y2ggY29sb3IgZm9yIG5leHQgbW92ZQogICAgICAgICAgICBjdXJyZW50Q29sb3IgPSBjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgIH0pOwoKICAgICAgICByZXR1cm4gbW92ZXM7CiAgICB9Cn0KCi8vIC0tLSBDb25zdGFudHMgLS0tCgovLyBJbml0aWFsaXplIE9wZW5pbmcgQm9vawpjb25zdCBvcGVuaW5nQm9vayA9IG5ldyBPcGVuaW5nQm9vaygxMik7Cgpjb25zdCBpc1ZhbGlkUG9zID0gKHIsIGMpID0+IHIgPj0gMCAmJiByIDwgUk9XUyAmJiBjID49IDAgJiYgYyA8IENPTFM7CgovLyBhbGxpZXNPdXQ6IOWPr+mAie+8jOaUtumbhuWPr+S/neaKpOeahOW3seaWueiQveeCue+8iOS4jeWQq+WwhuW4he+8ie+8jOS+m+WFs+ezu+iuoeeul+WkjeeUqO+8jOmBv+WFjeS6jOasoeWwhOe6vwpjb25zdCBnZXRQaWVjZU1vdmVzID0gKGJvYXJkLCBwb3MsIHBpZWNlLCBhbGxpZXNPdXQgPSBudWxsKSA9PiB7CiAgY29uc3QgbW92ZXMgPSBbXTsKICBjb25zdCB7IHIsIGMgfSA9IHBvczsKICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsKCiAgY29uc3QgYWRkQWxseSA9ICh0ciwgdGMsIHRhcmdldCkgPT4gewogICAgaWYgKGFsbGllc091dCAmJiB0YXJnZXQgJiYgdGFyZ2V0LmNvbG9yID09PSBwaWVjZS5jb2xvciAmJiB0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7CiAgICAgIGFsbGllc091dC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOwogICAgfQogIH07CgogIGNvbnN0IGFkZElmVmFsaWQgPSAodHIsIHRjKSA9PiB7CiAgICBpZiAoaXNWYWxpZFBvcyh0ciwgdGMpKSB7CiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbdHJdW3RjXTsKICAgICAgICBpZiAoIXRhcmdldCB8fCB0YXJnZXQuY29sb3IgIT09IHBpZWNlLmNvbG9yKSB7CiAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgYWRkQWxseSh0ciwgdGMsIHRhcmdldCk7CiAgICAgICAgfQogICAgfQogIH07CgogIHN3aXRjaCAocGllY2UudHlwZSkgewogICAgY2FzZSAnZ2VuZXJhbCc6CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOwogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsKICAgICAgICBpZiAobmMgPj0gMyAmJiBuYyA8PSA1KSB7CiAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSBhZGRJZlZhbGlkKG5yLCBuYyk7CiAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSBhZGRJZlZhbGlkKG5yLCBuYyk7CiAgICAgICAgfQogICAgICB9CiAgICAgIGJyZWFrOwogICAgY2FzZSAnYWR2aXNvcic6CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgRElBR19ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgZHIgPSBESUFHX0RJUlNbaV1bMF0sIGRjID0gRElBR19ESVJTW2ldWzFdOwogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsKICAgICAgICBpZiAobmMgPj0gMyAmJiBuYyA8PSA1KSB7CiAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSBhZGRJZlZhbGlkKG5yLCBuYyk7CiAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSBhZGRJZlZhbGlkKG5yLCBuYyk7CiAgICAgICAgfQogICAgICB9CiAgICAgIGJyZWFrOwogICAgY2FzZSAnZWxlcGhhbnQnOgogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IEVMRVBIQU5UX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBkID0gRUxFUEhBTlRfRElSU1tpXTsKICAgICAgICBjb25zdCBuciA9IHIgKyBkLmRyLCBuYyA9IGMgKyBkLmRjOwogICAgICAgIGNvbnN0IGV5ZVIgPSByICsgZC5leWVEciwgZXllQyA9IGMgKyBkLmV5ZURjOwogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYgYm9hcmRbZXllUl1bZXllQ10gPT09IG51bGwpIHsKICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA8PSA0KSBhZGRJZlZhbGlkKG5yLCBuYyk7CiAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNSkgYWRkSWZWYWxpZChuciwgbmMpOwogICAgICAgIH0KICAgICAgfQogICAgICBicmVhazsKICAgIGNhc2UgJ2hvcnNlJzoKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBIT1JTRV9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgZCA9IEhPUlNFX0RJUlNbaV07CiAgICAgICAgY29uc3QgbGVnUiA9IHIgKyBkLmxlZ0RyLCBsZWdDID0gYyArIGQubGVnRGM7CiAgICAgICAgaWYgKGlzVmFsaWRQb3MobGVnUiwgbGVnQykgJiYgYm9hcmRbbGVnUl1bbGVnQ10gPT09IG51bGwpIHsKICAgICAgICAgIGFkZElmVmFsaWQociArIGQuZHIsIGMgKyBkLmRjKTsKICAgICAgICB9CiAgICAgIH0KICAgICAgYnJlYWs7CiAgICBjYXNlICdjaGFyaW90JzoKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07CiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsKICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7CiAgICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFtucl1bbmNdOwogICAgICAgICAgaWYgKHRhcmdldCA9PT0gbnVsbCkgewogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgaWYgKHRhcmdldC5jb2xvciAhPT0gcGllY2UuY29sb3IpIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7CiAgICAgICAgICAgIGVsc2UgYWRkQWxseShuciwgbmMsIHRhcmdldCk7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgfQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOwogICAgICAgIH0KICAgICAgfQogICAgICBicmVhazsKICAgIGNhc2UgJ2Nhbm5vbic6CiAgICAgIC8vIOedgOazleS7jeWPquWQq+aVjOaWuemalOaJk++8m+W3seaWuemalOaJk+S/neaKpOeUsSBmaWxsQ2Fubm9uUmVsYXRpb25zIOe7n+S4gOWkhOeQhgogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsKICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOwogICAgICAgIGxldCBzY3JlZW5Gb3VuZCA9IGZhbHNlOwogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsKICAgICAgICAgIGlmICghc2NyZWVuRm91bmQpIHsKICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIHsKICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgIHNjcmVlbkZvdW5kID0gdHJ1ZTsKICAgICAgICAgICAgfQogICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gIT09IG51bGwpIHsKICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXS5jb2xvciAhPT0gcGllY2UuY29sb3IpIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7CiAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIH0KICAgICAgICAgIH0KICAgICAgICAgIG5yICs9IGRyOyBuYyArPSBkYzsKICAgICAgICB9CiAgICAgIH0KICAgICAgYnJlYWs7CiAgICBjYXNlICdzb2xkaWVyJzogewogICAgICAvLyDnuqLmlrnlhbXliJ3lp4vkvY3nva7lnKhyPTPvvIzlkJHliY3otbDmmK9y5aKe5aSn77yI5ZCR5LiL77yJ77yb6buR5pa55YW15Yid5aeL5L2N572u5Zyocj0277yM5ZCR5YmN6LWw5pivcuWHj+Wwj++8iOWQkeS4iu+8iQogICAgICBjb25zdCBmb3J3YXJkID0gaXNSZWQgPyAxIDogLTE7CiAgICAgIC8vIOe6ouaWueWFtei/h+ays+adoeS7tuaYr3IgPj0gNe+8jOm7keaWueWFtei/h+ays+adoeS7tuaYr3IgPD0gNAogICAgICAvLyDmsrPnlYzkvY3kuo5yPTTlkoxyPTXkuYvpl7TvvIznuqLmlrnlhbXpnIDopoHotbDliLByPTXmiY3og73ov4fmsrPvvIzpu5HmlrnlhbXpnIDopoHotbDliLByPTTmiY3og73ov4fmsrMKICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gaXNSZWQgPyByID49IDUgOiByIDw9IDQ7CiAgICAgIGFkZElmVmFsaWQociArIGZvcndhcmQsIGMpOwogICAgICBpZiAoY3Jvc3NlZFJpdmVyKSB7CiAgICAgICAgYWRkSWZWYWxpZChyLCBjIC0gMSk7CiAgICAgICAgYWRkSWZWYWxpZChyLCBjICsgMSk7CiAgICAgIH0KICAgICAgYnJlYWs7CiAgICB9CiAgfQogIHJldHVybiBtb3ZlczsKfTsKCmNvbnN0IGlzRmx5aW5nR2VuZXJhbCA9IChib2FyZCkgPT4gewogIGNvbnN0IHJlZEcgPSBnZXRHZW5lcmFsUG9zKGJvYXJkLCAncmVkJyk7CiAgY29uc3QgYmxhY2tHID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgJ2JsYWNrJyk7CiAgaWYgKCFyZWRHIHx8ICFibGFja0cgfHwgcmVkRy5jICE9PSBibGFja0cuYykgcmV0dXJuIGZhbHNlOwogIAogIC8vIOehruS/neW+queOr+aWueWQkeato+ehru+8jOS7jui+g+Wwj+eahHLliLDovoPlpKfnmoRyCiAgY29uc3Qgc3RhcnRSID0gTWF0aC5taW4oYmxhY2tHLnIsIHJlZEcucikgKyAxOwogIGNvbnN0IGVuZFIgPSBNYXRoLm1heChibGFja0cuciwgcmVkRy5yKSAtIDE7CiAgCiAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsKICAgIGlmIChib2FyZFtyXVtyZWRHLmNdICE9PSBudWxsKSByZXR1cm4gZmFsc2U7CiAgfQogIHJldHVybiB0cnVlOwp9OwoKLy8g5pegIGJvYXJkSW5mbyDml7bnmoTlv6vpgJ/lsIblhpvmo4DmtYvvvJrlsIbkvY3nvJPlrZggKyDku47lsIbkvY3lm5vlkJHlsITnur/vvIjovaYv5bCGL+eCruWQiOW5tu+8iQpjb25zdCBpc0NoZWNrUmF3ID0gKGJvYXJkLCBjb2xvcikgPT4gewogICAgY29uc3QgZ2VuZXJhbFBvcyA9IGdldEdlbmVyYWxQb3MoYm9hcmQsIGNvbG9yKTsKICAgIGlmICghZ2VuZXJhbFBvcykgcmV0dXJuIHRydWU7CgogICAgY29uc3QgZW5lbXlDb2xvciA9IGNvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgIGNvbnN0IHsgcjogZ3IsIGM6IGdjIH0gPSBnZW5lcmFsUG9zOwoKICAgIC8vIOebtOe6v++8muesrOS4gOWtkOS4uuaVjOi9pi/lsIbliJnlsIblhpvvvJvotorov4fngq7mnrblkI7nrKzkuozlrZDkuLrmlYzngq7liJnlsIblhpsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOwogICAgICAgIGxldCBuciA9IGdyICsgZHI7CiAgICAgICAgbGV0IG5jID0gZ2MgKyBkYzsKICAgICAgICBsZXQgc2VlbiA9IDA7CgogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsKICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107CiAgICAgICAgICAgIGlmIChwKSB7CiAgICAgICAgICAgICAgICBzZWVuKys7CiAgICAgICAgICAgICAgICBpZiAoc2VlbiA9PT0gMSkgewogICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIChwLnR5cGUgPT09ICdjaGFyaW90JyB8fCBwLnR5cGUgPT09ICdnZW5lcmFsJykpIHsKICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdjYW5ub24nKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICBuciArPSBkcjsKICAgICAgICAgICAgbmMgKz0gZGM7CiAgICAgICAgfQogICAgfQoKICAgIC8vIOmprO+8muS7juWwhuS9jeWPjeaOqO+8jOmprOiFv+WcqOmprOS4gOS+p++8iOS4jiBnZXRQaWVjZU1vdmVzIC8gSE9SU0VfRElSUyDkuIDoh7TvvIkKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgSE9SU0VfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGQgPSBIT1JTRV9ESVJTW2ldOwogICAgICAgIGNvbnN0IG5yID0gZ3IgKyBkLmRyOwogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkLmRjOwogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsKICAgICAgICAgICAgY29uc3QgbGVnUiA9IG5yIC0gZC5sZWdEcjsKICAgICAgICAgICAgY29uc3QgbGVnQyA9IG5jIC0gZC5sZWdEYzsKICAgICAgICAgICAgaWYgKGJvYXJkW2xlZ1JdW2xlZ0NdID09PSBudWxsKSB7CiAgICAgICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsKICAgICAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnaG9yc2UnKSB7CiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CgogICAgLy8g5aOr77yI5Lmd5a6r5YaF77yJCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IERJQUdfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGRyID0gRElBR19ESVJTW2ldWzBdLCBkYyA9IERJQUdfRElSU1tpXVsxXTsKICAgICAgICBjb25zdCBuciA9IGdyICsgZHI7CiAgICAgICAgY29uc3QgbmMgPSBnYyArIGRjOwogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYKICAgICAgICAgICAgKChjb2xvciA9PT0gJ3JlZCcgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSB8fCAoY29sb3IgPT09ICdibGFjaycgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSkgJiYKICAgICAgICAgICAgbmMgPj0gMyAmJiBuYyA8PSA1KSB7CiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOwogICAgICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ2Fkdmlzb3InKSB7CiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KCiAgICAvLyDlhbXvvJrmraPliY3mlrnlp4vnu4jlj6/mlLvvvJvlt6blj7Pku4Xov4fmsrPlhbUKICAgIGNvbnN0IGVuZW15Rm9yd2FyZCA9IGVuZW15Q29sb3IgPT09ICdyZWQnID8gMSA6IC0xOwogICAgY29uc3QgZm9yd2FyZEZyb21SID0gZ3IgLSBlbmVteUZvcndhcmQ7CiAgICBpZiAoaXNWYWxpZFBvcyhmb3J3YXJkRnJvbVIsIGdjKSkgewogICAgICAgIGNvbnN0IHAgPSBib2FyZFtmb3J3YXJkRnJvbVJdW2djXTsKICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7CiAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgIH0KICAgIH0KICAgIGZvciAoY29uc3QgZGMgb2YgWzEsIC0xXSkgewogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkYzsKICAgICAgICBpZiAoaXNWYWxpZFBvcyhnciwgbmMpKSB7CiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtncl1bbmNdOwogICAgICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7CiAgICAgICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBlbmVteUNvbG9yID09PSAncmVkJyA/IGdyID49IDUgOiBnciA8PSA0OwogICAgICAgICAgICAgICAgaWYgKGNyb3NzZWRSaXZlcikgewogICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIHJldHVybiBmYWxzZTsKfTsKCmNvbnN0IGlzQ2hlY2sgPSAoYm9hcmQsIGNvbG9yLCBwaWVjZXNJbmZvID0gbnVsbCwgYm9hcmRJbmZvID0gbnVsbCkgPT4gewogICAgLy8g5LyY5YWI5L2/55So6aKE6K6h566X55qE5bCG5Yab54q25oCBCiAgICBpZiAoYm9hcmRJbmZvKSB7CiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRJc0luQ2hlY2sgOiBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2s7CiAgICB9CgogICAgLy8g5aaC5p6c5pyJcGllY2VzSW5mb++8jOS5n+WPr+S7peS7juS4reiOt+WPluWwhuWGm+eKtuaAgQogICAgaWYgKHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7CiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IHBpZWNlc0luZm9bMF0ucmVkSXNJbkNoZWNrIDogcGllY2VzSW5mb1swXS5ibGFja0lzSW5DaGVjazsKICAgIH0KCiAgICByZXR1cm4gaXNDaGVja1Jhdyhib2FyZCwgY29sb3IpOwp9OwoKLy8g5ZCI5rOV552A5rOV77ya5Lyq5ZCI5rOVICsg5LiN6YCB5bCGL+S4jemjnuWwhu+8iG1ha2UvdW5tYWtl77yJCmNvbnN0IGdldFZhbGlkTW92ZXMgPSAoYm9hcmQsIHBvcykgPT4gewogIGNvbnN0IHBpZWNlID0gYm9hcmRbcG9zLnJdW3Bvcy5jXTsKICBpZiAoIXBpZWNlKSByZXR1cm4gW107CiAgY29uc3QgcHNldWRvTW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCBwb3MsIHBpZWNlKTsKICByZXR1cm4gZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgcG9zLCBwaWVjZSwgcHNldWRvTW92ZXMpOwp9OwoKY29uc3QgaXNWYWxpZFBsYWNlbWVudCA9ICh0eXBlLCBjb2xvciwgciwgYykgPT4gewogICAgY29uc3QgaXNSZWQgPSBjb2xvciA9PT0gJ3JlZCc7CiAgICBzd2l0Y2godHlwZSkgewogICAgICAgIGNhc2UgJ2dlbmVyYWwnOgogICAgICAgICAgICAvLyDluIXlsIblj6rog73lnKjkuZ3lrqvkuK3lv4PnmoTkuIDmnaHnur/kuIoKICAgICAgICAgICAgaWYgKGMgPCAzIHx8IGMgPiA1KSByZXR1cm4gZmFsc2U7CiAgICAgICAgICAgIGlmIChpc1JlZCkgcmV0dXJuIHIgPj0gMCAmJiByIDw9IDI7CiAgICAgICAgICAgIGVsc2UgcmV0dXJuIHIgPj0gNyAmJiByIDw9IDk7CiAgICAgICAgY2FzZSAnYWR2aXNvcic6CiAgICAgICAgICAgIC8vIOWjq+WPquiDveWcqOS5neWuq+eahDXkuKrngrnkuYvkuIAKICAgICAgICAgICAgY29uc3QgdmFsaWRBZHZpc29yUG9zaXRpb25zID0gewogICAgICAgICAgICAgICAgcmVkOiBbWzAsIDNdLCBbMCwgNV0sIFsxLCA0XSwgWzIsIDNdLCBbMiwgNV1dLAogICAgICAgICAgICAgICAgYmxhY2s6IFtbNywgM10sIFs3LCA1XSwgWzgsIDRdLCBbOSwgM10sIFs5LCA1XV0KICAgICAgICAgICAgfTsKICAgICAgICAgICAgcmV0dXJuIHZhbGlkQWR2aXNvclBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ10uc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7CiAgICAgICAgY2FzZSAnZWxlcGhhbnQnOgogICAgICAgICAgICAvLyDnm7jlj6rog73lnKjlt7HmlrnljYrlnLrnmoQ35Liq54K55LmL5LiACiAgICAgICAgICAgIGNvbnN0IHZhbGlkRWxlcGhhbnRQb3NpdGlvbnMgPSB7CiAgICAgICAgICAgICAgICByZWQ6IFtbMCwgMl0sIFswLCA2XSwgWzIsIDBdLCBbMiwgNF0sIFsyLCA4XSwgWzQsIDJdLCBbNCwgNl1dLAogICAgICAgICAgICAgICAgYmxhY2s6IFtbNSwgMl0sIFs1LCA2XSwgWzcsIDBdLCBbNywgNF0sIFs3LCA4XSwgWzksIDJdLCBbOSwgNl1dCiAgICAgICAgICAgIH07CiAgICAgICAgICAgIHJldHVybiB2YWxpZEVsZXBoYW50UG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXS5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsKICAgICAgICBjYXNlICdzb2xkaWVyJzoKICAgICAgICAgICAgLy8g5YW155qE5L2N572u6ZmQ5Yi277ya6L+H5rKz5YmN5Y+q6IO95Zyo5YG25pWw5YiX77yM6L+H5rKz5ZCO5Y+v5Lul5Zyo5Lu75L2V5YiXCiAgICAgICAgICAgIC8vIOe6ouaWueWFtei/h+ays+adoeS7tuaYr3IgPj0gNe+8jOm7keaWueWFtei/h+ays+adoeS7tuaYr3IgPD0gNAogICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBpc1JlZCA/IHIgPj0gNSA6IHIgPD0gNDsKICAgICAgICAgICAgCiAgICAgICAgICAgIGlmICghY3Jvc3NlZFJpdmVyKSB7CiAgICAgICAgICAgICAgICAvLyDov4fmsrPliY3lj6rog73lnKjlgbbmlbDliJfvvIhjPTAsMiw0LDYsOO+8iQogICAgICAgICAgICAgICAgaWYgKCFbMCwgMiwgNCwgNiwgOF0uaW5jbHVkZXMoYykpIHJldHVybiBmYWxzZTsKICAgICAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICAgICAgLy8g5YW155qE5L2N572u6ZmQ5Yi277ya6L+H5rKz5YmN5Y+q6IO95Zyo5YW15L2N5ZKM5YW15L2N5YmN5pa577yM6L+H5rKz5ZCO5pWM5pa55Y2K5Zy66YO95ZCI5rOVCiAgICAgICAgICAgIGNvbnN0IHZhbGlkU29sZGllclBvc2l0aW9ucyA9IHsKICAgICAgICAgICAgICAgIHJlZDogewogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWueWIneWni+WFteS9je+8mnI9MywgYz0wLDIsNCw2LDgKICAgICAgICAgICAgICAgICAgICBpbml0aWFsOiBbWzMsIDBdLCBbMywgMl0sIFszLCA0XSwgWzMsIDZdLCBbMywgOF1dLAogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWueWFteS9jeWJjeaWue+8mnI9NCwgYz0wLDIsNCw2LDgKICAgICAgICAgICAgICAgICAgICBmb3J3YXJkOiBbWzQsIDBdLCBbNCwgMl0sIFs0LCA0XSwgWzQsIDZdLCBbNCwgOF1dLAogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/h+ays+e6v++8mnI+PTUKICAgICAgICAgICAgICAgICAgICBjcm9zc2VkUml2ZXI6IHIgPj0gNQogICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgIGJsYWNrOiB7CiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55Yid5aeL5YW15L2N77yacj02LCBjPTAsMiw0LDYsOAogICAgICAgICAgICAgICAgICAgIGluaXRpYWw6IFtbNiwgMF0sIFs2LCAyXSwgWzYsIDRdLCBbNiwgNl0sIFs2LCA4XV0sCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55YW15L2N5YmN5pa577yacj01LCBjPTAsMiw0LDYsOAogICAgICAgICAgICAgICAgICAgIGZvcndhcmQ6IFtbNSwgMF0sIFs1LCAyXSwgWzUsIDRdLCBbNSwgNl0sIFs1LCA4XV0sCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+H5rKz57q/77yacjw9NAogICAgICAgICAgICAgICAgICAgIGNyb3NzZWRSaXZlcjogciA8PSA0CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH07CiAgICAgICAgICAgIAogICAgICAgICAgICBjb25zdCBzb2xkaWVySW5mbyA9IHZhbGlkU29sZGllclBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ107CiAgICAgICAgICAgIGNvbnN0IGlzSW5pdGlhbFBvcyA9IHNvbGRpZXJJbmZvLmluaXRpYWwuc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7CiAgICAgICAgICAgIGNvbnN0IGlzRm9yd2FyZFBvcyA9IHNvbGRpZXJJbmZvLmZvcndhcmQuc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7CiAgICAgICAgICAgIAogICAgICAgICAgICBpZiAoc29sZGllckluZm8uY3Jvc3NlZFJpdmVyKSB7CiAgICAgICAgICAgICAgICAvLyDov4fmsrPlkI7mlYzmlrnljYrlnLrpg73lkIjms5UKICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgLy8g6L+H5rKz5YmN5Y+q6IO95Zyo5YW15L2N5ZKM5YW15L2N5YmN5pa5CiAgICAgICAgICAgICAgICByZXR1cm4gaXNJbml0aWFsUG9zIHx8IGlzRm9yd2FyZFBvczsKICAgICAgICAgICAgfQogICAgICAgIGRlZmF1bHQ6CiAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgfQp9OwoKY29uc3QgY2hlY2tHYW1lU3RhdGUgPSAoYm9hcmQsIHR1cm4sIHBpZWNlc0luZm8gPSBudWxsLCBib2FyZEluZm8gPSBudWxsKSA9PiB7CiAgICAvLyDkvJjlhYjkvb/nlKjpooTorqHnrpfnmoRnYW1lU3RhdGUKICAgIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLmdhbWVTdGF0ZSkgewogICAgICAgIHJldHVybiBib2FyZEluZm8uZ2FtZVN0YXRlOwogICAgfQogICAgCiAgICAvLyDmsqHmnInpooTorqHnrpfnu5Pmnpzml7bvvIzmiafooYzljp/lp4vorqHnrpcKICAgIGxldCBoYXNNb3ZlcyA9IGZhbHNlOwogICAgZm9yKGxldCByPTA7IHI8Uk9XUzsgcisrKSB7CiAgICAgICAgZm9yKGxldCBjPTA7IGM8Q09MUzsgYysrKSB7CiAgICAgICAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsKICAgICAgICAgICAgICAgIGlmIChnZXRWYWxpZE1vdmVzKGJvYXJkLCB7cixjfSkubGVuZ3RoID4gMCkgewogICAgICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsKICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICBpZiAoaGFzTW92ZXMpIGJyZWFrOwogICAgfQoKICAgIGlmIChoYXNNb3ZlcykgcmV0dXJuIHsgc3RhdHVzOiAncGxheWluZycgfTsKCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVjayhib2FyZCwgdHVybiwgcGllY2VzSW5mbywgYm9hcmRJbmZvKTsKICAgIGNvbnN0IG9wcG9uZW50ID0gdHVybiA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7CiAgICAKICAgIGlmIChpbkNoZWNrKSB7CiAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnY2hlY2ttYXRlJywgd2lubmVyOiBvcHBvbmVudCB9OwogICAgfSBlbHNlIHsKICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07CiAgICB9Cn07CgoKCi8vIOWinuW8uueahOa4uOaIj+mYtuauteivhuWIqwpjb25zdCBnZXRHYW1lUGhhc2UgPSAoYm9hcmQpID0+IHsKICAvKgogIGNvbnN0IHBpZWNlQ291bnQgPSBjb3VudFBpZWNlcyhib2FyZCk7CiAgCiAgaWYgKHBpZWNlQ291bnQgPD0gOCkgcmV0dXJuICdlbmRnYW1lJzsKICBpZiAocGllY2VDb3VudCA8PSAxNikgcmV0dXJuICdtaWRkbGVnYW1lJzsKICByZXR1cm4gJ29wZW5pbmcnOwogICovCiAgcmV0dXJuICdvcGVuaW5nJzsKfTsKCi8vIOiuoeeul+aji+WtkOaAu+aVsApjb25zdCBjb3VudFBpZWNlcyA9IChib2FyZCkgPT4gewogIGxldCBjb3VudCA9IDA7CiAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsKICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7CiAgICAgIGlmIChib2FyZFtyXVtjXSkgY291bnQrKzsKICAgIH0KICB9CiAgcmV0dXJuIGNvdW50Owp9OwoKLy8g5a6e5L6L5YyWWm9icmlzdEhhc2hlcgpjb25zdCB6b2JyaXN0SGFzaGVyID0gbmV3IFpvYnJpc3RIYXNoZXIoKTsKCi8vIOe9ruaNouihqOWunueOsO+8iOWuuemHj+e6piAyXjIw77yM6YG/5YWNIE1hcCDov4flpKfmi5bmhaIgR0PvvIkKY2xhc3MgVHJhbnNwb3NpdGlvblRhYmxlIHsKICAgIGNvbnN0cnVjdG9yKHNpemUgPSBNYXRoLnBvdygyLCAyMCkpIHsKICAgICAgICB0aGlzLnRhYmxlID0gbmV3IE1hcCgpOwogICAgICAgIHRoaXMuc2l6ZSA9IHNpemU7CiAgICAgICAgdGhpcy5oYXNoZXIgPSB6b2JyaXN0SGFzaGVyOwogICAgICAgIC8vIOe7n+iuoeS/oeaBrwogICAgICAgIHRoaXMuc3RhdHMgPSB7CiAgICAgICAgICAgIGhpdHM6IDAsCiAgICAgICAgICAgIG1pc3NlczogMCwKICAgICAgICAgICAgZXhhY3RIaXRzOiAwLAogICAgICAgICAgICBsb3dlcmJvdW5kSGl0czogMCwKICAgICAgICAgICAgdXBwZXJib3VuZEhpdHM6IDAsCiAgICAgICAgICAgIHN0b3JlczogMCwKICAgICAgICAgICAgbHJ1RXZpY3Rpb25zOiAwLAogICAgICAgICAgICBjbGVhcnM6IDAKICAgICAgICB9OwogICAgfQogICAgCiAgICBzdG9yZShrZXksIGRlcHRoLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUgPSBudWxsLCBtb3ZlU2VxdWVuY2UgPSBudWxsKSB7CiAgICAgICAgaWYgKHRoaXMudGFibGUuc2l6ZSA+PSB0aGlzLnNpemUpIHsKICAgICAgICAgICAgLy8g566A5Y2V55qETFJV562W55Wl77ya56e76Zmk56ys5LiA5Liq5YWD57SgCiAgICAgICAgICAgIGNvbnN0IGZpcnN0S2V5ID0gdGhpcy50YWJsZS5rZXlzKCkubmV4dCgpLnZhbHVlOwogICAgICAgICAgICB0aGlzLnRhYmxlLmRlbGV0ZShmaXJzdEtleSk7CiAgICAgICAgICAgIHRoaXMuc3RhdHMubHJ1RXZpY3Rpb25zKys7CiAgICAgICAgfQogICAgICAgIHRoaXMudGFibGUuc2V0KGtleSwgeyBkZXB0aCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlLCBtb3ZlU2VxdWVuY2UgfSk7CiAgICAgICAgdGhpcy5zdGF0cy5zdG9yZXMrKzsKICAgIH0KICAgIAogICAgcmV0cmlldmUoa2V5KSB7CiAgICAgICAgY29uc3QgZW50cnkgPSB0aGlzLnRhYmxlLmdldChrZXkpIHx8IG51bGw7CiAgICAgICAgaWYgKGVudHJ5KSB7CiAgICAgICAgICAgIHRoaXMuc3RhdHMuaGl0cysrOwogICAgICAgICAgICAvLyDnu5/orqHkuI3lkIznsbvlnovnmoTlkb3kuK0KICAgICAgICAgICAgc3dpdGNoIChlbnRyeS5mbGFnKSB7CiAgICAgICAgICAgICAgICBjYXNlICdleGFjdCc6CiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0cy5leGFjdEhpdHMrKzsKICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgIGNhc2UgJ2xvd2VyYm91bmQnOgogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMubG93ZXJib3VuZEhpdHMrKzsKICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgIGNhc2UgJ3VwcGVyYm91bmQnOgogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMudXBwZXJib3VuZEhpdHMrKzsKICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgfQogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIHRoaXMuc3RhdHMubWlzc2VzKys7CiAgICAgICAgfQogICAgICAgIHJldHVybiBlbnRyeTsKICAgIH0KICAgIAogICAgY2xlYXIoKSB7CiAgICAgICAgdGhpcy50YWJsZS5jbGVhcigpOwogICAgICAgIHRoaXMuc3RhdHMuY2xlYXJzKys7CiAgICB9CiAgICAKICAgIC8vIOiOt+WPlue7n+iuoeS/oeaBr+W5tuiuoeeul+WRveS4reeOhwogICAgZ2V0U3RhdHMoKSB7CiAgICAgICAgY29uc3QgdG90YWxBY2Nlc3NlcyA9IHRoaXMuc3RhdHMuaGl0cyArIHRoaXMuc3RhdHMubWlzc2VzOwogICAgICAgIGNvbnN0IGhpdFJhdGUgPSB0b3RhbEFjY2Vzc2VzID4gMCA/ICh0aGlzLnN0YXRzLmhpdHMgLyB0b3RhbEFjY2Vzc2VzICogMTAwKS50b0ZpeGVkKDIpIDogMDsKICAgICAgICByZXR1cm4gewogICAgICAgICAgICAuLi50aGlzLnN0YXRzLAogICAgICAgICAgICB0b3RhbEFjY2Vzc2VzLAogICAgICAgICAgICBoaXRSYXRlLAogICAgICAgICAgICBjdXJyZW50U2l6ZTogdGhpcy50YWJsZS5zaXplLAogICAgICAgICAgICBtYXhTaXplOiB0aGlzLnNpemUsCiAgICAgICAgICAgIGZpbGxQZXJjZW50YWdlOiAodGhpcy50YWJsZS5zaXplIC8gdGhpcy5zaXplICogMTAwKS50b0ZpeGVkKDIpCiAgICAgICAgfTsKICAgIH0KICAgIAogICAgLy8g6YeN572u57uf6K6h5L+h5oGvCiAgICByZXNldFN0YXRzKCkgewogICAgICAgIHRoaXMuc3RhdHMgPSB7CiAgICAgICAgICAgIGhpdHM6IDAsCiAgICAgICAgICAgIG1pc3NlczogMCwKICAgICAgICAgICAgZXhhY3RIaXRzOiAwLAogICAgICAgICAgICBsb3dlcmJvdW5kSGl0czogMCwKICAgICAgICAgICAgdXBwZXJib3VuZEhpdHM6IDAsCiAgICAgICAgICAgIHN0b3JlczogMCwKICAgICAgICAgICAgbHJ1RXZpY3Rpb25zOiAwLAogICAgICAgICAgICBjbGVhcnM6IDAKICAgICAgICB9OwogICAgfQp9CgovLyDmgKfog73nu5/orqEKbGV0IHBlcmZTdGF0cyA9IHsKICAgIGV2YWx1YXRlQm9hcmRDb3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sCiAgICBwcmVwYXJlU2VhcmNoSW5mb0NvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwKICAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwKICAgIGFscGhhQmV0YUNhbGxzOiAwLCAgLy8g5oC76LCD55So5qyh5pWwCiAgICBub2Rlc1NlYXJjaGVkOiB7fSwgLy8g5oyJ5rex5bqm57uf6K6h5pCc57Si55qE6IqC54K55pWwCiAgICBtb3Zlc0dlbmVyYXRlZDoge30sIC8vIOaMiea3seW6pue7n+iuoeeUn+aIkOeahOi1sOazleaVsAogICAgY3V0b2Zmczoge30sIC8vIOaMiea3seW6pue7n+iuoeWJquaeneasoeaVsAogICAgLy8g5ZCI5rOV5oCn6Lev5b6E77ya5Lyq5ZCI5rOV55Sf5oiQ6YeP44CB6K+V6LWw5ZCI5rOV5oCn5qOA5rWL44CB6Z2e5rOV6Lez6L+H44CB5a6e6ZmF6L+b5YWl5pCc57Si55qE5ZCI5rOV552ACiAgICBwc2V1ZG9Nb3Zlc0dlbmVyYXRlZDogMCwKICAgIGxlZ2FsaXR5Q2hlY2tzOiAwLAogICAgaWxsZWdhbE1vdmVzU2tpcHBlZDogMCwKICAgIGxlZ2FsTW92ZXNTZWFyY2hlZDogMCwKICAgIC8vIFpvYnJpc3TvvJrlhajnm5jph43nrpfmrKHmlbAgLyDlop7ph4/mm7TmlrDmrKHmlbAgLyDmoKHpqozkuI3kuIDoh7TvvIjku4UgdmVyaWZ5IOaooeW8j++8iQogICAgZnVsbEhhc2hDb3VudDogMCwKICAgIGluY3JlbWVudGFsSGFzaFVwZGF0ZXM6IDAsCiAgICBoYXNoTWlzbWF0Y2hlczogMCwKICAgIGV2YWx1YXRlQm9hcmRNczogMCwKICAgIHByZXBhcmVTZWFyY2hJbmZvTXM6IDAsCiAgICBzdGFydFRpbWU6IERhdGUubm93KCkKfTsKCi8vIOmHjee9rue7n+iuoe+8iOavj+asoeaQnOe0ouW8gOWni+aXtuiwg+eUqO+8iQpjb25zdCByZXNldFBlcmZTdGF0cyA9ICgpID0+IHsKICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsKICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50ID0geyByZWQ6IDAsIGJsYWNrOiAwIH07CiAgICBwZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsKICAgIHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscyA9IDA7CiAgICBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZCA9IHt9OwogICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkID0ge307CiAgICBwZXJmU3RhdHMuY3V0b2ZmcyA9IHt9OwogICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkID0gMDsKICAgIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcyA9IDA7CiAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCA9IDA7CiAgICBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkID0gMDsKICAgIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50ID0gMDsKICAgIHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzID0gMDsKICAgIHBlcmZTdGF0cy5oYXNoTWlzbWF0Y2hlcyA9IDA7CiAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zID0gMDsKICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zID0gMDsKICAgIHBlcmZTdGF0cy5zdGFydFRpbWUgPSBEYXRlLm5vdygpOwp9OwoKY29uc3Qgc25hcHNob3RQZXJmU3RhdHMgPSAoKSA9PiB7CiAgICBjb25zdCBlbGFwc2VkID0gRGF0ZS5ub3coKSAtIHBlcmZTdGF0cy5zdGFydFRpbWU7CiAgICBjb25zdCB0dFN0YXRzID0gdHJhbnNwb3NpdGlvblRhYmxlLmdldFN0YXRzKCk7CiAgICBjb25zdCBkZXB0aHMgPSBPYmplY3Qua2V5cyhwZXJmU3RhdHMubm9kZXNTZWFyY2hlZCkuc29ydCgoYSwgYikgPT4gTnVtYmVyKGEpIC0gTnVtYmVyKGIpKTsKICAgIGNvbnN0IGJ5RGVwdGggPSB7fTsKICAgIGZvciAoY29uc3QgZCBvZiBkZXB0aHMpIHsKICAgICAgICBieURlcHRoW2RdID0gewogICAgICAgICAgICBub2RlczogcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0gfHwgMCwKICAgICAgICAgICAgbW92ZXM6IHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSB8fCAwLAogICAgICAgICAgICBjdXRvZmZzOiBwZXJmU3RhdHMuY3V0b2Zmc1tkXSB8fCAwCiAgICAgICAgfTsKICAgIH0KICAgIHJldHVybiB7CiAgICAgICAgZWxhcHNlZE1zOiBlbGFwc2VkLAogICAgICAgIGRlZmVyTGVnYWxpdHk6IFNFQVJDSF9ERUZFUl9MRUdBTElUWSwKICAgICAgICBpbmNyZW1lbnRhbFpvYnJpc3Q6IFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNULAogICAgICAgIGxlYWZBdHRhY2tCaXRzOiBTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUUywKICAgICAgICBldmFsdWF0ZUJvYXJkOiB7IC4uLnBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgfSwKICAgICAgICBwcmVwYXJlU2VhcmNoSW5mbzogeyAuLi5wZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudCB9LAogICAgICAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlczogeyAuLi5wZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnQgfSwKICAgICAgICBhbHBoYUJldGFDYWxsczogcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzLAogICAgICAgIHBzZXVkb01vdmVzR2VuZXJhdGVkOiBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQsCiAgICAgICAgbGVnYWxpdHlDaGVja3M6IHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcywKICAgICAgICBpbGxlZ2FsTW92ZXNTa2lwcGVkOiBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCwKICAgICAgICBsZWdhbE1vdmVzU2VhcmNoZWQ6IHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQsCiAgICAgICAgZnVsbEhhc2hDb3VudDogcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQsCiAgICAgICAgaW5jcmVtZW50YWxIYXNoVXBkYXRlczogcGVyZlN0YXRzLmluY3JlbWVudGFsSGFzaFVwZGF0ZXMsCiAgICAgICAgaGFzaE1pc21hdGNoZXM6IHBlcmZTdGF0cy5oYXNoTWlzbWF0Y2hlcywKICAgICAgICBldmFsdWF0ZUJvYXJkTXM6IHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMsCiAgICAgICAgcHJlcGFyZVNlYXJjaEluZm9NczogcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvTXMsCiAgICAgICAgdHQ6IHR0U3RhdHMsCiAgICAgICAgYnlEZXB0aAogICAgfTsKfTsKCi8vIOaJk+WNsOe7n+iuoeS/oeaBrwpjb25zdCBsb2dQZXJmU3RhdHMgPSAoY3VycmVudFBsYXllcikgPT4gewogICAgY29uc3Qgc25hcCA9IHNuYXBzaG90UGVyZlN0YXRzKCk7CiAgICBjb25zb2xlLmxvZyhg8J+TiiDmgKfog73nu5/orqEgKCR7Y3VycmVudFBsYXllcn0pIC0gJHtzbmFwLmVsYXBzZWRNc31tczpgKTsKICAgIGNvbnNvbGUubG9nKGAgICBldmFsdWF0ZUJvYXJkOiByZWQ9JHtzbmFwLmV2YWx1YXRlQm9hcmQucmVkfSwgYmxhY2s9JHtzbmFwLmV2YWx1YXRlQm9hcmQuYmxhY2t9YCk7CiAgICBjb25zb2xlLmxvZyhgICAgcHJlcGFyZVNlYXJjaEluZm86IHJlZD0ke3NuYXAucHJlcGFyZVNlYXJjaEluZm8ucmVkfSwgYmxhY2s9JHtzbmFwLnByZXBhcmVTZWFyY2hJbmZvLmJsYWNrfWApOwogICAgY29uc29sZS5sb2coYCAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlczogcmVkPSR7c25hcC5jYWxjdWxhdGVUaHJlYXRWYWx1ZXMucmVkfSwgYmxhY2s9JHtzbmFwLmNhbGN1bGF0ZVRocmVhdFZhbHVlcy5ibGFja31gKTsKICAgIGNvbnNvbGUubG9nKGAgICBhbHBoYUJldGHosIPnlKjmrKHmlbA6ICR7c25hcC5hbHBoYUJldGFDYWxsc31gKTsKICAgIGNvbnNvbGUubG9nKGAgICDlkIjms5XmgKc6IHBzZXVkbz0ke3NuYXAucHNldWRvTW92ZXNHZW5lcmF0ZWR9LCBjaGVja3M9JHtzbmFwLmxlZ2FsaXR5Q2hlY2tzfSwgaWxsZWdhbFNraXA9JHtzbmFwLmlsbGVnYWxNb3Zlc1NraXBwZWR9LCBsZWdhbFNlYXJjaGVkPSR7c25hcC5sZWdhbE1vdmVzU2VhcmNoZWR9YCk7CiAgICBjb25zb2xlLmxvZyhgICAgWm9icmlzdDogaW5jcmVtZW50YWw9JHtzbmFwLmluY3JlbWVudGFsWm9icmlzdH0sIGZ1bGxIYXNoPSR7c25hcC5mdWxsSGFzaENvdW50fSwgaW5jclVwZGF0ZXM9JHtzbmFwLmluY3JlbWVudGFsSGFzaFVwZGF0ZXN9LCBtaXNtYXRjaGVzPSR7c25hcC5oYXNoTWlzbWF0Y2hlc31gKTsKICAgIGNvbnNvbGUubG9nKGAgICBsZWFmQXR0YWNrQml0cz0ke3NuYXAubGVhZkF0dGFja0JpdHN9IGV2YWxNcz0ke01hdGgucm91bmQoc25hcC5ldmFsdWF0ZUJvYXJkTXMpfSBwcmVwYXJlTXM9JHtNYXRoLnJvdW5kKHNuYXAucHJlcGFyZVNlYXJjaEluZm9Ncyl9YCk7CiAgICBjb25zb2xlLmxvZyhgICAgVFQ6IGhpdHM9JHtzbmFwLnR0LmhpdHN9LCBtaXNzZXM9JHtzbmFwLnR0Lm1pc3Nlc30sIGhpdFJhdGU9JHtzbmFwLnR0LmhpdFJhdGV9JSwgc3RvcmVzPSR7c25hcC50dC5zdG9yZXN9LCBzaXplPSR7c25hcC50dC5jdXJyZW50U2l6ZX1gKTsKICAgIAogICAgY29uc3QgZGVwdGhzID0gT2JqZWN0LmtleXMoc25hcC5ieURlcHRoKTsKICAgIGlmIChkZXB0aHMubGVuZ3RoID4gMCkgewogICAgICAgIGNvbnNvbGUubG9nKCcgICDmjInmt7Hluqbnu5/orqE6Jyk7CiAgICAgICAgZm9yIChjb25zdCBkIG9mIGRlcHRocykgewogICAgICAgICAgICBjb25zdCByb3cgPSBzbmFwLmJ5RGVwdGhbZF07CiAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICAgIOa3seW6piR7ZH06IOiKgueCuT0ke3Jvdy5ub2Rlc30sIOi1sOazlT0ke3Jvdy5tb3Zlc30sIOWJquaenT0ke3Jvdy5jdXRvZmZzfWApOwogICAgICAgIH0KICAgIH0KfTsKCmNvbnN0IHRyYW5zcG9zaXRpb25UYWJsZSA9IG5ldyBUcmFuc3Bvc2l0aW9uVGFibGUoKTsKCi8vIOWPtuivhOS8sOe8k+WtmO+8iOWujOaVtOW9ouWKv+WIhu+8ie+8m+avj+asoSBnZXRCZXN0TW92ZSDmuIXnqboKY29uc3QgRVZBTF9DQUNIRV9NQVggPSBNYXRoLnBvdygyLCAxOCk7CmNvbnN0IGV2YWxDYWNoZSA9IG5ldyBNYXAoKTsKY29uc3QgY2xlYXJFdmFsQ2FjaGUgPSAoKSA9PiB7CiAgICBldmFsQ2FjaGUuY2xlYXIoKTsKfTsKCi8vIOWJquaeneW8gOWFs++8muWujOaVtOivhOS8sOS4i+iLpeW8gOWxgOWHuuW6n+aji+WImeWFiOWFs++8jOS/neaji+WKm+WGjemHjeagh+Wumgpjb25zdCBTRUFSQ0hfRU5BQkxFX05NUCA9IGZhbHNlOwpjb25zdCBTRUFSQ0hfRU5BQkxFX0xNUiA9IGZhbHNlOwoKLy8g552A5rOV5ZCI5rOV5oCn77yadHJ1ZT3mkJzntKLlhoXor5XotbDml7bmo4DmtYvvvIjlj6/ot7Pov4fliarmnp3mnKrop6blj4rnnYDms5XvvInvvJtmYWxzZT1wcmVwYXJlIOaXtuWFqOmHjyBmaWx0ZXJMZWdhbE1vdmVz77yI5pen6Lev5b6E77yJCmxldCBTRUFSQ0hfREVGRVJfTEVHQUxJVFkgPSB0cnVlOwoKLy8gWm9icmlzdC9UVO+8mnRydWU95pCc57Si5YaF5aKe6YeP57u05oqk5bGA6Z2i5ZOI5biMICsg5pWw5YC8IFRUIGtlee+8m2ZhbHNlPeavj+iKgueCueWFqOebmCBoYXNoICsg5a2X56ym5LiyIGtlee+8iOaXp+i3r+W+hO+8jOS+v+S6jiBBL0LvvIkKbGV0IFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUID0gdHJ1ZTsKLy8g6LCD6K+V77ya5aKe6YeP5ZCO5LiO5YWo55uYIGhhc2gg5q+U5a+577yI5LuF5qCh6aqM6ISa5pys5byA5ZCv77yM5q2j5byP5pCc57Si5YWz6Zet77yJCmxldCBTRUFSQ0hfWk9CUklTVF9WRVJJRlkgPSBmYWxzZTsKCi8vIOaQnOe0ouWQr+WPke+8muadgOaji+ihqCArIOWOhuWPsuWQr+WPke+8iOavj+asoSBnZXRCZXN0TW92ZSDph43nva7vvIkKbGV0IGtpbGxlck1vdmVzID0gW107CmxldCBoaXN0b3J5VGFibGUgPSBudWxsOwoKY29uc3QgcmVzZXRTZWFyY2hIZXVyaXN0aWNzID0gKG1heERlcHRoKSA9PiB7CiAgICBraWxsZXJNb3ZlcyA9IEFycmF5KG1heERlcHRoICsgMikuZmlsbChudWxsKS5tYXAoKCkgPT4gW251bGwsIG51bGxdKTsKICAgIGhpc3RvcnlUYWJsZSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDEwIH0sICgpID0+CiAgICAgICAgQXJyYXkuZnJvbSh7IGxlbmd0aDogOSB9LCAoKSA9PgogICAgICAgICAgICBBcnJheS5mcm9tKHsgbGVuZ3RoOiAxMCB9LCAoKSA9PiBBcnJheSg5KS5maWxsKDApKQogICAgICAgICkKICAgICk7Cn07Cgpjb25zdCBpc1NhbWVNb3ZlID0gKGEsIGIpID0+CiAgICBhICYmIGIgJiYKICAgIGEuZnJvbS5yID09PSBiLmZyb20uciAmJiBhLmZyb20uYyA9PT0gYi5mcm9tLmMgJiYKICAgIGEudG8uciA9PT0gYi50by5yICYmIGEudG8uYyA9PT0gYi50by5jOwoKY29uc3Qgc3RvcmVLaWxsZXJNb3ZlID0gKGRlcHRoLCBtb3ZlKSA9PiB7CiAgICBpZiAoZGVwdGggPCAwIHx8IGRlcHRoID49IGtpbGxlck1vdmVzLmxlbmd0aCB8fCAhbW92ZSkgcmV0dXJuOwogICAgY29uc3Qgc2xvdCA9IGtpbGxlck1vdmVzW2RlcHRoXTsKICAgIGlmIChpc1NhbWVNb3ZlKHNsb3RbMF0sIG1vdmUpKSByZXR1cm47CiAgICBzbG90WzFdID0gc2xvdFswXTsKICAgIHNsb3RbMF0gPSB7IGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmUudG8uciwgYzogbW92ZS50by5jIH0gfTsKfTsKCmNvbnN0IGFkZEhpc3RvcnlTY29yZSA9IChtb3ZlLCBkZXB0aCkgPT4gewogICAgaWYgKCFoaXN0b3J5VGFibGUgfHwgIW1vdmUpIHJldHVybjsKICAgIGNvbnN0IHsgZnJvbSwgdG8gfSA9IG1vdmU7CiAgICBoaXN0b3J5VGFibGVbZnJvbS5yXVtmcm9tLmNdW3RvLnJdW3RvLmNdICs9IGRlcHRoICogZGVwdGg7Cn07Cgpjb25zdCBnZXRIaXN0b3J5U2NvcmUgPSAobW92ZSkgPT4gewogICAgaWYgKCFoaXN0b3J5VGFibGUgfHwgIW1vdmUpIHJldHVybiAwOwogICAgY29uc3QgeyBmcm9tLCB0byB9ID0gbW92ZTsKICAgIHJldHVybiBoaXN0b3J5VGFibGVbZnJvbS5yXVtmcm9tLmNdW3RvLnJdW3RvLmNdIHx8IDA7Cn07CgovLyBXb3JrZXIgbWVzc2FnZSBoYW5kbGluZwppZiAodHlwZW9mIHNlbGYgIT09ICd1bmRlZmluZWQnKSB7CiAgICBzZWxmLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKGUpIHsKICAgIGNvbnN0IHsgdHlwZSwgcGF5bG9hZCB9ID0gZS5kYXRhOwogICAgCiAgICBzd2l0Y2ggKHR5cGUpIHsgICAgICAgICAgICAKICAgICAgICBjYXNlICdTRUFSQ0gnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHNlYXJjaEJvYXJkLCB0dXJuOiBzZWFyY2hUdXJuLCBkZXB0aDogc2VhcmNoRGVwdGgsIHJhbmRvbW5lc3M6IHNlYXJjaFJhbmRvbW5lc3MsIGdhbWVJZCwgb3BlbmluZ0Jvb2tFbmFibGVkOiBzZWFyY2hPcGVuaW5nQm9va0VuYWJsZWQgPSB0cnVlLCBwbHk6IHNlYXJjaFBseSA9IDAsIGVuYWJsZVRpbWVMaW1pdDogc2VhcmNoRW5hYmxlVGltZUxpbWl0ID0gZmFsc2UsIGV4YWN0Um9vdFNjb3Jlczogc2VhcmNoRXhhY3RSb290U2NvcmVzID0gZmFsc2UsIGRlZmVyTGVnYWxpdHk6IHNlYXJjaERlZmVyTGVnYWxpdHksIGluY3JlbWVudGFsWm9icmlzdDogc2VhcmNoSW5jcmVtZW50YWxab2JyaXN0LCBsZWFmQXR0YWNrQml0czogc2VhcmNoTGVhZkF0dGFja0JpdHMsIHpvYnJpc3RWZXJpZnk6IHNlYXJjaFpvYnJpc3RWZXJpZnkgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoRGVmZXJMZWdhbGl0eSA9PT0gJ2Jvb2xlYW4nKSB7CiAgICAgICAgICAgICAgICBTRUFSQ0hfREVGRVJfTEVHQUxJVFkgPSBzZWFyY2hEZWZlckxlZ2FsaXR5OwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoSW5jcmVtZW50YWxab2JyaXN0ID09PSAnYm9vbGVhbicpIHsKICAgICAgICAgICAgICAgIFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUID0gc2VhcmNoSW5jcmVtZW50YWxab2JyaXN0OwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoTGVhZkF0dGFja0JpdHMgPT09ICdib29sZWFuJykgewogICAgICAgICAgICAgICAgU0VBUkNIX0xFQUZfQVRUQUNLX0JJVFMgPSBzZWFyY2hMZWFmQXR0YWNrQml0czsKICAgICAgICAgICAgfQogICAgICAgICAgICBTRUFSQ0hfWk9CUklTVF9WRVJJRlkgPSAhIXNlYXJjaFpvYnJpc3RWZXJpZnk7CiAgICAgICAgICAgIC8vIFNldCBvcGVuaW5nIGJvb2sgZW5hYmxlZCBzdGF0dXMKICAgICAgICAgICAgb3BlbmluZ0Jvb2suc2V0RW5hYmxlZChzZWFyY2hPcGVuaW5nQm9va0VuYWJsZWQpOwogICAgICAgICAgICAvLyDorrDlvZXmkJzntKLlvIDlp4vml7bpl7QKICAgICAgICAgICAgY29uc3Qgc3RhcnRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCk7CiAgICAgICAgICAgIC8vIOaJp+ihjOaQnOe0ogogICAgICAgICAgICBjb25zdCBiZXN0U2VhcmNoTW92ZSA9IGdldEJlc3RNb3ZlKHNlYXJjaEJvYXJkLCBzZWFyY2hUdXJuLCBzZWFyY2hEZXB0aCwgc2VhcmNoUmFuZG9tbmVzcywgc2VhcmNoUGx5LCBzZWFyY2hFbmFibGVUaW1lTGltaXQsIHNlYXJjaEV4YWN0Um9vdFNjb3Jlcyk7CiAgICAgICAgICAgIC8vIOiusOW9leaQnOe0oue7k+adn+aXtumXtOW5tuiuoeeul+aAneiAg+aXtumXtAogICAgICAgICAgICBjb25zdCBlbmRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCk7CiAgICAgICAgICAgIGNvbnN0IHRoaW5raW5nVGltZSA9IGVuZFRpbWUgLSBzdGFydFRpbWU7CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyDmo4Dmn6XmmK/lkKbmnaXoh6rlvIDlsYDlupMKICAgICAgICAgICAgY29uc3QgYm9va01vdmVTZWFyY2ggPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShzZWFyY2hCb2FyZCwgc2VhcmNoUGx5KTsKICAgICAgICAgICAgY29uc3QgZnJvbUJvb2tTZWFyY2ggPSAhIWJvb2tNb3ZlU2VhcmNoICYmIEpTT04uc3RyaW5naWZ5KGJvb2tNb3ZlU2VhcmNoKSA9PT0gSlNPTi5zdHJpbmdpZnkoYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmUpOwogICAgICAgICAgICAKICAgICAgICAgICAgLy8g5re75Yqg5oCn6IO957uf6K6h5pel5b+XCiAgICAgICAgICAgIGxvZ1BlcmZTdGF0cyhzZWFyY2hUdXJuKTsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIOa3u+WKoOaAneiAg+aXtumXtOaXpeW/lwogICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VhcmNoIGNvbXBsZXRlZCBpbiAke01hdGgucm91bmQodGhpbmtpbmdUaW1lKX1tcywgZ2FtZUlkPSR7Z2FtZUlkfSwgYmVzdE1vdmU9JHtKU09OLnN0cmluZ2lmeShiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSl9LCBzZWNvbmRCZXN0TW92ZT0ke0pTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlKX0sIGZyb21Cb29rPSR7ZnJvbUJvb2tTZWFyY2h9YCk7CiAgICAgICAgICAgIC8vIOWPkemAgeaQnOe0oue7k+aenOWSjOaAneiAg+aXtumXtAogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgCiAgICAgICAgICAgICAgICB0eXBlOiAnU0VBUkNIX0NPTVBMRVRFJywgCiAgICAgICAgICAgICAgICBwYXlsb2FkOiB7IAogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlOiBiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSwgCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kQmVzdE1vdmU6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlLCAKICAgICAgICAgICAgICAgICAgICBnYW1lSWQsIAogICAgICAgICAgICAgICAgICAgIGZyb21Cb29rOiBmcm9tQm9va1NlYXJjaCwgCiAgICAgICAgICAgICAgICAgICAgdGhpbmtpbmdUaW1lOiBNYXRoLnJvdW5kKHRoaW5raW5nVGltZSksIC8vIOWbm+iIjeS6lOWFpeWIsOavq+enkgogICAgICAgICAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogYmVzdFNlYXJjaE1vdmUubW92ZVNlcXVlbmNlLAogICAgICAgICAgICAgICAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kTW92ZVNlcXVlbmNlLAogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2NvcmU6IGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlU2NvcmUsCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kQmVzdE1vdmVTY29yZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kQmVzdE1vdmVTY29yZSwKICAgICAgICAgICAgICAgICAgICBhbGxNb3Zlc1dpdGhTY29yZXM6IGJlc3RTZWFyY2hNb3ZlLmFsbE1vdmVzV2l0aFNjb3JlcyB8fCBbXSwKICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWREZXB0aDogYmVzdFNlYXJjaE1vdmUuY29tcGxldGVkRGVwdGgsCiAgICAgICAgICAgICAgICAgICAgcGVyZjogc25hcHNob3RQZXJmU3RhdHMoKQogICAgICAgICAgICAgICAgfSAKICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICBjYXNlICdnZXRWYWxpZE1vdmVzJzogewogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiB2bUJvYXJkLCBwb3M6IHZtUG9zIH0gPSBwYXlsb2FkOwogICAgICAgICAgICBzeW5jR2VuZXJhbFBvc0NhY2hlKHZtQm9hcmQpOwogICAgICAgICAgICBjb25zdCB2YWxpZE1vdmVzID0gZ2V0VmFsaWRNb3Zlcyh2bUJvYXJkLCB2bVBvcyk7CiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICAgICAgdHlwZTogJ3ZhbGlkTW92ZXMnLAogICAgICAgICAgICAgICAgbW92ZXM6IHZhbGlkTW92ZXMKICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgY2FzZSAnZ2V0UGllY2VSZWxhdGlvbnMnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHByQm9hcmQsIHBvczogcHJQb3MgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gcHJCb2FyZFtwclBvcy5yXVtwclBvcy5jXTsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIOiwg+eUqGV2YWx1YXRlQm9hcmTojrflj5blrozmlbTnmoTmo4vlrZDkv6Hmga/lkoxib2FyZEluZm8KICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UocHJCb2FyZCk7CiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOwogICAgICAgICAgICBjb25zdCBib2FyZEV2YWx1YXRpb24gPSBldmFsdWF0ZUJvYXJkKHByQm9hcmQsIGZhbHNlLCBudWxsLCAwLCBudWxsLCBnYW1lU3RhZ2UpOwogICAgICAgICAgICBjb25zdCBwaWVjZXNJbmZvID0gYm9hcmRFdmFsdWF0aW9uLnBpZWNlc0luZm87CiAgICAgICAgICAgIGNvbnN0IGJvYXJkSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5ib2FyZEluZm87CiAgICAgICAgICAgIAogICAgICAgICAgICAvLyBib2FyZEluZm8g5qC85YaF5Y+v6IO95pivIHBpZWNlc0luZm8g5byV55So77yM57uf5LiA5pig5bCE5Li6IHtyLGN9IOS+myBVSSDkvb/nlKgKICAgICAgICAgICAgY29uc3QgcmF3Q29udHJvbGxlcnMgPSBib2FyZEluZm9bcHJQb3Mucl1bcHJQb3MuY10gfHwgW107CiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJzID0gcmF3Q29udHJvbGxlcnMubWFwKChjdHJsKSA9PiAoeyByOiBjdHJsLnIsIGM6IGN0cmwuYyB9KSk7CiAgICAgICAgICAgIAogICAgICAgICAgICBsZXQgcmVsYXRpb25zID0gewogICAgICAgICAgICAgICAgdGhyZWF0OiBbXSwgCiAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnk6IFtdLCAKICAgICAgICAgICAgICAgIGd1YXJkOiBbXSwgCiAgICAgICAgICAgICAgICBndWFyZGVkQnk6IFtdLCAKICAgICAgICAgICAgICAgIGNvbnRyb2w6IFtdLAogICAgICAgICAgICAgICAgY29udHJvbGxlcnMKICAgICAgICAgICAgfTsKICAgICAgICAgICAgCiAgICAgICAgICAgIC8vIOWmguaenOeCueWHu+eahOaYr+aji+WtkO+8jOi/lOWbnuivpeaji+WtkOeahOWFs+ezu+S/oeaBrwogICAgICAgICAgICBpZiAocGllY2UpIHsKICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIGN1cnJlbnQgcGllY2UgaW5mbwogICAgICAgICAgICAgICAgY29uc3QgY3VycmVudFBpZWNlSW5mbyA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gcHJQb3MuciAmJiBwLmMgPT09IHByUG9zLmMpOwogICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICBpZiAoY3VycmVudFBpZWNlSW5mbykgewogICAgICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgcmVsYXRpb25zCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGhyZWF0ID0gY3VycmVudFBpZWNlSW5mby50aHJlYXQubWFwKHRocmVhdFBpZWNlID0+ICh7IHI6IHRocmVhdFBpZWNlLnIsIGM6IHRocmVhdFBpZWNlLmMgfSkpOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRocmVhdGVuZWRCeSA9IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0ZW5lZEJ5Lm1hcCh0aHJlYXRlbmVkQnlQaWVjZSA9PiAoeyByOiB0aHJlYXRlbmVkQnlQaWVjZS5yLCBjOiB0aHJlYXRlbmVkQnlQaWVjZS5jIH0pKTsKICAgICAgICAgICAgICAgICAgICBjb25zdCBndWFyZCA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmQubWFwKGd1YXJkUGllY2UgPT4gKHsgcjogZ3VhcmRQaWVjZS5yLCBjOiBndWFyZFBpZWNlLmMgfSkpOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IGd1YXJkZWRCeSA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmRlZEJ5Lm1hcChndWFyZGVkQnlQaWVjZSA9PiAoeyByOiBndWFyZGVkQnlQaWVjZS5yLCBjOiBndWFyZGVkQnlQaWVjZS5jIH0pKTsKICAgICAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sID0gKGN1cnJlbnRQaWVjZUluZm8uY29udHJvbCB8fCBbXSkubWFwKGNvbnRyb2xQb3MgPT4gKHsgcjogY29udHJvbFBvcy5yLCBjOiBjb250cm9sUG9zLmMgfSkpOwogICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgIHJlbGF0aW9ucyA9IHsKICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0LCAKICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5LCAKICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmQsIAogICAgICAgICAgICAgICAgICAgICAgICBndWFyZGVkQnksIAogICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sLAogICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sbGVycwogICAgICAgICAgICAgICAgICAgIH07CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlUmVsYXRpb25zJywKICAgICAgICAgICAgICAgIHJlbGF0aW9uczogcmVsYXRpb25zCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgIGNhc2UgJ2NoZWNrR2FtZVN0YXRlJzogewogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBjZ3NCb2FyZCwgdHVybjogY2dzVHVybiwgcmVxdWVzdElkIH0gPSBwYXlsb2FkOwogICAgICAgICAgICBjb25zdCBnYW1lU3RhdGUgPSBjaGVja0dhbWVTdGF0ZShjZ3NCb2FyZCwgY2dzVHVybik7CiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICAgICAgdHlwZTogJ2dhbWVTdGF0ZScsCiAgICAgICAgICAgICAgICBzdGF0ZTogZ2FtZVN0YXRlLAogICAgICAgICAgICAgICAgcmVxdWVzdElkCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgIGNhc2UgJ2V2YWx1YXRlQm9hcmQnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGV2YWxCb2FyZCwgdHVybjogZXZhbFR1cm4sIGlzUmVwbGF5ID0gZmFsc2UsIGRlcHRoID0gMSB9ID0gcGF5bG9hZDsKICAgICAgICAgICAgLy8g5omT5Y2w5o6l5pS255qE5Y+C5pWwCiAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ2V2YWx1YXRlQm9hcmQgY2FsbGVkIHdpdGg6JywgeyB0dXJuOiBldmFsVHVybiwgaXNSZXBsYXksIGRlcHRoIH0pOwogICAgICAgICAgICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZShldmFsQm9hcmQpOwogICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsKICAgICAgICAgICAgY29uc3QgZGV0YWlsZWRFdmFsID0gZXZhbHVhdGVCb2FyZChldmFsQm9hcmQsIGlzUmVwbGF5LCBldmFsVHVybiwgZGVwdGgsIGV2YWxUdXJuLCBnYW1lU3RhZ2UpOwogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsKICAgICAgICAgICAgICAgIHR5cGU6ICdkZXRhaWxlZEV2YWx1YXRpb24nLAogICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZGV0YWlsZWRFdmFsCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CgogICAgICAgIGNhc2UgJ2V2YWx1YXRlUGllY2UnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHBpZWNlRXZhbEJvYXJkLCBwb3M6IHBpZWNlRXZhbFBvcywgdHVybiB9ID0gcGF5bG9hZDsKICAgICAgICAgICAgY29uc3QgcGllY2UgPSBwaWVjZUV2YWxCb2FyZFtwaWVjZUV2YWxQb3Mucl1bcGllY2VFdmFsUG9zLmNdOwogICAgICAgICAgICAKICAgICAgICAgICAgaWYgKCFwaWVjZSkgewogICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7CiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsCiAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogewogICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogMCwKICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IDAsCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLAogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IDAsCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogMCwKICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiAwCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgIH0KICAgICAgICAgICAgZWxzZSB7CiAgICAgICAgICAgICAgICAvLyDkuLvliqjosIPnlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE6K+E5Lyw5L+h5oGvCiAgICAgICAgICAgICAgICAvLyDojrflj5blvZPliY3muLjmiI/pmLbmrrUKICAgICAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKHBpZWNlRXZhbEJvYXJkKTsKICAgICAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOwogICAgICAgICAgICAgICAgY29uc3QgYm9hcmRFdmFsdWF0aW9uID0gZXZhbHVhdGVCb2FyZChwaWVjZUV2YWxCb2FyZCwgZmFsc2UsIHR1cm4sIDAsIHR1cm4sIGdhbWVTdGFnZSk7CiAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgIC8vIOS7jmV2YWx1YXRlQm9hcmTnmoTov5Tlm57lgLzkuK3mib7liLDlvZPliY3mo4vlrZDnmoTkv6Hmga8KICAgICAgICAgICAgICAgIGN1cnJlbnRQaWVjZUluZm8gPSBib2FyZEV2YWx1YXRpb24ucGllY2VzSW5mby5maW5kKAogICAgICAgICAgICAgICAgICAgIHAgPT4gcC5yID09PSBwaWVjZUV2YWxQb3MuciAmJiBwLmMgPT09IHBpZWNlRXZhbFBvcy5jCiAgICAgICAgICAgICAgICApOwogICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICBpZiAoY3VycmVudFBpZWNlSW5mbykgewogICAgICAgICAgICAgICAgICAgIC8vIOW6lOeUqOadg+mHjeW5tui/lOWbnuWNleS4quaji+WtkOeahOivhOS8sOWAvAogICAgICAgICAgICAgICAgICAgIGNvbnN0IGV2YWx1YXRpb24gPSB7CiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsOiBjdXJyZW50UGllY2VJbmZvLm1hdGVyaWFsVmFsdWUgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsLAogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogY3VycmVudFBpZWNlSW5mby5wb3NpdGlvblZhbHVlICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwKICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHk6IGN1cnJlbnRQaWVjZUluZm8ubW9iaWxpdHlWYWx1ZSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogY3VycmVudFBpZWNlSW5mby50aHJlYXRWYWx1ZSAqIFZBTFVFX1dFSUdIVFMudGhyZWF0LAogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IGN1cnJlbnRQaWVjZUluZm8uc2FmZXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwKICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiBjdXJyZW50UGllY2VJbmZvLnRhY3RpY1ZhbHVlICogVkFMVUVfV0VJR0hUUy50YWN0aWMKICAgICAgICAgICAgICAgICAgICB9OwogICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywKICAgICAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZXZhbHVhdGlvbgogICAgICAgICAgICAgICAgICAgIH0pOwogICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAvLyDlpoLmnpzku43nhLbmib7kuI3liLDmo4vlrZDkv6Hmga/vvIzov5Tlm57pu5jorqTlgLwKICAgICAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsKICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsCiAgICAgICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IDAsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogMCwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogMCwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMAogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgfSk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICByZXR1cm47CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgIGNhc2UgJ2lzQ2hlY2snOiB7CiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGNCb2FyZCwgY29sb3I6IGNDb2xvciwgcmVxdWVzdElkIH0gPSBwYXlsb2FkOwogICAgICAgICAgICBzeW5jR2VuZXJhbFBvc0NhY2hlKGNCb2FyZCk7CiAgICAgICAgICAgIGNvbnN0IGluQ2hlY2sgPSBpc0NoZWNrKGNCb2FyZCwgY0NvbG9yKTsKICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7CiAgICAgICAgICAgICAgICB0eXBlOiAnY2hlY2snLAogICAgICAgICAgICAgICAgaXNDaGVjazogaW5DaGVjaywKICAgICAgICAgICAgICAgIHJlcXVlc3RJZAogICAgICAgICAgICB9KTsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICBjYXNlICdpc1ZhbGlkUGxhY2VtZW50JzogewogICAgICAgICAgICBjb25zdCB7IHR5cGU6IGlwVHlwZSwgY29sb3I6IGlwQ29sb3IsIHIsIGMgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIGNvbnN0IHZhbGlkUGxhY2VtZW50ID0gaXNWYWxpZFBsYWNlbWVudChpcFR5cGUsIGlwQ29sb3IsIHIsIGMpOwogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsKICAgICAgICAgICAgICAgIHR5cGU6ICd2YWxpZFBsYWNlbWVudCcsCiAgICAgICAgICAgICAgICBpc1ZhbGlkOiB2YWxpZFBsYWNlbWVudAogICAgICAgICAgICB9KTsKICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgICAgICAgICAKICAgICAgICBjYXNlICdhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcnOiB7CiAgICAgICAgICAgIGNvbnN0IHsgbW92ZXMsIHdlaWdodHMgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIC8vIEFkZCB0aGUgb3BlbmluZyBsaW5lIHRvIHRoZSBvcGVuaW5nIGJvb2sKICAgICAgICAgICAgb3BlbmluZ0Jvb2suYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKFttb3Zlc10sIHdlaWdodHMpOwogICAgICAgICAgICAvLyBTZW5kIGNvbmZpcm1hdGlvbgogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgCiAgICAgICAgICAgICAgICB0eXBlOiAnb3BlbmluZ0xpbmVBZGRlZCcsIAogICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSAKICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgY2FzZSAnbW92ZXNUb05vdGF0aW9uJzogewogICAgICAgICAgICBjb25zdCB7IGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIGNvbnN0IG5vdGF0aW9uID0gb3BlbmluZ0Jvb2subW92ZXNUb05vdGF0aW9uKGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkpOwogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgCiAgICAgICAgICAgICAgICB0eXBlOiAnbm90YXRpb24nLCAKICAgICAgICAgICAgICAgIG5vdGF0aW9uOiBub3RhdGlvbiAKICAgICAgICAgICAgfSk7CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICAgICAgCiAgICAgICAgY2FzZSAnbm90YXRpb25Ub01vdmVzJzogewogICAgICAgICAgICBjb25zdCB7IG5vdGF0aW9uOiBub3RhdGlvblN0cmluZywgaW5pdGlhbEJvYXJkIH0gPSBwYXlsb2FkOwogICAgICAgICAgICBjb25zdCBtb3Zlc0Zyb21Ob3RhdGlvbiA9IG9wZW5pbmdCb29rLm5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvblN0cmluZywgaW5pdGlhbEJvYXJkKTsKICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7IAogICAgICAgICAgICAgICAgdHlwZTogJ21vdmVzJywgCiAgICAgICAgICAgICAgICBtb3ZlczogbW92ZXNGcm9tTm90YXRpb24gCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgICAgIAogICAgICAgIGNhc2UgJ3NldFZhbHVlV2VpZ2h0cyc6IHsKICAgICAgICAgICAgVkFMVUVfV0VJR0hUUyA9IHsgLi4uVkFMVUVfV0VJR0hUUywgLi4ucGF5bG9hZCB9OwogICAgICAgICAgICBjb25zb2xlLmxvZygnVXBkYXRlZCBWQUxVRV9XRUlHSFRTOicsIFZBTFVFX1dFSUdIVFMpOwogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICB9Cn07CgogICAgLy8gT3ZlcnJpZGUgY29uc29sZS5sb2cgdG8gc2VuZCBtZXNzYWdlcyBiYWNrIHRvIG1haW4gdGhyZWFkCiAgICBjb25zdCBvcmlnaW5hbENvbnNvbGVMb2cgPSBjb25zb2xlLmxvZzsKICAgIGNvbnNvbGUubG9nID0gZnVuY3Rpb24oLi4uYXJncykgewogICAgICAgIC8vIFNlbmQgdG8gbWFpbiB0aHJlYWQKICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsKICAgICAgICAgICAgdHlwZTogJ2xvZycsCiAgICAgICAgICAgIGRhdGE6IGFyZ3Muam9pbignICcpCiAgICAgICAgfSk7CiAgICAgICAgCiAgICAgICAgLy8gQWxzbyBsb2cgdG8gd29ya2VyIGNvbnNvbGUKICAgICAgICBvcmlnaW5hbENvbnNvbGVMb2cuYXBwbHkoY29uc29sZSwgYXJncyk7CiAgICB9Owp9CgovLyDnqbrnnYDliarmnp3vvJrmnInov5vmlLvlrZDlipvml7bmiY3lhYHorrjvvIjpgb/lhY3lsIYv5aOrL+ixoeaui+WxgOmAvOedgOivr+WJqu+8iQpjb25zdCBjYW5Eb051bGxNb3ZlID0gKGJvYXJkLCBjb2xvcikgPT4gewogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsKICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgIGlmICghcCB8fCBwLmNvbG9yICE9PSBjb2xvcikgY29udGludWU7CiAgICAgICAgICAgIGlmIChwLnR5cGUgPT09ICdjaGFyaW90JyB8fCBwLnR5cGUgPT09ICdob3JzZScgfHwgcC50eXBlID09PSAnY2Fubm9uJyB8fCBwLnR5cGUgPT09ICdzb2xkaWVyJykgewogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CiAgICByZXR1cm4gZmFsc2U7Cn07CgovLyDmkJzntKLnlKggVFQga2V577ya5aKe6YeP5qih5byP5Li6IG51bWJlcu+8jOaXp+aooeW8j+S4uiBgJHtoYXNofToke3NpZGV9YCDlrZfnrKbkuLIKY29uc3QgbWFrZVNlYXJjaFRUS2V5ID0gKGJvYXJkLCBjdXJyZW50UGxheWVyLCBib2FyZEhhc2gpID0+IHsKICAgIGlmIChTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCkgewogICAgICAgIHJldHVybiB6b2JyaXN0SGFzaGVyLnR0S2V5RnJvbUhhc2goYm9hcmRIYXNoLCBjdXJyZW50UGxheWVyKTsKICAgIH0KICAgIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50Kys7CiAgICByZXR1cm4gYCR7em9icmlzdEhhc2hlci5oYXNoKGJvYXJkKX06JHtjdXJyZW50UGxheWVyfWA7Cn07CgovLyDotbDlrZDlkI7nmoTlrZDoioLngrnlsYDpnaLlk4jluIzvvIjku4Xlop7ph4/mqKHlvI/mnInmhI/kuYnvvJvpobvlnKggbWFrZSDliY3kv53lrZggbW92aW5nUGllY2XvvIkKY29uc3QgY2hpbGRCb2FyZEhhc2ggPSAoYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpID0+IHsKICAgIGlmICghU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QpIHJldHVybiBib2FyZEhhc2g7CiAgICBwZXJmU3RhdHMuaW5jcmVtZW50YWxIYXNoVXBkYXRlcysrOwogICAgcmV0dXJuIHpvYnJpc3RIYXNoZXIudXBkYXRlSGFzaChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7Cn07Cgpjb25zdCB2ZXJpZnlCb2FyZEhhc2ggPSAoYm9hcmQsIGV4cGVjdGVkSGFzaCkgPT4gewogICAgaWYgKCFTRUFSQ0hfWk9CUklTVF9WRVJJRlkpIHJldHVybjsKICAgIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50Kys7CiAgICBjb25zdCBmdWxsID0gem9icmlzdEhhc2hlci5oYXNoKGJvYXJkKTsKICAgIGlmIChmdWxsICE9PSBleHBlY3RlZEhhc2gpIHsKICAgICAgICBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMrKzsKICAgIH0KfTsKCi8vIOaQnOe0oueUqOWHgOWIhu+8muWujOaVtOW9ouWKv+ivhOS8sO+8iOWFs+ezuy/lqIHog4Ev5a6J5YWoL+acuuWKqO+8ie+8jOS7hei3s+i/h+e7iOWxgOedgOazleaemuS4vu+8m+W4piBab2JyaXN0IOe8k+WtmApjb25zdCBzdGF0aWNTZWFyY2hFdmFsID0gKGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRIYXNoID0gMCkgPT4gewogICAgbGV0IGNhY2hlS2V5OwogICAgaWYgKFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUKSB7CiAgICAgICAgY2FjaGVLZXkgPSB6b2JyaXN0SGFzaGVyLmV2YWxDYWNoZUtleUZyb21IYXNoKGJvYXJkSGFzaCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpOwogICAgfSBlbHNlIHsKICAgICAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOwogICAgICAgIGNhY2hlS2V5ID0gem9icmlzdEhhc2hlci5ldmFsQ2FjaGVLZXkoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsKICAgIH0KICAgIGlmIChldmFsQ2FjaGUuaGFzKGNhY2hlS2V5KSkgewogICAgICAgIHJldHVybiBldmFsQ2FjaGUuZ2V0KGNhY2hlS2V5KTsKICAgIH0KICAgIGNvbnN0IGV2YWxSZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGJvYXJkLCBmYWxzZSwgc2VhcmNoSW5pdGlhdG9yLCAwLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgeyBmb3JTZWFyY2hMZWFmOiB0cnVlIH0pOwogICAgY29uc3Qgb3Bwb25lbnQgPSBzZWFyY2hJbml0aWF0b3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgY29uc3QgbmV0ID0gZXZhbFJlc3VsdFtzZWFyY2hJbml0aWF0b3JdLnRvdGFsIC0gZXZhbFJlc3VsdFtvcHBvbmVudF0udG90YWw7CiAgICBpZiAoZXZhbENhY2hlLnNpemUgPj0gRVZBTF9DQUNIRV9NQVgpIHsKICAgICAgICAvLyDnroDljZXmt5jmsbDmnIDml6nlhpnlhaXnmoTkuIDmibnvvIzpgb/lhY0gTWFwIOaXoOmZkOa2qAogICAgICAgIGxldCBkcm9wID0gMDsKICAgICAgICBmb3IgKGNvbnN0IGsgb2YgZXZhbENhY2hlLmtleXMoKSkgewogICAgICAgICAgICBldmFsQ2FjaGUuZGVsZXRlKGspOwogICAgICAgICAgICBpZiAoKytkcm9wID49IDQwOTYpIGJyZWFrOwogICAgICAgIH0KICAgIH0KICAgIGV2YWxDYWNoZS5zZXQoY2FjaGVLZXksIG5ldCk7CiAgICByZXR1cm4gbmV0Owp9OwoKLy8g55Sf5oiQ5b2T5YmN5pa55ZCD5a2Q552A77yI5L6b6Z2Z6buY5pCc57Si77yJCmNvbnN0IGdlbmVyYXRlQ2FwdHVyZXNGb3JTZWFyY2ggPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIpID0+IHsKICAgIGNvbnN0IGNhcHR1cmVzID0gW107CiAgICBjb25zdCBkZWZlciA9IFNFQVJDSF9ERUZFUl9MRUdBTElUWTsKICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7CiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsKICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsKICAgICAgICAgICAgaWYgKCFwaWVjZSB8fCBwaWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7CiAgICAgICAgICAgIGNvbnN0IHBzZXVkbyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSk7CiAgICAgICAgICAgIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCArPSBwc2V1ZG8ubGVuZ3RoOwogICAgICAgICAgICBjb25zdCB1c2VNb3ZlcyA9IGRlZmVyID8gcHNldWRvIDogZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlLCBwc2V1ZG8pOwogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHVzZU1vdmVzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBjb25zdCB0byA9IHVzZU1vdmVzW2ldOwogICAgICAgICAgICAgICAgaWYgKGJvYXJkW3RvLnJdW3RvLmNdKSB7CiAgICAgICAgICAgICAgICAgICAgY2FwdHVyZXMucHVzaCh7IGZyb206IHsgciwgYyB9LCB0byB9KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KICAgIHJldHVybiBjYXB0dXJlczsKfTsKCi8vIOmdmem7mOaQnOe0ou+8mnN0YW5kLXBhdCDnlKjlrozmlbTlvaLlir/or4TkvLDvvJvku4Xlr7nlkIPlrZDlu7bkvLjvvIhRU+KJpDPvvIkKY29uc3QgcXVpZXNjZW5jZSA9ICgKICAgIGIsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLAogICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGgsIGJvYXJkSGFzaCA9IDAKKSA9PiB7CiAgICBjb25zdCBzdGFuZFBhdCA9IHN0YXRpY1NlYXJjaEV2YWwoYiwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGJvYXJkSGFzaCk7CgogICAgaWYgKHFzRGVwdGggPD0gMCkgewogICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9OwogICAgfQoKICAgIGlmIChtYXhpbWl6aW5nKSB7CiAgICAgICAgaWYgKHN0YW5kUGF0ID49IGJldGEpIHsKICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07CiAgICAgICAgfQogICAgICAgIGlmIChzdGFuZFBhdCA+IGFscGhhKSB7CiAgICAgICAgICAgIGFscGhhID0gc3RhbmRQYXQ7CiAgICAgICAgfQogICAgfSBlbHNlIHsKICAgICAgICBpZiAoc3RhbmRQYXQgPD0gYWxwaGEpIHsKICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07CiAgICAgICAgfQogICAgICAgIGlmIChzdGFuZFBhdCA8IGJldGEpIHsKICAgICAgICAgICAgYmV0YSA9IHN0YW5kUGF0OwogICAgICAgIH0KICAgIH0KCiAgICBsZXQgY2FwdHVyZXMgPSBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoKGIsIGN1cnJlbnRQbGF5ZXIpOwogICAgaWYgKGNhcHR1cmVzLmxlbmd0aCA9PT0gMCkgewogICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9OwogICAgfQoKICAgIC8vIE1WVi1MVkHvvJrlhYjor5XlkIPlpKflrZAKICAgIGNhcHR1cmVzLnNvcnQoKGEsIGJNb3ZlKSA9PiB7CiAgICAgICAgY29uc3Qgc2NvcmVBID0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW2EudG8ucl1bYS50by5jXSwgZ2FtZVN0YWdlKSAqIDE2IC0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW2EuZnJvbS5yXVthLmZyb20uY10sIGdhbWVTdGFnZSk7CiAgICAgICAgY29uc3Qgc2NvcmVCID0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW2JNb3ZlLnRvLnJdW2JNb3ZlLnRvLmNdLCBnYW1lU3RhZ2UpICogMTYgLQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbYk1vdmUuZnJvbS5yXVtiTW92ZS5mcm9tLmNdLCBnYW1lU3RhZ2UpOwogICAgICAgIHJldHVybiBzY29yZUIgLSBzY29yZUE7CiAgICB9KTsKCiAgICBsZXQgYmVzdEV2YWwgPSBzdGFuZFBhdDsKICAgIGxldCBiZXN0TW92ZVNlcXVlbmNlID0gW107CiAgICBjb25zdCBkZWZlciA9IFNFQVJDSF9ERUZFUl9MRUdBTElUWTsKCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNhcHR1cmVzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgbW92ZSA9IGNhcHR1cmVzW2ldOwogICAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYlttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOwogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZU1vdmUoYiwgbW92ZS5mcm9tLCBtb3ZlLnRvKTsKICAgICAgICBpZiAoZGVmZXIgJiYgbGVhdmVzT3duS2luZ1Vuc2FmZShiLCBjdXJyZW50UGxheWVyKSkgewogICAgICAgICAgICB1bm1ha2VNb3ZlKGIsIG1vdmUuZnJvbSwgbW92ZS50bywgY2FwdHVyZWQpOwogICAgICAgICAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCsrOwogICAgICAgICAgICBjb250aW51ZTsKICAgICAgICB9CiAgICAgICAgY29uc3QgbmV4dEhhc2ggPSBjaGlsZEJvYXJkSGFzaChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7CiAgICAgICAgdmVyaWZ5Qm9hcmRIYXNoKGIsIG5leHRIYXNoKTsKICAgICAgICBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkKys7CiAgICAgICAgY29uc3QgbmV4dFBsYXllciA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOwogICAgICAgIGNvbnN0IHJlc3VsdCA9IHF1aWVzY2VuY2UoCiAgICAgICAgICAgIGIsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwKICAgICAgICAgICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGggLSAxLCBuZXh0SGFzaAogICAgICAgICk7CiAgICAgICAgdW5tYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8sIGNhcHR1cmVkKTsKCiAgICAgICAgaWYgKG1heGltaXppbmcpIHsKICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7CiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsKICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZSwgLi4uKHJlc3VsdC5tb3ZlU2VxdWVuY2UgfHwgW10pXTsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlID4gYWxwaGEpIHsKICAgICAgICAgICAgICAgIGFscGhhID0gcmVzdWx0LnZhbHVlOwogICAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA8IGJlc3RFdmFsKSB7CiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsKICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZSwgLi4uKHJlc3VsdC5tb3ZlU2VxdWVuY2UgfHwgW10pXTsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmV0YSkgewogICAgICAgICAgICAgICAgYmV0YSA9IHJlc3VsdC52YWx1ZTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICBpZiAoYmV0YSA8PSBhbHBoYSkgewogICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICB9CgogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UgfTsKfTsKCi8vIGFscGhhQmV0Ye+8muivhOS8sOWni+e7iOS7jiBzZWFyY2hJbml0aWF0b3Ig6KeS5bqm77ybVFQgKyBraWxsZXIvaGlzdG9yeSArIOepuuedgOWJquaenSArIExNUiArIFFTCi8vIGJvYXJkSGFzaO+8muWinumHjyBab2JyaXN0IOWxgOmdouWTiOW4jO+8iOS4jeWQq+ihjOaji+aWue+8ie+8m+aXp+aooeW8j+S4i+WPr+S8oCAwCmNvbnN0IGFscGhhQmV0YSA9ICgKICAgIGIsIGQsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLAogICAgc2VhcmNoRGVwdGggPSAwLCBzZWFyY2hJbml0aWF0b3IgPSBjdXJyZW50UGxheWVyLCBnYW1lU3RhZ2UgPSAnbWlkJywKICAgIGFsbG93TnVsbCA9IHRydWUsIGJvYXJkSGFzaCA9IDAKKSA9PiB7CiAgICBjb25zdCBvcmlnaW5hbEFscGhhID0gYWxwaGE7CiAgICBjb25zdCBvcmlnaW5hbEJldGEgPSBiZXRhOwoKICAgIHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscysrOwogICAgaWYgKCFwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSkgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0gPSAwOwogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0rKzsKCiAgICAvLyDlj7boioLngrnvvJrlrozmlbTlvaLlir/or4TkvLAgKyDlkIPlrZDpnZnpu5jmkJzntKLvvIhRU+KJpDPvvIkKICAgIGlmIChkID09PSAwKSB7CiAgICAgICAgcmV0dXJuIHF1aWVzY2VuY2UoCiAgICAgICAgICAgIGIsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLAogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgMywgYm9hcmRIYXNoCiAgICAgICAgKTsKICAgIH0KCiAgICAvLyDnva7mjaLooajmjqLmtYvvvIhrZXkg5ZCr6KGM5qOL5pa577yM6YG/5YWN5ZCM5b2i5LiN5ZCM6LWw5pa55Yay56qB77yJCiAgICBjb25zdCB0dEtleSA9IG1ha2VTZWFyY2hUVEtleShiLCBjdXJyZW50UGxheWVyLCBib2FyZEhhc2gpOwogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZSh0dEtleSk7CiAgICBsZXQgdHRNb3ZlID0gbnVsbDsKICAgIGlmICh0dEVudHJ5KSB7CiAgICAgICAgdHRNb3ZlID0gdHRFbnRyeS5iZXN0TW92ZSB8fCBudWxsOwogICAgICAgIGlmICh0dEVudHJ5LmRlcHRoID49IGQpIHsKICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ2V4YWN0JykgewogICAgICAgICAgICAgICAgcmV0dXJuIHsKICAgICAgICAgICAgICAgICAgICB2YWx1ZTogdHRFbnRyeS52YWx1ZSwKICAgICAgICAgICAgICAgICAgICBtb3ZlU2VxdWVuY2U6IHR0RW50cnkubW92ZVNlcXVlbmNlIHx8ICh0dE1vdmUgPyBbdHRNb3ZlXSA6IFtdKQogICAgICAgICAgICAgICAgfTsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnbG93ZXJib3VuZCcgJiYgdHRFbnRyeS52YWx1ZSA+PSBiZXRhKSB7CiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9OwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICd1cHBlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlIDw9IGFscGhhKSB7CiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9OwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIGNvbnN0IHNlYXJjaEluZm8gPSBwcmVwYXJlU2VhcmNoSW5mbyhiLCBjdXJyZW50UGxheWVyLCBnYW1lU3RhZ2UsIHNlYXJjaEluaXRpYXRvciwgZCk7CiAgICBjb25zdCBhYlBpZWNlc0luZm8gPSBzZWFyY2hJbmZvLnBpZWNlc0luZm87CiAgICBjb25zdCBhYkJvYXJkSW5mbyA9IHNlYXJjaEluZm8uYm9hcmRJbmZvOwogICAgY29uc3QgY3VycmVudFBsYXllckNvbG9yID0gY3VycmVudFBsYXllcjsKICAgIGNvbnN0IGluQ2hlY2sgPSBzZWFyY2hJbmZvLmluQ2hlY2sgfHwKICAgICAgICAgICAgICAgICAgICAoY3VycmVudFBsYXllckNvbG9yID09PSAncmVkJyAmJiBhYkJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8CiAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ2JsYWNrJyAmJiBhYkJvYXJkSW5mby5ibGFja0lzSW5DaGVjayk7CgogICAgY29uc3QgdGVybWluYWxTY29yZSA9IChtYXRlSW5DaGVjaykgPT4gewogICAgICAgIGNvbnN0IGlzSW5pdGlhdG9yV2lubmVyID0gY3VycmVudFBsYXllckNvbG9yICE9PSBzZWFyY2hJbml0aWF0b3I7CiAgICAgICAgY29uc3QgYmFzZVNjb3JlID0gaXNJbml0aWF0b3JXaW5uZXIgPyAxMDAwMDAgOiAtMTAwMDAwOwogICAgICAgIHJldHVybiB7CiAgICAgICAgICAgIHZhbHVlOiBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogKHNlYXJjaERlcHRoIC0gZCkpLAogICAgICAgICAgICBtb3ZlU2VxdWVuY2U6IFtdLAogICAgICAgICAgICB0ZXJtaW5hbDogbWF0ZUluQ2hlY2sgPyAnY2hlY2ttYXRlJyA6ICdzdGFsZW1hdGUnCiAgICAgICAgfTsKICAgIH07CgogICAgLy8g5peg5Lyq5ZCI5rOV552A77ya55u05o6l57uI5bGA77yI5p6B5bCR6KeB77yb6YCa5bi46Iez5bCR5pyJ5bCG55qE6LWw5Yqo77yJCiAgICBpZiAoIXNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdCB8fCBzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3QubGVuZ3RoID09PSAwKSB7CiAgICAgICAgY29uc3QgZ2FtZVN0YXRlID0gYWJCb2FyZEluZm8uZ2FtZVN0YXRlOwogICAgICAgIGlmIChnYW1lU3RhdGUgJiYgKGdhbWVTdGF0ZS5zdGF0dXMgPT09ICdjaGVja21hdGUnIHx8IGdhbWVTdGF0ZS5zdGF0dXMgPT09ICdzdGFsZW1hdGUnKSkgewogICAgICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGdhbWVTdGF0ZS53aW5uZXIgPT09IHNlYXJjaEluaXRpYXRvcjsKICAgICAgICAgICAgY29uc3QgYmFzZVNjb3JlID0gaXNJbml0aWF0b3JXaW5uZXIgPyAxMDAwMDAgOiAtMTAwMDAwOwogICAgICAgICAgICBjb25zdCBzdGVwc0Zyb21Sb290ID0gc2VhcmNoRGVwdGggLSBkOwogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogYmFzZVNjb3JlICsgKGlzSW5pdGlhdG9yV2lubmVyID8gZCA6IHN0ZXBzRnJvbVJvb3QpLCBtb3ZlU2VxdWVuY2U6IFtdIH07CiAgICAgICAgfQogICAgICAgIHJldHVybiB0ZXJtaW5hbFNjb3JlKGluQ2hlY2spOwogICAgfQoKICAgIC8vIOepuuedgOWJquaene+8muS7hSBtYXhpbWl6aW5n77yb5a6M5pW06K+E5Lyw5LiL5L+d5a6I5ZCv55SoCiAgICBpZiAoCiAgICAgICAgU0VBUkNIX0VOQUJMRV9OTVAgJiYKICAgICAgICBhbGxvd051bGwgJiYKICAgICAgICBtYXhpbWl6aW5nICYmCiAgICAgICAgZCA+PSAzICYmCiAgICAgICAgIWluQ2hlY2sgJiYKICAgICAgICBjYW5Eb051bGxNb3ZlKGIsIGN1cnJlbnRQbGF5ZXJDb2xvcikKICAgICkgewogICAgICAgIGNvbnN0IG51bGxSID0gZCA+PSA2ID8gMyA6IDI7CiAgICAgICAgY29uc3QgbnVsbERlcHRoID0gZCAtIDEgLSBudWxsUjsKICAgICAgICBpZiAobnVsbERlcHRoID49IDApIHsKICAgICAgICAgICAgY29uc3QgbnVsbFBsYXllciA9IGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7CiAgICAgICAgICAgIGNvbnN0IG51bGxNYXhpbWl6aW5nID0gbnVsbFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOwogICAgICAgICAgICAvLyDnqbrnnYDkuI3mlLnlj5jlsYDpnaLlk4jluIzvvIzku4XooYzmo4vmlrnlj5jljJbvvIhUVCBrZXkg5ZCrIHNpZGXvvIkKICAgICAgICAgICAgY29uc3QgbnVsbFJlc3VsdCA9IGFscGhhQmV0YSgKICAgICAgICAgICAgICAgIGIsIG51bGxEZXB0aCwgYmV0YSAtIDFlLTYsIGJldGEsIG51bGxNYXhpbWl6aW5nLCBudWxsUGxheWVyLAogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBmYWxzZSwgYm9hcmRIYXNoCiAgICAgICAgICAgICk7CiAgICAgICAgICAgIGlmIChudWxsUmVzdWx0LnZhbHVlID49IGJldGEpIHsKICAgICAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBudWxsUmVzdWx0LnZhbHVlLCBtb3ZlU2VxdWVuY2U6IFtdIH07CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CgogICAgbGV0IG1vdmVzID0gc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0OwoKICAgIGlmICghcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdKSBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gPSAwOwogICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdICs9IG1vdmVzLmxlbmd0aDsKCiAgICBjb25zdCBraWxsZXJzQXREZXB0aCA9IChraWxsZXJNb3Zlc1tkXSB8fCBbbnVsbCwgbnVsbF0pOwogICAgbW92ZXMgPSBzb3J0TW92ZXMobW92ZXMsIGIsIGN1cnJlbnRQbGF5ZXJDb2xvciwgYWJQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGFiQm9hcmRJbmZvLCB7CiAgICAgICAgdHRNb3ZlLAogICAgICAgIGtpbGxlcnM6IGtpbGxlcnNBdERlcHRoCiAgICB9KTsKCiAgICBjb25zdCBzdG9yZVRUID0gKHZhbHVlLCBiZXN0TW92ZSwgbW92ZVNlcXVlbmNlKSA9PiB7CiAgICAgICAgbGV0IGZsYWc7CiAgICAgICAgaWYgKHZhbHVlIDw9IG9yaWdpbmFsQWxwaGEpIGZsYWcgPSAndXBwZXJib3VuZCc7CiAgICAgICAgZWxzZSBpZiAodmFsdWUgPj0gb3JpZ2luYWxCZXRhKSBmbGFnID0gJ2xvd2VyYm91bmQnOwogICAgICAgIGVsc2UgZmxhZyA9ICdleGFjdCc7CiAgICAgICAgdHJhbnNwb3NpdGlvblRhYmxlLnN0b3JlKHR0S2V5LCBkLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUsIG1vdmVTZXF1ZW5jZSk7CiAgICB9OwoKICAgIGxldCBiZXN0RXZhbCA9IG1heGltaXppbmcgPyAtSW5maW5pdHkgOiBJbmZpbml0eTsKICAgIGxldCBiZXN0TW92ZSA9IG51bGw7CiAgICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOwogICAgbGV0IGxlZ2FsTW92ZXNGb3VuZCA9IDA7CgogICAgZm9yIChsZXQgbW92ZUluZGV4ID0gMDsgbW92ZUluZGV4IDwgbW92ZXMubGVuZ3RoOyBtb3ZlSW5kZXgrKykgewogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1ttb3ZlSW5kZXhdOwogICAgICAgIGNvbnN0IGlzQ2FwdHVyZSA9ICEhYlttb3ZlLnRvLnJdW21vdmUudG8uY107CiAgICAgICAgY29uc3QgaXNUVE1vdmUgPSB0dE1vdmUgJiYgaXNTYW1lTW92ZShtb3ZlLCB0dE1vdmUpOwogICAgICAgIGNvbnN0IGlzS2lsbGVyID0KICAgICAgICAgICAgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzQXREZXB0aFswXSkgfHwKICAgICAgICAgICAgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzQXREZXB0aFsxXSk7CgogICAgICAgIC8vIExNUu+8mumdoOWQjueahOWuiemdmeedgOazlemZjea3sSAx77yI5a6M5pW06K+E5Lyw5LiL5L+d5a6I77yJCiAgICAgICAgLy8gbW92ZUluZGV4IOWQq+S8quWQiOazleW6j++8m+mdnuazleedgOi3s+i/h+WQjueVpeWBj+S/neWuiO+8iOWwkemZjea3se+8ie+8jOS4jeW9seWTjeato+ehruaApwogICAgICAgIGxldCByZWR1Y3Rpb24gPSAwOwogICAgICAgIGlmICgKICAgICAgICAgICAgU0VBUkNIX0VOQUJMRV9MTVIgJiYKICAgICAgICAgICAgZCA+PSA0ICYmCiAgICAgICAgICAgIG1vdmVJbmRleCA+PSA0ICYmCiAgICAgICAgICAgICFpbkNoZWNrICYmCiAgICAgICAgICAgICFpc0NhcHR1cmUgJiYKICAgICAgICAgICAgIWlzVFRNb3ZlICYmCiAgICAgICAgICAgICFpc0tpbGxlcgogICAgICAgICkgewogICAgICAgICAgICByZWR1Y3Rpb24gPSAxOwogICAgICAgIH0KCiAgICAgICAgY29uc3QgbW92aW5nUGllY2UgPSBiW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107CiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlTW92ZShiLCBtb3ZlLmZyb20sIG1vdmUudG8pOwogICAgICAgIGlmIChTRUFSQ0hfREVGRVJfTEVHQUxJVFkgJiYgbGVhdmVzT3duS2luZ1Vuc2FmZShiLCBjdXJyZW50UGxheWVyQ29sb3IpKSB7CiAgICAgICAgICAgIHVubWFrZU1vdmUoYiwgbW92ZS5mcm9tLCBtb3ZlLnRvLCBjYXB0dXJlZCk7CiAgICAgICAgICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkKys7CiAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsKICAgICAgICB2ZXJpZnlCb2FyZEhhc2goYiwgbmV4dEhhc2gpOwogICAgICAgIGxlZ2FsTW92ZXNGb3VuZCsrOwogICAgICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQrKzsKCiAgICAgICAgY29uc3QgbmV4dFBsYXllciA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOwoKICAgICAgICBsZXQgcmVzdWx0OwogICAgICAgIGlmIChyZWR1Y3Rpb24gPiAwKSB7CiAgICAgICAgICAgIGNvbnN0IHJlZHVjZWREZXB0aCA9IE1hdGgubWF4KDAsIGQgLSAxIC0gcmVkdWN0aW9uKTsKICAgICAgICAgICAgcmVzdWx0ID0gYWxwaGFCZXRhKAogICAgICAgICAgICAgICAgYiwgcmVkdWNlZERlcHRoLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHRydWUsIG5leHRIYXNoCiAgICAgICAgICAgICk7CiAgICAgICAgICAgIGNvbnN0IG5lZWRSZXNlYXJjaCA9IG1heGltaXppbmcKICAgICAgICAgICAgICAgID8gcmVzdWx0LnZhbHVlID4gYWxwaGEKICAgICAgICAgICAgICAgIDogcmVzdWx0LnZhbHVlIDwgYmV0YTsKICAgICAgICAgICAgaWYgKG5lZWRSZXNlYXJjaCkgewogICAgICAgICAgICAgICAgcmVzdWx0ID0gYWxwaGFCZXRhKAogICAgICAgICAgICAgICAgICAgIGIsIGQgLSAxLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsCiAgICAgICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaAogICAgICAgICAgICAgICAgKTsKICAgICAgICAgICAgfQogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIHJlc3VsdCA9IGFscGhhQmV0YSgKICAgICAgICAgICAgICAgIGIsIGQgLSAxLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHRydWUsIG5leHRIYXNoCiAgICAgICAgICAgICk7CiAgICAgICAgfQoKICAgICAgICB1bm1ha2VNb3ZlKGIsIG1vdmUuZnJvbSwgbW92ZS50bywgY2FwdHVyZWQpOwoKICAgICAgICBpZiAobWF4aW1pemluZykgewogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlID4gYmVzdEV2YWwpIHsKICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOwogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOwogICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlLCAuLi5yZXN1bHQubW92ZVNlcXVlbmNlXTsKICAgICAgICAgICAgfQogICAgICAgICAgICBhbHBoYSA9IE1hdGgubWF4KGFscGhhLCByZXN1bHQudmFsdWUpOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPCBiZXN0RXZhbCkgewogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7CiAgICAgICAgICAgICAgICBiZXN0TW92ZSA9IG1vdmU7CiAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmUsIC4uLnJlc3VsdC5tb3ZlU2VxdWVuY2VdOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGJldGEgPSBNYXRoLm1pbihiZXRhLCByZXN1bHQudmFsdWUpOwogICAgICAgIH0KCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIHsKICAgICAgICAgICAgaWYgKCFwZXJmU3RhdHMuY3V0b2Zmc1tkXSkgcGVyZlN0YXRzLmN1dG9mZnNbZF0gPSAwOwogICAgICAgICAgICBwZXJmU3RhdHMuY3V0b2Zmc1tkXSsrOwogICAgICAgICAgICBpZiAoIWlzQ2FwdHVyZSkgewogICAgICAgICAgICAgICAgc3RvcmVLaWxsZXJNb3ZlKGQsIG1vdmUpOwogICAgICAgICAgICAgICAgYWRkSGlzdG9yeVNjb3JlKG1vdmUsIGQpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgIH0KCiAgICAvLyDlu7bov5/lkIjms5XmgKfvvJrkvKrlkIjms5XpnZ7nqbrkvYbml6DkuIDlkIjms5Ug4oaSIOWwhuatuy/lm7Dmr5kKICAgIGlmIChTRUFSQ0hfREVGRVJfTEVHQUxJVFkgJiYgbGVnYWxNb3Zlc0ZvdW5kID09PSAwKSB7CiAgICAgICAgcmV0dXJuIHRlcm1pbmFsU2NvcmUoaW5DaGVjayk7CiAgICB9CgogICAgc3RvcmVUVChiZXN0RXZhbCwgYmVzdE1vdmUsIGJlc3RNb3ZlU2VxdWVuY2UpOwogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UgfTsKfTsKCi8vIGV4YWN0Um9vdFNjb3JlczogdHJ1ZT1BbmFseXNpcyDlhajmoLnnsr7noa7liIbvvJtmYWxzZT3lr7nlvIjmoIflh4YgUFZT77yIZmFpbC1sb3cg5LiN5Zue5pCc77yJCmNvbnN0IGdldEJlc3RNb3ZlID0gKGJvYXJkLCB0dXJuLCBkZXB0aCA9IDYsIHJhbmRvbW5lc3MgPSAwLCBwbHkgPSAwLCBlbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzID0gZmFsc2UpID0+IHsKICBjb25zdCB0aW1lTGltaXQgPSA1MDAwOwoKICAvLyBGaXJzdCB0cnkgdG8gZ2V0IG1vdmUgZnJvbSBvcGVuaW5nIGJvb2sKICBjb25zdCBib29rTW92ZSA9IG9wZW5pbmdCb29rLmdldEJvb2tNb3ZlKGJvYXJkLCBwbHkpOwogIAogIGlmIChib29rTW92ZSkgewogICAgLy8gQ2hlY2sgaWYgYm9va01vdmUgaXMgdmFsaWQgZm9yIGN1cnJlbnQgYm9hcmQKICAgIGlmIChib29rTW92ZS5mcm9tICYmIGJvb2tNb3ZlLnRvICYmIAogICAgICAgIHR5cGVvZiBib29rTW92ZS5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBib29rTW92ZS5mcm9tLmMgPT09ICdudW1iZXInICYmCiAgICAgICAgdHlwZW9mIGJvb2tNb3ZlLnRvLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBib29rTW92ZS50by5jID09PSAnbnVtYmVyJykgewogICAgICAKICAgICAgY29uc3QgbW92aW5nUGllY2UgPSBib2FyZFtib29rTW92ZS5mcm9tLnJdW2Jvb2tNb3ZlLmZyb20uY107CiAgICAgIAogICAgICBpZiAobW92aW5nUGllY2UgJiYgbW92aW5nUGllY2UuY29sb3IgPT09IHR1cm4pIHsKICAgICAgICAvLyBWZXJpZnkgbW92ZSBpcyB2YWxpZAogICAgICAgIGNvbnN0IHZhbGlkRGVzdGluYXRpb25zID0gZ2V0VmFsaWRNb3Zlcyhib2FyZCwgYm9va01vdmUuZnJvbSk7CiAgICAgICAgY29uc3QgaXNWYWxpZCA9IHZhbGlkRGVzdGluYXRpb25zLnNvbWUoZGVzdCA9PiBkZXN0LnIgPT09IGJvb2tNb3ZlLnRvLnIgJiYgZGVzdC5jID09PSBib29rTW92ZS50by5jKTsKICAgICAgICAKICAgICAgICBpZiAoaXNWYWxpZCkgewogICAgICAgICAgcmV0dXJuIHsgYmVzdE1vdmU6IGJvb2tNb3ZlLCBzZWNvbmRCZXN0TW92ZTogbnVsbCwgbW92ZVNlcXVlbmNlOiBbXSwgc2Vjb25kTW92ZVNlcXVlbmNlOiBbXSwgYmVzdE1vdmVTY29yZTogMCwgc2Vjb25kQmVzdE1vdmVTY29yZTogMCwgYWxsTW92ZXNXaXRoU2NvcmVzOiBbXSB9OwogICAgICAgIH0KICAgICAgfQogICAgfQogIH0KCiAgLy8g5qC56IqC54K577ya6L+t5Luj5Yqg5rexICsgUFZT77ybVFQva2lsbGVyL2hpc3Rvcnkg6Leo5rex5bqm5L+d55WZ77yI5LuF5byA5bGA5riF56m65LiA5qyh77yJCiAgcmVzZXRQZXJmU3RhdHMoKTsKICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpOwogIHRyYW5zcG9zaXRpb25UYWJsZS5yZXNldFN0YXRzKCk7CiAgdHJhbnNwb3NpdGlvblRhYmxlLmNsZWFyKCk7CiAgY2xlYXJFdmFsQ2FjaGUoKTsKICBjb25zdCBtYXhEZXB0aCA9IE1hdGgubWF4KDEsIGRlcHRoIHwgMCk7CiAgcmVzZXRTZWFyY2hIZXVyaXN0aWNzKG1heERlcHRoKTsKICBzeW5jR2VuZXJhbFBvc0NhY2hlKGJvYXJkKTsKCiAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoYm9hcmQpOwogIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOwoKICBjb25zdCByb290RXZhbFJlc3VsdCA9IGV2YWx1YXRlQm9hcmQoYm9hcmQsIGZhbHNlLCB0dXJuLCAwLCB0dXJuLCBnYW1lU3RhZ2UpOwogIGNvbnN0IHJvb3RQaWVjZXNJbmZvID0gcm9vdEV2YWxSZXN1bHQucGllY2VzSW5mbzsKICBjb25zdCByb290Qm9hcmRJbmZvID0gcm9vdEV2YWxSZXN1bHQuYm9hcmRJbmZvOwoKICAvLyDmlLbpm4bmoLnoioLngrnotbDms5XvvIjlj6rlgZrkuIDmrKHvvInvvJvmnKrooqvlsIbml7bov4fmu6TpgIHlkIMKICBsZXQgcm9vdE1vdmVzID0gW107CiAgY29uc3Qgcm9vdEluQ2hlY2sgPSAodHVybiA9PT0gJ3JlZCcgJiYgcm9vdEJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8CiAgICAgICAgICAgICAgICAgICAgICAodHVybiA9PT0gJ2JsYWNrJyAmJiByb290Qm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKTsKCiAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsKICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7CiAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsKICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOwogICAgICAgIGNvbnN0IHZhbGlkRGVzdGluYXRpb25zID0gZ2V0VmFsaWRNb3Zlcyhib2FyZCwgeyByLCBjIH0pOwogICAgICAgIHZhbGlkRGVzdGluYXRpb25zLmZvckVhY2godG8gPT4gewogICAgICAgICAgY29uc3QgaXNBY2NlcHRhYmxlID0gcm9vdEluQ2hlY2sgfHwgaXNQb3NpdGlvbkFjY2VwdGFibGUoYm9hcmQsIHsgciwgYyB9LCB0bywgdHVybiwgcm9vdEJvYXJkSW5mbywgcm9vdFBpZWNlc0luZm8sIHBpZWNlLCBnYW1lU3RhZ2UpOwogICAgICAgICAgaWYgKGlzQWNjZXB0YWJsZSkgewogICAgICAgICAgICByb290TW92ZXMucHVzaCh7IGZyb206IHsgciwgYyB9LCB0bywgc2NvcmU6IDAsIG1vdmVTZXF1ZW5jZTogW10gfSk7CiAgICAgICAgICB9CiAgICAgICAgfSk7CiAgICAgIH0KICAgIH0KICB9CgogIGlmIChyb290TW92ZXMubGVuZ3RoID09PSAwKSB7CiAgICByZXR1cm4gewogICAgICBiZXN0TW92ZTogbnVsbCwKICAgICAgc2Vjb25kQmVzdE1vdmU6IG51bGwsCiAgICAgIG1vdmVTZXF1ZW5jZTogW10sCiAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogW10sCiAgICAgIGJlc3RNb3ZlU2NvcmU6IDAsCiAgICAgIHNlY29uZEJlc3RNb3ZlU2NvcmU6IDAsCiAgICAgIGFsbE1vdmVzV2l0aFNjb3JlczogW10KICAgIH07CiAgfQoKICBjb25zdCBzb3J0Um9vdE1vdmVzQnlTY29yZSA9IChtb3ZlcykgPT4gewogICAgbW92ZXMuc29ydCgoYSwgYikgPT4gewogICAgICBjb25zdCBzY29yZURpZmYgPSBiLnNjb3JlIC0gYS5zY29yZTsKICAgICAgaWYgKE1hdGguYWJzKHNjb3JlRGlmZikgPCAxZS02KSB7CiAgICAgICAgaWYgKGEuc2NvcmUgPiAwKSB7CiAgICAgICAgICByZXR1cm4gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYi5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsKICAgICAgICB9CiAgICAgICAgaWYgKGEuc2NvcmUgPCAwKSB7CiAgICAgICAgICByZXR1cm4gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYS5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuIDA7CiAgICAgIH0KICAgICAgcmV0dXJuIHNjb3JlRGlmZjsKICAgIH0pOwogIH07CgogIGNvbnN0IHByb21vdGVSb290TW92ZSA9IChtb3ZlcywgcHJlZmVycmVkKSA9PiB7CiAgICBpZiAoIXByZWZlcnJlZCkgcmV0dXJuOwogICAgY29uc3QgaWR4ID0gbW92ZXMuZmluZEluZGV4KChtKSA9PiBpc1NhbWVNb3ZlKG0sIHByZWZlcnJlZCkpOwogICAgaWYgKGlkeCA+IDApIHsKICAgICAgY29uc3QgW2hpdF0gPSBtb3Zlcy5zcGxpY2UoaWR4LCAxKTsKICAgICAgbW92ZXMudW5zaGlmdChoaXQpOwogICAgfQogIH07CgogIGNvbnN0IHdvcmtCb2FyZCA9IGJvYXJkLm1hcCgocm93KSA9PiBbLi4ucm93XSk7CiAgY29uc3QgTlVMTF9XSU5ET1dfRVBTID0gMWUtNjsKICBjb25zdCBuZXh0VHVybiA9IHR1cm4gPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogIC8vIOagueWxgOmdouWTiOW4jOWPqueul+S4gOasoe+8m+WinumHj+aooeW8j+aVtOajteaQnOe0ouagkeeUseatpOa0vueUnwogIGNvbnN0IHJvb3RIYXNoID0gem9icmlzdEhhc2hlci5oYXNoKGJvYXJkKTsKICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOwogIGNvbnN0IHJvb3RUVEtleSA9IFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUCiAgICA/IHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChyb290SGFzaCwgdHVybikKICAgIDogYCR7cm9vdEhhc2h9OiR7dHVybn1gOwoKICBjb25zb2xlLmxvZygKICAgIGBTdGFydGluZyBpdGVyYXRpdmUgZGVlcGVuaW5nIHwgdHVybjogJHt0dXJufSwgbWF4RGVwdGg6ICR7bWF4RGVwdGh9LCBpbmNyWm9icmlzdDogJHtTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVH0sIGxlYWZBdHRhY2tCaXRzOiAke1NFQVJDSF9MRUFGX0FUVEFDS19CSVRTfSwgdGltZUxpbWl0OiAke3RpbWVMaW1pdH1tcywgZW5hYmxlVGltZUxpbWl0OiAke2VuYWJsZVRpbWVMaW1pdH1gCiAgKTsKCiAgbGV0IGNvbXBsZXRlZERlcHRoID0gMDsKCiAgZm9yIChsZXQgY3VycmVudERlcHRoID0gMTsgY3VycmVudERlcHRoIDw9IG1heERlcHRoOyBjdXJyZW50RGVwdGgrKykgewogICAgaWYgKGVuYWJsZVRpbWVMaW1pdCAmJiBjb21wbGV0ZWREZXB0aCA+IDAgJiYgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA+IHRpbWVMaW1pdCkgewogICAgICBjb25zb2xlLmxvZyhgSUQgc3RvcHBlZCBiZWZvcmUgZGVwdGggJHtjdXJyZW50RGVwdGh9IGR1ZSB0byB0aW1lIGxpbWl0IChsYXN0IGNvbXBsZXRlZD0ke2NvbXBsZXRlZERlcHRofSlgKTsKICAgICAgYnJlYWs7CiAgICB9CgogICAgLy8g5rWF5bGC5pyA5L2z552AICsgVFQg552A5o6S5Yiw5pyA5YmN77yM5L6b5pys5bGCIFBWUyDnrKzkuIDnnYDlhajnqpfkvb/nlKgKICAgIGNvbnN0IHR0RW50cnkgPSB0cmFuc3Bvc2l0aW9uVGFibGUucmV0cmlldmUocm9vdFRUS2V5KTsKICAgIGNvbnN0IHR0TW92ZSA9IHR0RW50cnkgJiYgdHRFbnRyeS5iZXN0TW92ZSA/IHR0RW50cnkuYmVzdE1vdmUgOiBudWxsOwogICAgY29uc3QgcHJldkJlc3QgPSByb290TW92ZXNbMF07CiAgICBzb3J0TW92ZXMocm9vdE1vdmVzLCBib2FyZCwgdHVybiwgcm9vdFBpZWNlc0luZm8sIGdhbWVTdGFnZSwgcm9vdEJvYXJkSW5mbywgewogICAgICB0dE1vdmUsCiAgICAgIGtpbGxlcnM6IGtpbGxlck1vdmVzW01hdGgubWF4KDAsIGN1cnJlbnREZXB0aCAtIDEpXSB8fCBbbnVsbCwgbnVsbF0KICAgIH0pOwogICAgLy8g5LiK5LiA5bGC5pyA5L2z552A5pS+56ys5LiA77yI5pyA5ZCOIHByb21vdGXvvInvvIzkv53or4HmnKzlsYIgUFZTIOmmluedgOWFqOeql+WRveS4reeDrei3r+W+hAogICAgcHJvbW90ZVJvb3RNb3ZlKHJvb3RNb3ZlcywgdHRNb3ZlKTsKICAgIHByb21vdGVSb290TW92ZShyb290TW92ZXMsIHByZXZCZXN0KTsKCiAgICBjb25zdCB1c2VFeGFjdFJvb3QgPSBleGFjdFJvb3RTY29yZXMgJiYgY3VycmVudERlcHRoID09PSBtYXhEZXB0aDsKICAgIGxldCByb290QWxwaGEgPSAtSW5maW5pdHk7CgogICAgZm9yIChsZXQgaSA9IDA7IGkgPCByb290TW92ZXMubGVuZ3RoOyBpKyspIHsKICAgICAgY29uc3QgaXRlbSA9IHJvb3RNb3Zlc1tpXTsKICAgICAgY29uc3QgbW92aW5nUGllY2UgPSB3b3JrQm9hcmRbaXRlbS5mcm9tLnJdW2l0ZW0uZnJvbS5jXTsKICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlTW92ZSh3b3JrQm9hcmQsIGl0ZW0uZnJvbSwgaXRlbS50byk7CiAgICAgIGNvbnN0IGNoaWxkSGFzaCA9IGNoaWxkQm9hcmRIYXNoKHJvb3RIYXNoLCBpdGVtLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOwogICAgICB2ZXJpZnlCb2FyZEhhc2god29ya0JvYXJkLCBjaGlsZEhhc2gpOwoKICAgICAgbGV0IGFscGhhQmV0YVJlc3VsdDsKICAgICAgbGV0IHNjb3JlSXNFeGFjdCA9IHRydWU7CiAgICAgIGlmIChpID09PSAwIHx8IHJvb3RBbHBoYSA9PT0gLUluZmluaXR5KSB7CiAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gYWxwaGFCZXRhKAogICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LAogICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoCiAgICAgICAgKTsKICAgICAgfSBlbHNlIHsKICAgICAgICBjb25zdCBwcm9iZSA9IGFscGhhQmV0YSgKICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwKICAgICAgICAgIHJvb3RBbHBoYSwgcm9vdEFscGhhICsgTlVMTF9XSU5ET1dfRVBTLAogICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoCiAgICAgICAgKTsKICAgICAgICBpZiAocHJvYmUudmFsdWUgPiByb290QWxwaGEpIHsKICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgKICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCByb290QWxwaGEsIEluZmluaXR5LAogICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCB0cnVlLCBjaGlsZEhhc2gKICAgICAgICAgICk7CiAgICAgICAgfSBlbHNlIGlmICh1c2VFeGFjdFJvb3QpIHsKICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgKICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LAogICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCB0cnVlLCBjaGlsZEhhc2gKICAgICAgICAgICk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgIC8vIGZhaWwtbG9377ya5o6i5rWL5YiG5Y+q5piv5LiK55WM77yM5LiN6IO95b2T57K+56Gu5YiG5YaZ5YWl77yI5ZCm5YiZIElEIOS4i+WxguaOkuW6j+iiq+axoeafk++8jOaYk+WPjeWkjei1sOeCru+8iQogICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gcHJvYmU7CiAgICAgICAgICBzY29yZUlzRXhhY3QgPSBmYWxzZTsKICAgICAgICB9CiAgICAgIH0KCiAgICAgIHVubWFrZU1vdmUod29ya0JvYXJkLCBpdGVtLmZyb20sIGl0ZW0udG8sIGNhcHR1cmVkKTsKCiAgICAgIGlmIChzY29yZUlzRXhhY3QpIHsKICAgICAgICBpdGVtLnNjb3JlID0gYWxwaGFCZXRhUmVzdWx0LnZhbHVlOwogICAgICAgIGl0ZW0ubW92ZVNlcXVlbmNlID0gW3sgZnJvbTogaXRlbS5mcm9tLCB0bzogaXRlbS50byB9LCAuLi4oYWxwaGFCZXRhUmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldOwogICAgICAgIGlmIChpdGVtLnNjb3JlID4gcm9vdEFscGhhKSB7CiAgICAgICAgICByb290QWxwaGEgPSBpdGVtLnNjb3JlOwogICAgICAgIH0KICAgICAgfSBlbHNlIGlmIChpdGVtLnNjb3JlID4gcm9vdEFscGhhKSB7CiAgICAgICAgLy8g5L+d55WZ5LiK5LiA5bGC5YiG5pWw77yb6Iul5LuN6auY5LqO5b2T5YmNIM6x77yI5byC5bi477yJ77yM55Wl6ZmN5Lul5YWN5oyk5o6J55yf5pyA5LyYCiAgICAgICAgaXRlbS5zY29yZSA9IHJvb3RBbHBoYSAtIDFlLTM7CiAgICAgIH0KICAgIH0KCiAgICBzb3J0Um9vdE1vdmVzQnlTY29yZShyb290TW92ZXMpOwogICAgY29tcGxldGVkRGVwdGggPSBjdXJyZW50RGVwdGg7CgogICAgLy8g5oqK5pys5bGC5pyA5L2z552A5YaZ5YWlIFRU77yM5L6b5pu05rex5LiA5bGC5qC55o6S5bqPCiAgICB0cmFuc3Bvc2l0aW9uVGFibGUuc3RvcmUoCiAgICAgIHJvb3RUVEtleSwKICAgICAgY3VycmVudERlcHRoLAogICAgICByb290TW92ZXNbMF0uc2NvcmUsCiAgICAgICdleGFjdCcsCiAgICAgIHJvb3RNb3Zlc1swXSwKICAgICAgcm9vdE1vdmVzWzBdLm1vdmVTZXF1ZW5jZSB8fCBbXQogICAgKTsKCiAgICBjb25zb2xlLmxvZygKICAgICAgYElEIGRlcHRoICR7Y3VycmVudERlcHRofS8ke21heERlcHRofSBkb25lIHwgYmVzdD0ke0pTT04uc3RyaW5naWZ5KHJvb3RNb3Zlc1swXS5mcm9tKX0tPiR7SlNPTi5zdHJpbmdpZnkocm9vdE1vdmVzWzBdLnRvKX0gc2NvcmU9JHtyb290TW92ZXNbMF0uc2NvcmV9IGVsYXBzZWQ9JHtEYXRlLm5vdygpIC0gc3RhcnRUaW1lfW1zYAogICAgKTsKICB9CgogIGNvbnN0IGJlc3RNb3ZlID0gcm9vdE1vdmVzWzBdIHx8IG51bGw7CiAgY29uc3Qgc2Vjb25kQmVzdE1vdmUgPSByb290TW92ZXMubGVuZ3RoID4gMSA/IHJvb3RNb3Zlc1sxXSA6IG51bGw7CiAgY29uc3QgYmVzdE1vdmVTZXF1ZW5jZSA9IGJlc3RNb3ZlID8gKGJlc3RNb3ZlLm1vdmVTZXF1ZW5jZSB8fCBbXSkgOiBbXTsKICBjb25zdCBzZWNvbmRNb3ZlU2VxdWVuY2UgPSBzZWNvbmRCZXN0TW92ZSA/IChzZWNvbmRCZXN0TW92ZS5tb3ZlU2VxdWVuY2UgfHwgW10pIDogW107CiAgY29uc3QgYmVzdE1vdmVTY29yZSA9IGJlc3RNb3ZlID8gYmVzdE1vdmUuc2NvcmUgOiAwOwogIGNvbnN0IHNlY29uZEJlc3RNb3ZlU2NvcmUgPSBzZWNvbmRCZXN0TW92ZSA/IHNlY29uZEJlc3RNb3ZlLnNjb3JlIDogMDsKCiAgY29uc3QgYWxsTW92ZXNXaXRoU2NvcmVzID0gcm9vdE1vdmVzLm1hcCgobW92ZUluZm8pID0+ICh7CiAgICBtb3ZlOiB7CiAgICAgIGZyb206IG1vdmVJbmZvLmZyb20sCiAgICAgIHRvOiBtb3ZlSW5mby50bwogICAgfSwKICAgIHNjb3JlOiBtb3ZlSW5mby5zY29yZSwKICAgIG1vdmVTZXF1ZW5jZTogbW92ZUluZm8ubW92ZVNlcXVlbmNlIHx8IFtdCiAgfSkpOwoKICByZXR1cm4gewogICAgYmVzdE1vdmUsCiAgICBzZWNvbmRCZXN0TW92ZSwKICAgIG1vdmVTZXF1ZW5jZTogYmVzdE1vdmVTZXF1ZW5jZSwKICAgIHNlY29uZE1vdmVTZXF1ZW5jZSwKICAgIGJlc3RNb3ZlU2NvcmUsCiAgICBzZWNvbmRCZXN0TW92ZVNjb3JlLAogICAgYWxsTW92ZXNXaXRoU2NvcmVzLAogICAgY29tcGxldGVkRGVwdGgKICB9Owp9OwoKLy8gLS0tIFdPUktFUiBMSVNURU5FUiAo57uf5LiA5raI5oGv5aSE55CGKSAtLS0K';
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

