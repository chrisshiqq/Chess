
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
    const [blackIsAuto, setBlackIsAuto] = useState<boolean>(false);
    const redIsAutoRef = useRef<boolean>(false);
    const blackIsAutoRef = useRef<boolean>(false);
    
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

    const [aiDepth, setAiDepth] = useState<number>(4);
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

            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'gameState') {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve(e.data.state);
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'checkGameState',
                payload: { board, turn }
            });
        });
    }).current;

    const workerIsCheck = useRef((board: Board, color: Color): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'check') {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve(e.data.isCheck);
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'isCheck',
                payload: { board, color }
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
                payload: { board, turn: color, depth, randomness, ply, gameId, openingBookEnabled, enableTimeLimit }
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovDQoNCi8vIOaji+ebmOW4uOmHj+WumuS5iQ0KY29uc3QgUk9XUyA9IDEwOw0KY29uc3QgQ09MUyA9IDk7DQoNCi8vIOaji+WtkOexu+Wei+WumuS5iQ0KY29uc3QgUElFQ0VfVFlQRVMgPSB7DQogICAgR0VORVJBTDogJ2dlbmVyYWwnLA0KICAgIENIQVJJT1Q6ICdjaGFyaW90JywNCiAgICBDQU5OT046ICdjYW5ub24nLA0KICAgIEhPUlNFOiAnaG9yc2UnLA0KICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLA0KICAgIEFEVklTT1I6ICdhZHZpc29yJywNCiAgICBTT0xESUVSOiAnc29sZGllcicNCn07DQoNCi8vIOadkOaWmeWAvOadg+mHjemFjee9rg0KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGdlbmVyYWw6IDEwMDAwLCAgLy8g5bCGL+W4hQ0KICAgIGNoYXJpb3Q6IDkwMCwgICAgIC8vIOi9pg0KICAgIGNhbm5vbjogew0KICAgICAgICBlYXJseTogNDUwLCAgICAvLyDlvIDlsYDpmLbmrrUNCiAgICAgICAgbWlkOiA0MDAsICAgICAgLy8g5Lit5bGA6Zi25q61DQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQ0KICAgIH0sICAgICAgICAgICAgICAgIC8vIOeCrg0KICAgIGhvcnNlOiB7DQogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDQ1MCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsDQogICAgZWxlcGhhbnQ6IDIwMCwgICAgLy8g6LGhL+ebuA0KICAgIGFkdmlzb3I6IDIwMCwgICAgIC8vIOWjqy/ku5UNCiAgICBzb2xkaWVyOiB7DQogICAgICAgIGVhcmx5OiAxMDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDIwMCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSAgICAgICAgICAgICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIOaji+WtkOS7t+WAvOadg+mHjemFjee9rg0KbGV0IFZBTFVFX1dFSUdIVFMgPSB7DQogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQ0KICAgIC8vcG9zaXRpb246IDAuMiwgICAvLyDkvY3nva7lgLzmnYPph40NCiAgICAvL3RocmVhdDogMC4xNSwgICAgLy8g5aiB6IOB5YC85p2D6YeNDQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQ0KICAgIC8vc2FmZXR5OiAwLjEsICAgICAvLyDlronlhajlgLzmnYPph40NCiAgICAvL21vYmlsaXR5OiAwLjA1ICAgLy8g5py65Yqo5YC85p2D6YeNDQoNCiAgICBtYXRlcmlhbDogMSwgICAgLy8g5p2Q5paZ5YC85p2D6YeNDQogICAgcG9zaXRpb246IDEsICAgIC8vIOS9jee9ruWAvOadg+mHjQ0KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQ0KICAgIHRhY3RpYzogMSwgICAgICAvLyDmiJjmnK/lgLzmnYPph40NCiAgICBzYWZldHk6IDEsICAgICAgLy8g5a6J5YWo5YC85p2D6YeNDQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQ0KfTsNCg0KLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XDQpjb25zdCBFVkFMVUFUSU9OX1BBUkFNRVRFUlMgPSB7DQogICAgLy8g5py65Yqo5YC85Y+C5pWwDQogICAgbW9iaWxpdHk6IHsNCiAgICAgICAgYmFzZU1vdmVWYWx1ZTogMSwgICAgICAvLyDln7rnoYDnp7vliqjku7flgLwNCiAgICB9LA0KICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQ0KICAgIGNoZWNrOiB7DQogICAgICAgIGJvbnVzOiA4MA0KICAgIH0sDQogICAgLy8g5biu5Yqp5YWz57O75Y+C5pWwDQogICAgYXNzaXN0OiB7DQogICAgICAgIC8vY2Fubm9uU2NyZWVuVmFsdWU6IDQwICAvLyDngq7mnrbku7flgLwNCiAgICAgICAgY2Fubm9uU2NyZWVuVmFsdWU6IDAgIC8vIOeCruaetuS7t+WAvA0KICAgIH0sDQogICAgLy8g6Zi75oyh5YWz57O75Y+C5pWwDQogICAgYmxvY2s6IHsNCiAgICAgICAgLy9lbmVteUNoYXJpb3RCbG9ja1ZhbHVlOiAyMCwgICAgIC8vIOmYu+aMoeWvueaWuei9puS7t+WAvA0KICAgICAgICAvL2VuZW15SG9yc2VCbG9ja1ZhbHVlOiAxNSwgICAgICAgLy8g5Yir5a+55pa56ams6IW/5Lu35YC8DQogICAgICAgIC8vZW5lbXlFbGVwaGFudEJsb2NrVmFsdWU6IDEwLCAgICAvLyDloLXloZ7lr7nmlrnosaHnnLzku7flgLwNCiAgICAgICAgLy9hbGx5Q2hhcmlvdEJsb2NrUGVuYWx0eTogMjAsICAgIC8vIOmYu+aMoeW3seaWuei9puaDqee9mg0KICAgICAgICAvL2FsbHlIb3JzZUJsb2NrUGVuYWx0eTogMTUsICAgICAgLy8g5Yir5bex5pa56ams6IW/5oOp572aDQogICAgICAgIC8vYWxseUVsZXBoYW50QmxvY2tQZW5hbHR5OiAxMCAgICAvLyDloLXloZ7lt7HmlrnosaHnnLzmg6nnvZoNCg0KICAgICAgICBlbmVteUNoYXJpb3RCbG9ja1ZhbHVlOiAwLCAgICAgLy8g6Zi75oyh5a+55pa56L2m5Lu35YC8DQogICAgICAgIGVuZW15SG9yc2VCbG9ja1ZhbHVlOiAwLCAgICAgICAvLyDliKvlr7nmlrnpqazohb/ku7flgLwNCiAgICAgICAgZW5lbXlFbGVwaGFudEJsb2NrVmFsdWU6IDAsICAgIC8vIOWgteWhnuWvueaWueixoeecvOS7t+WAvA0KICAgICAgICBhbGx5Q2hhcmlvdEJsb2NrUGVuYWx0eTogMCwgICAgLy8g6Zi75oyh5bex5pa56L2m5oOp572aDQogICAgICAgIGFsbHlIb3JzZUJsb2NrUGVuYWx0eTogMCwgICAgICAvLyDliKvlt7Hmlrnpqazohb/mg6nnvZoNCiAgICAgICAgYWxseUVsZXBoYW50QmxvY2tQZW5hbHR5OiAwICAgIC8vIOWgteWhnuW3seaWueixoeecvOaDqee9mg0KICAgIH0NCn07DQoNCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rg0KY29uc3QgUE9TSVRJT05fVEFCTEVTID0gew0KICAgIC8vIOWFtS/ljZLkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBzb2xkaWVyOiBbDQogICAgICAgIFswLCA1LCAxMCwgMTUsIDIwLCAxNSwgMTAsIDUsIDBdLA0KICAgICAgICBbNSwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgY2hhcmlvdDogWw0KICAgICAgICBbNSwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDEwLCA1LCAxNSwgMCwgMTUsIDUsIDEwLCAxMF0sDQogICAgICAgIFswLCAxMCwgNSwgNSwgNSwgNSwgMTAsIDUsIDBdDQogICAgXSwNCiAgICAvLyDpqazkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBob3JzZTogWw0KICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgICAgICAgWzAsIDUsIDI1LCAxMCwgMTAsIDEwLCAyNSwgNSwgMF0sDQogICAgICAgIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sDQogICAgICAgIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMjUsIDIwLCAwLCAyMCwgMjUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgICAgICAgWzUsIDAsIDUsIDUsIDAsIDUsIDUsIDAsIDVdLA0KICAgICAgICBbMCwgMCwgMCwgNSwgLTIwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDngq7kvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBjYW5ub246IFsNCiAgICAgICAgWzEwLCAyMCwgMTUsIDEwLCAwLCAxMCwgMTUsIDIwLCAxMF0sDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLA0KICAgICAgICBbNSwgNSwgMTUsIDUsIDI1LCA1LCAxNSwgNSwgNV0sDQogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLA0KICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogICAgICAgIFsxMCwgMTAsIDE1LCAyMCwgMzAsIDIwLCAxNSwgMTAsIDEwXSwgDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBlbGVwaGFudDogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g5aOr5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgYWR2aXNvcjogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCA1LCAwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDEwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0NCiAgICBdDQp9Ow0KDQovLyDojrflj5bmo4vlrZDnmoTmnZDmlpnlgLwNCmNvbnN0IGdldE1hdGVyaWFsVmFsdWUgPSAocGllY2UsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOw0KICAgIA0KICAgIC8vIOmSiOWvueacieWIhumYtuauteadkOaWmeWAvOeahOWFteenje+8iOWFteOAgeeCruOAgemprO+8ieiwg+aVtOadkOaWmeWAvA0KICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7DQogICAgICAgIHZhbHVlID0gdmFsdWVbZ2FtZVN0YWdlXSB8fCB2YWx1ZS5taWQ7DQogICAgfQ0KICAgIA0KICAgIHJldHVybiB2YWx1ZTsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOS9jee9ruWAvA0KY29uc3QgZ2V0UG9zaXRpb25WYWx1ZSA9IChwaWVjZSwgciwgYykgPT4gew0KICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOw0KICAgIGlmICghdGFibGUpIHJldHVybiAwOw0KICAgIA0KICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqA0KICAgIGNvbnN0IHJvd0lkeCA9IHBpZWNlLmNvbG9yID09PSAncmVkJyA/ICg5LSByKSA6IHI7DQogICAgcmV0dXJuIHRhYmxlW3Jvd0lkeF1bY10gfHwgMDsNCn07DQoNCi8vIOS4u+ivhOS8sOWHveaVsCAtIOivpue7huivhOS8sOaji+ebmOWxgOWKvw0KY29uc3QgZXZhbHVhdGVCb2FyZCA9IChib2FyZCwgaXNSZXBsYXkgPSBmYWxzZSwgY3VycmVudFBsYXllciA9IG51bGwsIGRlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcpID0+IHsNCiAgICAvLyDnu5/orqENCiAgICBpZiAoY3VycmVudFBsYXllcikgew0KICAgICAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQogICAgfQ0KICAgIA0KICAgIC8vIOesrOS4gOatpe+8muiOt+WPluW9k+WJjea4uOaIj+mYtuautQ0KICAgIC8vY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoYm9hcmQpOw0KICAgIC8vIOWwhua4uOaIj+mYtuautei9rOaNouS4uuadkOaWmeWAvOiuoeeul+aJgOmcgOeahOagvOW8jw0KICAgIC8vY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQogICAgLy8g5bCG5ri45oiP6Zi25q616L2s5o2i5Li66L6T5Ye65qC85byPDQogICAgLy9jb25zdCBvdXRwdXRQaGFzZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgIGNvbnN0IG91dHB1dFBoYXNlID0gZ2FtZVN0YWdlOw0KDQogICAgLy8g56ys5LqM5q2l77ya6YGN5Y6G5LiA5qyh5qOL55uY77yM5pS26ZuG5omA5pyJ5qOL5a2Q5L+h5oGv5bm26K6h566X5Z+656GA5YiG5pWwDQogICAgbGV0IHBpZWNlc0luZm8gPSBbXTsNCiAgICBsZXQgcmVkTWF0ZXJpYWwgPSAwLCByZWRQb3NpdGlvbiA9IDA7DQogICAgbGV0IGJsYWNrTWF0ZXJpYWwgPSAwLCBibGFja1Bvc2l0aW9uID0gMDsNCiAgICANCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmlLbpm4bmo4vlrZDln7rmnKzkv6Hmga8NCiAgICAgICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25WYWx1ZSA9IGdldFBvc2l0aW9uVmFsdWUocGllY2UsIHIsIGMpOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCB7IHIsIGMgfSwgcGllY2UpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDnq4vljbPlpITnkIZtb3Zlc++8jOiuoeeul+acuuWKqOaAp++8iOWwhnByb2Nlc3NQaWVjZU1vdmVz6YC76L6R5YaF6IGU5q2k5aSE77yJDQogICAgICAgICAgICBjb25zdCB7IGJhc2VNb3ZlVmFsdWUgfSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eTsNCiAgICAgICAgICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsNCiAgICAgICAgICAgIGZvciAoY29uc3QgbW92ZSBvZiBtb3Zlcykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW21vdmUucl1bbW92ZS5jXTsNCiAgICAgICAgICAgICAgICBpZiAoIXRhcmdldCkgew0KICAgICAgICAgICAgICAgICAgICAvLyDnm67moIfkvY3nva7kuLrnqbrvvIzorqHnrpfmnLrliqjmgKcNCiAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g56uL5Y2z57Sv5Yqg5Z+656GA5YiG5pWw77yM6YG/5YWN5ZCO57ut5YaN5qyh6YGN5Y6GDQogICAgICAgICAgICBpZiAocGllY2UuY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICAgICAgcmVkTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgICAgICByZWRQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBibGFja01hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICAgICAgYmxhY2tQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICBwaWVjZXNJbmZvLnB1c2goew0KICAgICAgICAgICAgICAgIHBpZWNlLA0KICAgICAgICAgICAgICAgIHIsDQogICAgICAgICAgICAgICAgYywNCiAgICAgICAgICAgICAgICBtb3ZlcywNCiAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlLA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uVmFsdWUsDQogICAgICAgICAgICAgICAgLy8g5Yid5aeL5YyW5bm26K6+572u6K6h566X5aW955qE5py65Yqo5YC8DQogICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDAsDQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogbW9iaWxpdHlWYWx1ZSwNCiAgICAgICAgICAgICAgICAvLyDmt7vliqDlqIHog4HogIXlkozkv53miqTogIXmlbDnu4QNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLCAgICAvLyDlqIHog4HlvZPliY3mo4vlrZDnmoTmlYzmlrnmo4vlrZDliJfooagNCiAgICAgICAgICAgICAgICBwcm90ZWN0OiBbXSAgLy8g5L+d5oqk5b2T5YmN5qOL5a2Q55qE5bex5pa55qOL5a2Q5YiX6KGoDQogICAgICAgICAgICB9KTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDnrKzkuozmraXvvJrln7rkuo7mlLbpm4bnmoTmo4vlrZDkv6Hmga/orqHnrpflhbbku5blgLzvvIzkvKDpgJJnYW1lU3RhZ2Xpgb/lhY3ph43lpI3orqHnrpcNCiAgICAvLyDliJvlu7pib2FyZEluZm/lubbkvKDpgJLnu5ljYWxjdWxhdGVEZXJpdmVkVmFsdWVzDQogICAgY29uc3QgYm9hcmRJbmZvID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7DQogICAgY2FsY3VsYXRlRGVyaXZlZFZhbHVlcyhib2FyZCwgcGllY2VzSW5mbywgY3VycmVudFBsYXllciwgZGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBib2FyZEluZm8pOw0KICAgIA0KICAgIC8vIOesrOS4ieatpe+8muiuoeeul+aAu+WIhu+8iOWPquiuoeeul+WJqeS9meWIhuaVsO+8jOWfuuehgOWIhuaVsOW3suWcqOaji+ebmOmBjeWOhuaXtuiuoeeul++8iQ0KICAgIGxldCByZWRUaHJlYXQgPSAwLCByZWRUYWN0aWMgPSAwLCByZWRTYWZldHkgPSAwLCByZWRNb2JpbGl0eSA9IDA7DQogICAgbGV0IGJsYWNrVGhyZWF0ID0gMCwgYmxhY2tUYWN0aWMgPSAwLCBibGFja1NhZmV0eSA9IDAsIGJsYWNrTW9iaWxpdHkgPSAwOw0KICAgIA0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGNvbnN0IHsgcGllY2UsIHRocmVhdFZhbHVlLCB0YWN0aWNWYWx1ZSwgc2FmZXR5VmFsdWUsIG1vYmlsaXR5VmFsdWUgfSA9IGluZm87DQogICAgICAgIA0KICAgICAgICBpZiAocGllY2UuY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICByZWRUaHJlYXQgKz0gdGhyZWF0VmFsdWU7DQogICAgICAgICAgICByZWRUYWN0aWMgKz0gdGFjdGljVmFsdWU7DQogICAgICAgICAgICByZWRTYWZldHkgKz0gc2FmZXR5VmFsdWU7DQogICAgICAgICAgICByZWRNb2JpbGl0eSArPSBtb2JpbGl0eVZhbHVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgYmxhY2tUaHJlYXQgKz0gdGhyZWF0VmFsdWU7DQogICAgICAgICAgICBibGFja1RhY3RpYyArPSB0YWN0aWNWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrU2FmZXR5ICs9IHNhZmV0eVZhbHVlOw0KICAgICAgICAgICAgYmxhY2tNb2JpbGl0eSArPSBtb2JpbGl0eVZhbHVlOw0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIOiuoeeul+WxgOWKv+aAu+WIhg0KICAgIGNvbnN0IHJlZFRvdGFsID0gDQogICAgICAgIHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArDQogICAgICAgIHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArDQogICAgICAgIHJlZFRocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsNCiAgICAgICAgcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKw0KICAgICAgICByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArDQogICAgICAgIHJlZE1vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsgDQogICAgDQogICAgY29uc3QgYmxhY2tUb3RhbCA9IA0KICAgICAgICBibGFja01hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArDQogICAgICAgIGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsNCiAgICAgICAgYmxhY2tUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArDQogICAgICAgIGJsYWNrVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKw0KICAgICAgICBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsNCiAgICAgICAgYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7DQogICAgDQogICAgLy8g6L+U5Zue6K+m57uG6K+E5Lyw57uT5p6cDQogICAgcmV0dXJuIHsNCiAgICAgICAgcmVkOiB7DQogICAgICAgICAgICB0b3RhbDogcmVkVG90YWwsDQogICAgICAgICAgICBtYXRlcmlhbDogcmVkTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsLA0KICAgICAgICAgICAgcG9zaXRpb246IHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgIHRocmVhdDogcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICB0YWN0aWM6IHJlZFRhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljLA0KICAgICAgICAgICAgc2FmZXR5OiByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgIG1vYmlsaXR5OiByZWRNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksDQogICAgICAgICAgICBwaGFzZTogb3V0cHV0UGhhc2UsDQogICAgICAgICAgICB3ZWlnaHRzOiB7DQogICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAuNCwNCiAgICAgICAgICAgICAgICBwb3NpdGlvbjogMC4yLA0KICAgICAgICAgICAgICAgIHRhY3RpYzogMC4xLA0KICAgICAgICAgICAgICAgIHNhZmV0eTogMC4xLA0KICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLjA1LA0KICAgICAgICAgICAgICAgIHRocmVhdDogMC4xNQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9LA0KICAgICAgICBibGFjazogew0KICAgICAgICAgICAgdG90YWw6IGJsYWNrVG90YWwsDQogICAgICAgICAgICBtYXRlcmlhbDogYmxhY2tNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICBwb3NpdGlvbjogYmxhY2tQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sDQogICAgICAgICAgICB0aHJlYXQ6IGJsYWNrVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICB0YWN0aWM6IGJsYWNrVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMsDQogICAgICAgICAgICBzYWZldHk6IGJsYWNrU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHksDQogICAgICAgICAgICBtb2JpbGl0eTogYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksDQogICAgICAgICAgICBwaGFzZTogb3V0cHV0UGhhc2UsDQogICAgICAgICAgICB3ZWlnaHRzOiB7DQogICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAuNCwNCiAgICAgICAgICAgICAgICBwb3NpdGlvbjogMC4yLA0KICAgICAgICAgICAgICAgIHRhY3RpYzogMC4xLA0KICAgICAgICAgICAgICAgIHNhZmV0eTogMC4xLA0KICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLjA1LA0KICAgICAgICAgICAgICAgIHRocmVhdDogMC4xNQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9LA0KICAgICAgICBwaWVjZXNJbmZvOiBwaWVjZXNJbmZvLA0KICAgICAgICBnYW1lU3RhZ2U6IGdhbWVTdGFnZSwNCiAgICAgICAgYm9hcmRJbmZvOiBib2FyZEluZm8NCiAgICB9Ow0KfTsNCg0KLy8g6L276YeP57qn5pCc57Si5L+h5oGv5YeG5aSH5Ye95pWw77ya5Y+q6K6h566X5pCc57Si6ZyA6KaB55qE5Z+65pys5L+h5oGvDQovLyDkuI3orqHnrpflrozmlbTnmoTlqIHog4HlgLzlkozlronlhajlgLzvvIzlj6rorqHnrpfmo4vlrZDlhbPns7vlkozmuLjmiI/nirbmgIENCmNvbnN0IHByZXBhcmVTZWFyY2hJbmZvID0gKGJvYXJkLCBjdXJyZW50UGxheWVyLCBnYW1lU3RhZ2UpID0+IHsNCiAgICAvLyDnu5/orqENCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudFtjdXJyZW50UGxheWVyXSsrOw0KICAgIA0KICAgIC8vIOaUtumbhuaji+WtkOWfuuacrOS/oeaBrw0KICAgIGxldCBwaWVjZXNJbmZvID0gW107DQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAoIXBpZWNlKSBjb250aW51ZTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvblZhbHVlID0gZ2V0UG9zaXRpb25WYWx1ZShwaWVjZSwgciwgYyk7DQogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOiuoeeul+acuuWKqOaApw0KICAgICAgICAgICAgY29uc3QgeyBiYXNlTW92ZVZhbHVlIH0gPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHk7DQogICAgICAgICAgICBsZXQgbW9iaWxpdHlWYWx1ZSA9IDA7DQogICAgICAgICAgICBmb3IgKGNvbnN0IG1vdmUgb2YgbW92ZXMpIHsNCiAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFttb3ZlLnJdW21vdmUuY107DQogICAgICAgICAgICAgICAgaWYgKCF0YXJnZXQpIHsNCiAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgcGllY2VzSW5mby5wdXNoKHsNCiAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICByLCBjLCBtb3ZlcywNCiAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlLA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uVmFsdWUsDQogICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDAsDQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogbW9iaWxpdHlWYWx1ZSwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLA0KICAgICAgICAgICAgICAgIHByb3RlY3Q6IFtdDQogICAgICAgICAgICB9KTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDliJ3lp4vljJZib2FyZEluZm8NCiAgICBjb25zdCBib2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCiAgICANCiAgICAvLyDorqHnrpfmo4vlrZDlhbPns7sNCiAgICBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyhib2FyZCwgcGllY2VzSW5mbywgYm9hcmRJbmZvKTsNCiAgICANCiAgICAvLyDorqHnrpfmuLjmiI/nirbmgIENCiAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoaW5mby5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgaWYgKGdldFZhbGlkTW92ZXMoYm9hcmQsIHsgcjogaW5mby5yLCBjOiBpbmZvLmMgfSkubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICBsZXQgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdwbGF5aW5nJyB9Ow0KICAgIGlmICghaGFzTW92ZXMpIHsNCiAgICAgICAgY29uc3QgaW5DaGVjayA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZElzSW5DaGVjayA6IGJvYXJkSW5mby5ibGFja0lzSW5DaGVjazsNCiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgDQogICAgICAgIGlmIChpbkNoZWNrKSB7DQogICAgICAgICAgICBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIGJvYXJkSW5mby5nYW1lU3RhdGUgPSBnYW1lU3RhdGU7DQogICAgDQogICAgcmV0dXJuIHsgcGllY2VzSW5mbywgYm9hcmRJbmZvIH07DQp9Ow0KDQovLyDorqHnrpfooY3nlJ/lgLzvvJrlqIHog4HlgLzjgIHlronlhajlgLzjgIHmiJjmnK/lgLzjgIHmnLrliqjlgLwNCi8vIOS/ruaUue+8mua3u+WKoHNlYXJjaEluaXRpYXRvcuWPguaVsO+8jOS8oOmAkue7mWNhbGN1bGF0ZVRocmVhdFZhbHVlcw0KLy8g5re75YqgZ2FtZVN0YWdl5Y+C5pWw77yM6YG/5YWN5Zyo5b6q546v5Lit6YeN5aSN6LCD55SoZ2V0R2FtZVBoYXNlDQpjb25zdCBjYWxjdWxhdGVEZXJpdmVkVmFsdWVzID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyID0gbnVsbCwgZGVwdGggPSAwLCBzZWFyY2hJbml0aWF0b3IgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJywgYm9hcmRJbmZvID0gbnVsbCkgPT4gew0KICAgIC8vIOmHjee9ruaJgOacieihjeeUn+WAvO+8jOmZpOS6huacuuWKqOWAvO+8iOW3suWcqOaUtumbhuaji+WtkOS/oeaBr+aXtuiuoeeul++8iQ0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGluZm8udGhyZWF0VmFsdWUgPSAwOw0KICAgICAgICBpbmZvLnNhZmV0eVZhbHVlID0gMDsNCiAgICAgICAgaW5mby50YWN0aWNWYWx1ZSA9IDA7DQogICAgICAgIC8vIOS/neeVmeacuuWKqOWAvO+8jOWboOS4uuW3suWcqOaUtumbhuaji+WtkOS/oeaBr+aXtuiuoeeulw0KICAgIH0NCiAgICANCiAgICAvLyAxLiDorqHnrpfmo4vlrZDlhbPns7vvvIjlqIHog4HogIXjgIHooqvlqIHog4HogIXjgIHkv53miqTogIXjgIHooqvkv53miqTogIXvvIkNCiAgICBpZiAoIWJvYXJkSW5mbykgew0KICAgICAgICBib2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCiAgICB9DQogICAgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMoYm9hcmQsIHBpZWNlc0luZm8sIGJvYXJkSW5mbyk7DQogICAgDQogICAgLy8gMi4g6K6h566X5aiB6IOB5YC877yI5Z+65LqO5a6M5pW055qE5aiB6IOB5YWz57O777yJ77yM5Lyg6YCSZ2FtZVN0YWdl5ZKMYm9hcmRJbmZvDQogICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzKGJvYXJkLCBwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyLCBkZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGJvYXJkSW5mbyk7DQogICAgDQogICAgLy8gMy4g6K6h566X5oiY5pyv5YC855qE5YW25LuW6YOo5YiG77yI5biu5Yqp5YWz57O75ZKM6Zi75oyh5YWz57O777yJDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgLy9pbmZvLnRhY3RpY1ZhbHVlICs9IGNhbGN1bGF0ZUFzc2lzdFZhbHVlKHBpZWNlc0luZm8sIGluZm8pOw0KICAgICAgICAvL2luZm8udGFjdGljVmFsdWUgKz0gY2FsY3VsYXRlQmxvY2tWYWx1ZShib2FyZCwgcGllY2VzSW5mbywgaW5mbyk7DQogICAgfQ0KICAgIA0KICAgIC8vIDQuIOacgOWQjuiuoeeul+WuieWFqOWAvO+8jOS8oOmAkmJvYXJkSW5mb+S9nOS4uuWPguaVsA0KICAgIGNhbGN1bGF0ZVNhZmV0eVZhbHVlcyhwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgIA0KICAgIC8vIDUuIOiuoeeul+a4uOaIj+eKtuaAgeW5tuS/neWtmOWIsGJvYXJkSW5mbw0KICAgIGlmIChjdXJyZW50UGxheWVyKSB7DQogICAgICAgIC8vIOajgOafpeW9k+WJjeeOqeWutuaYr+WQpuacieWQiOazlei1sOazlQ0KICAgICAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsNCiAgICAgICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5qOL5a2Q55qE5pyJ5pWI6LWw5rOVDQogICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHI6IGluZm8uciwgYzogaW5mby5jIH0pOw0KICAgICAgICAgICAgICAgIGlmIChtb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDliKTmlq3muLjmiI/nirbmgIENCiAgICAgICAgbGV0IGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAncGxheWluZycgfTsNCiAgICAgICAgaWYgKCFoYXNNb3Zlcykgew0KICAgICAgICAgICAgLy8g5rKh5pyJ5ZCI5rOV6LWw5rOV77yM5qOA5p+l5piv5ZCm6KKr5bCG5YabDQogICAgICAgICAgICBjb25zdCBpbkNoZWNrID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkSXNJbkNoZWNrIDogYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrOw0KICAgICAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKGluQ2hlY2spIHsNCiAgICAgICAgICAgICAgICBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIOS/neWtmOa4uOaIj+eKtuaAgeWIsGJvYXJkSW5mbw0KICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0gZ2FtZVN0YXRlOw0KICAgIH0NCn07DQoNCi8vIOiuoeeul+aji+WtkOWFs+ezu++8iOWogeiDgeiAheOAgeiiq+WogeiDgeiAheOAgeS/neaKpOiAheOAgeiiq+S/neaKpOiAhe+8iQ0KLy8g5ZCM5pe26K6h566XYm9hcmRJbmZv77ya5Li65qOL55uY5q+P5Liq5L2N572u55m76K6w5o6n5Yi26ICFDQpjb25zdCBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyA9IChib2FyZCwgcGllY2VzSW5mbywgYm9hcmRJbmZvKSA9PiB7DQogICAgLy8g5Yid5aeL5YyW5qOL5a2Q5YWz57O75pWw57uEDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaW5mby50aHJlYXQgPSBbXTsgICAgICAgICAgIC8vIOajgOafpei/meS4quaji+WtkOWPr+S7peWogeiDgeWTquS6m+aji+WtkA0KICAgICAgICBpbmZvLnRocmVhdGVuZWRCeSA9IFtdOyAgICAgLy8g5qOA5p+l6L+Z5Liq5qOL5a2Q6KKr5ZOq5Lqb5qOL5a2Q5aiB6IOBDQogICAgICAgIGluZm8uZ3VhcmQgPSBbXTsgICAgICAgLy8g5qOA5p+l6L+Z5Liq5qOL5a2Q5Y+v5Lul5L+d5oqk5ZOq5Lqb5qOL5a2QDQogICAgICAgIGluZm8uZ3VhcmRlZEJ5ID0gW107ICAgICAgLy8g5qOA5p+l6L+Z5Liq5qOL5a2Q6KKr5ZOq5Lqb5qOL5a2Q5L+d5oqkDQogICAgICAgIGluZm8uY29udHJvbCA9IFtdOyAgICAgIC8vIOajgOafpei/meS4quaji+WtkOWPr+S7peaOp+WItueahOWTquS6m+S9jee9rg0KICAgIH0NCiAgICANCiAgICAvLyDlpoLmnpxib2FyZEluZm/kuLrnqbrvvIzliJnliJ3lp4vljJYNCiAgICBpZiAoIWJvYXJkSW5mbykgew0KICAgICAgICBib2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCiAgICB9DQogICAgDQogICAgLy8g5aSE55CG5q+P5Liq5qOL5a2Q55qE5aiB6IOB5ZKM5L+d5oqk5YWz57O7DQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgLy8g6I635Y+W5qOL5a2Q55qE5aiB6IOB55uu5qCH5ZKM5L+d5oqk55uu5qCHDQogICAgICAgIGNvbnN0IHsgdGhyZWF0LCBndWFyZCB9ID0gZ2V0UGllY2VUYXJnZXRzKGJvYXJkLCB7IHI6IGluZm8uciwgYzogaW5mby5jIH0sIGluZm8ucGllY2UpOw0KICAgICAgICANCiAgICAgICAgLy8g5aSE55CG5aiB6IOB55uu5qCH77yM5ZCM5pe26K6w5b2V5Y+M5ZCR5aiB6IOB5YWz57O7DQogICAgICAgIGZvciAoY29uc3QgdGhyZWF0UG9zIG9mIHRocmVhdCkgew0KICAgICAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gdGhyZWF0UG9zLnIgJiYgcC5jID09PSB0aHJlYXRQb3MuYyk7DQogICAgICAgICAgICBpZiAodGFyZ2V0SW5mbykgew0KICAgICAgICAgICAgICAgIC8vIOiusOW9leWogeiDgeWFs+ezu++8mmluZm/lqIHog4F0YXJnZXRJbmZvDQogICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAvLyDlkIzml7borrDlvZXlj43lkJHlhbPns7vvvJp0YXJnZXRJbmZv6KKraW5mb+WogeiDgQ0KICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIOWkhOeQhuS/neaKpOebruagh++8jOWQjOaXtuiusOW9leWPjOWQkeS/neaKpOWFs+ezuw0KICAgICAgICBmb3IgKGNvbnN0IGd1YXJkUG9zIG9mIGd1YXJkKSB7DQogICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSBndWFyZFBvcy5yICYmIHAuYyA9PT0gZ3VhcmRQb3MuYyk7DQogICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICAgICAgLy8g6K6w5b2V5L+d5oqk5YWz57O777yaaW5mb+S/neaKpHRhcmdldEluZm8NCiAgICAgICAgICAgICAgICBpbmZvLmd1YXJkLnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgLy8g5ZCM5pe26K6w5b2V5Y+N5ZCR5YWz57O777yadGFyZ2V0SW5mb+iiq2luZm/kv53miqQNCiAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLmd1YXJkZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDorqHnrpflubborrDlvZXmo4vlrZDnmoTmjqfliLbngrkNCiAgICAgICAgY29uc3QgY29udHJvbCA9IGdldFBpZWNlQ29udHJvbChib2FyZCwgeyByOiBpbmZvLnIsIGM6IGluZm8uYyB9LCBpbmZvLnBpZWNlKTsNCiAgICAgICAgaW5mby5jb250cm9sID0gY29udHJvbDsNCiAgICAgICAgDQogICAgICAgIC8vIOabtOaWsGJvYXJkSW5mb++8muWwhuW9k+WJjeaji+WtkOeahOWujOaVtOS/oeaBr+a3u+WKoOWIsOWFtuaOp+WItueCueeahOaOp+WItuiAheWIl+ihqOS4rQ0KICAgICAgICBjb250cm9sLmZvckVhY2gocG9zID0+IHsNCiAgICAgICAgICAgIC8vIOWtmOWCqOWujOaVtOeahOaOp+WItuiAheS/oeaBr++8muS9jee9ruOAgeminOiJsuWSjOaji+WtkOexu+Weiw0KICAgICAgICAgICAgYm9hcmRJbmZvW3Bvcy5yXVtwb3MuY10ucHVzaCh7DQogICAgICAgICAgICAgICAgcjogaW5mby5yLA0KICAgICAgICAgICAgICAgIGM6IGluZm8uYywNCiAgICAgICAgICAgICAgICBjb2xvcjogaW5mby5waWVjZS5jb2xvciwNCiAgICAgICAgICAgICAgICB0eXBlOiBpbmZvLnBpZWNlLnR5cGUNCiAgICAgICAgICAgIH0pOw0KICAgICAgICB9KTsNCiAgICB9DQogICAgDQogICAgLy8g6aKE6K6h566X5bCG5Yab54q25oCBDQogICAgbGV0IHJlZElzSW5DaGVjayA9IGZhbHNlOw0KICAgIGxldCBibGFja0lzSW5DaGVjayA9IGZhbHNlOw0KICAgIA0KICAgIC8vIOafpeaJvuWwhi/luIXkvY3nva4NCiAgICBsZXQgcmVkR2VuZXJhbEluZm8gPSBudWxsOw0KICAgIGxldCBibGFja0dlbmVyYWxJbmZvID0gbnVsbDsNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoaW5mby5waWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgIHJlZEdlbmVyYWxJbmZvID0gaW5mbzsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgYmxhY2tHZW5lcmFsSW5mbyA9IGluZm87DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g5qOA5p+l57qi5bCG5piv5ZCm6KKr5bCG5YabDQogICAgaWYgKHJlZEdlbmVyYWxJbmZvKSB7DQogICAgICAgIC8vIOajgOafpeaVjOaWueaji+WtkOaYr+WQpuebtOaOpeWogeiDgee6ouWwhg0KICAgICAgICBmb3IgKGNvbnN0IHRocmVhdGVuZXIgb2YgcmVkR2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7DQogICAgICAgICAgICBpZiAodGhyZWF0ZW5lci5waWVjZS5jb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgIHJlZElzSW5DaGVjayA9IHRydWU7DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g5qOA5p+l6buR5bCG5piv5ZCm6KKr5bCG5YabDQogICAgaWYgKGJsYWNrR2VuZXJhbEluZm8pIHsNCiAgICAgICAgLy8g5qOA5p+l5pWM5pa55qOL5a2Q5piv5ZCm55u05o6l5aiB6IOB6buR5bCGDQogICAgICAgIGZvciAoY29uc3QgdGhyZWF0ZW5lciBvZiBibGFja0dlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgew0KICAgICAgICAgICAgaWYgKHRocmVhdGVuZXIucGllY2UuY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIOajgOafpemjnuWwhuaDheWGtQ0KICAgIGlmIChyZWRHZW5lcmFsSW5mbyAmJiBibGFja0dlbmVyYWxJbmZvKSB7DQogICAgICAgIC8vIOWwhi/luIXmmK/lkKblnKjlkIzkuIDliJcNCiAgICAgICAgaWYgKHJlZEdlbmVyYWxJbmZvLmMgPT09IGJsYWNrR2VuZXJhbEluZm8uYykgew0KICAgICAgICAgICAgLy8g5qOA5p+l5Lit6Ze05piv5ZCm5pyJ5YW25LuW5qOL5a2QDQogICAgICAgICAgICBsZXQgaGFzUGllY2VCZXR3ZWVuID0gZmFsc2U7DQogICAgICAgICAgICBjb25zdCBzdGFydFIgPSBNYXRoLm1pbihyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpICsgMTsNCiAgICAgICAgICAgIGNvbnN0IGVuZFIgPSBNYXRoLm1heChyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpIC0gMTsNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSBzdGFydFI7IHIgPD0gZW5kUjsgcisrKSB7DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW3JdW3JlZEdlbmVyYWxJbmZvLmNdKSB7DQogICAgICAgICAgICAgICAgICAgIGhhc1BpZWNlQmV0d2VlbiA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFoYXNQaWVjZUJldHdlZW4pIHsNCiAgICAgICAgICAgICAgICAvLyDpo57lsIbmg4XlhrXvvIznuqLmlrnlkozpu5Hmlrnpg73ooqvlsIblhpsNCiAgICAgICAgICAgICAgICByZWRJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICAgICAgICAgIGJsYWNrSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDlsIblsIblhpvnirbmgIHlrZjlgqjliLBib2FyZEluZm/kuK0NCiAgICBib2FyZEluZm8ucmVkSXNJbkNoZWNrID0gcmVkSXNJbkNoZWNrOw0KICAgIGJvYXJkSW5mby5ibGFja0lzSW5DaGVjayA9IGJsYWNrSXNJbkNoZWNrOw0KICAgIA0KICAgIC8vIOWwhuWwhuWGm+eKtuaAgeS5n+WtmOWCqOWIsOavj+S4quaji+WtkOS/oeaBr+S4re+8jOS+m+WQjue7rUFJ5pCc57Si5L2/55SoDQogICAgcGllY2VzSW5mby5mb3JFYWNoKGluZm8gPT4gew0KICAgICAgICBpbmZvLmJvYXJkSW5mbyA9IGJvYXJkSW5mbzsNCiAgICAgICAgLy8g5a2Y5YKo5bCG5Yab54q25oCB5YiwcGllY2VzSW5mb+S4re+8jOaWueS+v+iuv+mXrg0KICAgICAgICBpbmZvLnJlZElzSW5DaGVjayA9IHJlZElzSW5DaGVjazsNCiAgICAgICAgaW5mby5ibGFja0lzSW5DaGVjayA9IGJsYWNrSXNJbkNoZWNrOw0KICAgIH0pOw0KfTsNCg0KLy8g552A5rOV5o6S5bqP5Ye95pWw77ya5qC55o2u5LyY5YWI57qn5o6S5bqP552A5rOVDQovLyAxLiDkvJjlhYjlpITnkIbmiJHmlrnml6Dkv53miqTnmoTooqvljZXlkJHlqIHog4HnmoTmo4vlrZDmiafooYzpgIPot5HnnYDms5XvvIzlpoLmnInlpJrkuKrmo4vlrZDmjInmnZDmlpnlgLzku47pq5jliLDkvY7mjpLluo8NCi8vIDIuIOWFtuasoeWkhOeQhuaIkeaWueWNleWQkeWogeiDgeWvueaWueaXoOS/neaKpOaji+WtkOeahOaji+WtkOaJp+ihjOWQg+WtkOedgOazle+8jOWmguacieWkmuS4quaji+WtkOaMieaji+WtkOadkOaWmeWAvOS7jumrmOWIsOS9juaOkuW6jw0KLy8gMy4g5pyA5ZCO5aSE55CG5LiN5raJ5Y+K5ZCD5ZKM6KKr5ZCD55qE552A5rOV77yM6KaB5rGC6YG/5YWN56e75Yqo5Yiw6KKr5ZCD55qE5L2N572uDQpjb25zdCBzb3J0TW92ZXMgPSAobW92ZXMsIGJvYXJkLCBjdXJyZW50UGxheWVyLCBwaWVjZXNJbmZvLCBnYW1lU3RhZ2UgPSAnbWlkJywgYm9hcmRJbmZvID0gbnVsbCkgPT4gew0KICAgIC8vIOS9v+eUqOS8oOWFpeeahGdhbWVTdGFnZeWPguaVsO+8jOmBv+WFjemHjeWkjeiwg+eUqGdldEdhbWVQaGFzZQ0KICAgIA0KICAgIC8vIOeUqOmihOiuoeeul+eahOiiq+WwhueKtuaAge+8iOS4jeiDveeUqCBib2FyZEluZm8uY2hlY2tz77ya6YKj5piv4oCc6LCB5Zyo5bCG5Yab4oCd77yM5LiN5piv4oCc6LCB6KKr5bCG4oCd77yJDQogICAgY29uc3QgY3VycmVudElzSW5DaGVjayA9IGJvYXJkSW5mbyAmJiAoDQogICAgICAgIChjdXJyZW50UGxheWVyID09PSAncmVkJyAmJiBib2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fA0KICAgICAgICAoY3VycmVudFBsYXllciA9PT0gJ2JsYWNrJyAmJiBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2spDQogICAgKTsNCiAgICANCiAgICAvLyDkuLrmr4/kuKrnnYDms5XorqHnrpfkvJjlhYjnuqfliIbmlbDlubbkv53lrZjljp/lp4vntKLlvJUNCiAgICBtb3Zlcy5mb3JFYWNoKChtb3ZlLCBpbmRleCkgPT4gew0KICAgICAgICBjb25zdCB7IGZyb20sIHRvIH0gPSBtb3ZlOw0KICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsNCiAgICAgICAgY29uc3QgcGllY2VWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7DQoNCiAgICAgICAgY29uc3QgdGFyZ2V0UGllY2UgPSBib2FyZFt0by5yXVt0by5jXTsNCiAgICAgICAgY29uc3QgdGFyZ2V0UGllY2VWYWx1ZSA9IHRhcmdldFBpZWNlID8gZ2V0TWF0ZXJpYWxWYWx1ZSh0YXJnZXRQaWVjZSwgZ2FtZVN0YWdlKSA6IDA7DQogICAgICAgIA0KICAgICAgICBsZXQgcHJpb3JpdHkgPSA0Ow0KICAgICAgICBsZXQgc2NvcmUgPSAwOw0KICAgICAgICANCiAgICAgICAgLy8g5Y+q5pyJ5b2T5YmN5bCG5Yab54q25oCB5pe25omN5qOA5p+l5bCG5Yab552A5rOV77yI5LyY5YWI57qnMO+8iQ0KICAgICAgICAvLyDlm6DkuLrlj6rmnInpnIDopoHop6PpmaTlsIblhpvml7bvvIzlsIblhpvnnYDms5XmiY3ph43opoENCiAgICAgICAgaWYgKGN1cnJlbnRJc0luQ2hlY2spIHsNCiAgICAgICAgICAgIGNvbnN0IG5leHRCb2FyZCA9IGJvYXJkLm1hcChyb3cgPT4gWy4uLnJvd10pOw0KICAgICAgICAgICAgbmV4dEJvYXJkW3RvLnJdW3RvLmNdID0gbmV4dEJvYXJkW2Zyb20ucl1bZnJvbS5jXTsNCiAgICAgICAgICAgIG5leHRCb2FyZFtmcm9tLnJdW2Zyb20uY10gPSBudWxsOw0KICAgICAgICAgICAgY29uc3QgZW5lbXlDb2xvciA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICAgICAgaWYgKGlzQ2hlY2sobmV4dEJvYXJkLCBlbmVteUNvbG9yKSkgew0KICAgICAgICAgICAgICAgIC8vIOWwhuWGm+edgOazle+8jOS8mOWFiOe6p+acgOmrmA0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMDsNCiAgICAgICAgICAgICAgICBzY29yZSA9IDEwMDAwOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgLy8g5qOA5p+l6YCD6LeR552A5rOV77yI5oiR5pa56KKr5o2J55qE5qOL5a2Q56e75Yqo77yJDQogICAgICAgICAgICBpZiAoYm9hcmRJbmZvICYmIGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzICYmIGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICBjb25zdCBpc1RocmVhdGVuZWRQaWVjZSA9IGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLnNvbWUocCA9PiBwLnIgPT09IGZyb20uciAmJiBwLmMgPT09IGZyb20uYyk7DQogICAgICAgICAgICAgICAgaWYgKGlzVGhyZWF0ZW5lZFBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOmAg+i3keedgOazle+8jOS8mOWFiOe6p+esrOS6jOmrmA0KICAgICAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDE7DQogICAgICAgICAgICAgICAgICAgIC8vIOmAg+i3keWIhuaVsO+8muaIkeaWueaji+WtkOeahOadkOaWmeWAvA0KICAgICAgICAgICAgICAgICAgICBzY29yZSA9IHBpZWNlVmFsdWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOajgOafpeaYr+WQpuaNieWQg+edgOazle+8iOaIkeaWueWPr+WQg+eahOaji+WtkO+8iQ0KICAgICAgICAgICAgICAgICAgICBjb25zdCBpc0NhbkNhcHR1cmUgPSBib2FyZEluZm8uY2FuQ2FwdHVyZSAmJiBib2FyZEluZm8uY2FuQ2FwdHVyZS5zb21lKHAgPT4gcC5yID09PSB0by5yICYmIHAuYyA9PT0gdG8uYyk7DQogICAgICAgICAgICAgICAgICAgIGlmIChpc0NhbkNhcHR1cmUpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOaNieWQg+edgOazle+8jOS8mOWFiOe6p+esrOS4iemrmA0KICAgICAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOw0KICAgICAgICAgICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g5pmu6YCa5ZCD5a2Q552A5rOVDQogICAgICAgICAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOmdnuWQg+WtkOedgOazlQ0KICAgICAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDQ7DQogICAgICAgICAgICAgICAgICAgIHNjb3JlID0gMDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICAvLyDmo4Dmn6XmjYnlkIPnnYDms5XvvIjmiJHmlrnlj6/lkIPnmoTmo4vlrZDvvIkNCiAgICAgICAgICAgIGVsc2UgaWYgKGJvYXJkSW5mbyAmJiBib2FyZEluZm8uY2FuQ2FwdHVyZSAmJiBib2FyZEluZm8uY2FuQ2FwdHVyZS5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgY29uc3QgaXNDYW5DYXB0dXJlID0gYm9hcmRJbmZvLmNhbkNhcHR1cmUuc29tZShwID0+IHAuciA9PT0gdG8uciAmJiBwLmMgPT09IHRvLmMpOw0KICAgICAgICAgICAgICAgIGlmIChpc0NhbkNhcHR1cmUpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5o2J5ZCD552A5rOV77yM5LyY5YWI57qn56ys5LiJ6auYDQogICAgICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMjsNCiAgICAgICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAvLyDmma7pgJrlkIPlrZDnnYDms5UNCiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDpnZ7lkIPlrZDnnYDms5UNCiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSA0Ow0KICAgICAgICAgICAgICAgICAgICBzY29yZSA9IDA7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgLy8g5rKh5pyJYm9hcmRJbmZv5pe255qEZmFsbGJhY2vpgLvovpENCiAgICAgICAgICAgIGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7DQogICAgICAgICAgICAgICAgLy8g5pmu6YCa5ZCD5a2Q552A5rOVDQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIOmdnuWQg+WtkOedgOazlQ0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gNDsNCiAgICAgICAgICAgICAgICBzY29yZSA9IDA7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIOS/neWtmOS8mOWFiOe6p+OAgeWIhuaVsOWSjOWOn+Wni+e0ouW8lQ0KICAgICAgICBtb3ZlLnByaW9yaXR5ID0gcHJpb3JpdHk7DQogICAgICAgIG1vdmUuc29ydFNjb3JlID0gc2NvcmU7DQogICAgICAgIG1vdmUub3JpZ2luYWxJbmRleCA9IGluZGV4Ow0KICAgIH0pOw0KICAgIA0KICAgIC8vIOagueaNruS8mOWFiOe6p+OAgeWIhuaVsOWSjOWOn+Wni+e0ouW8leaOkuW6j+edgOazlQ0KICAgIG1vdmVzLnNvcnQoKGEsIGIpID0+IHsNCiAgICAgICAgLy8g6aaW5YWI5oyJ5LyY5YWI57qn5o6S5bqP77yM5LyY5YWI57qnMCA+IDEgPiAyID4gMyA+IDQNCiAgICAgICAgaWYgKGEucHJpb3JpdHkgIT09IGIucHJpb3JpdHkpIHsNCiAgICAgICAgICAgIHJldHVybiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eTsNCiAgICAgICAgfQ0KICAgICAgICAvLyDkvJjlhYjnuqfnm7jlkIzml7bvvIzmjInliIbmlbDku47pq5jliLDkvY7mjpLluo8NCiAgICAgICAgaWYgKGEuc29ydFNjb3JlICE9PSBiLnNvcnRTY29yZSkgew0KICAgICAgICAgICAgcmV0dXJuIGIuc29ydFNjb3JlIC0gYS5zb3J0U2NvcmU7DQogICAgICAgIH0NCiAgICAgICAgLy8g5LyY5YWI57qn5ZKM5YiG5pWw6YO955u45ZCM5pe277yM5oyJ5Y6f5aeL57Si5byV5o6S5bqP77yM5L+d5oyB56iz5a6aDQogICAgICAgIHJldHVybiBhLm9yaWdpbmFsSW5kZXggLSBiLm9yaWdpbmFsSW5kZXg7DQogICAgfSk7DQogICAgDQogICAgcmV0dXJuIG1vdmVzOw0KfTsNCg0KLy8g5aSE55CG5Y2V5Liq5qOL5a2Q55qE5omA5pyJbW92ZXPvvIzorqHnrpfmnLrliqjmgKfjgIHlqIHog4Hlkozkv53miqQNCmNvbnN0IHByb2Nlc3NQaWVjZU1vdmVzID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBpbmZvKSA9PiB7DQogICAgY29uc3QgeyBwaWVjZSwgbW92ZXMgfSA9IGluZm87DQogICAgY29uc3QgeyBiYXNlTW92ZVZhbHVlIH0gPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHk7DQogICAgDQogICAgLy8gMS4g6K6h566X5py65Yqo5oCn77ya56m65L2N572u55qE56e75Yqo5pWw6YePDQogICAgZm9yIChjb25zdCBtb3ZlIG9mIG1vdmVzKSB7DQogICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW21vdmUucl1bbW92ZS5jXTsNCiAgICAgICAgaWYgKCF0YXJnZXQpIHsNCiAgICAgICAgICAgIC8vIOebruagh+S9jee9ruS4uuepuu+8jOiuoeeul+acuuWKqOaApw0KICAgICAgICAgICAgaW5mby5tb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7DQogICAgICAgIH0NCiAgICB9DQp9Ow0KDQovLyDmo4Dmn6Xnm67moIfkvY3nva7mmK/lkKblj6/mjqXlj5fvvIjpgb/lhY3mmI7mmL7pgIHlkIMv5LqP5o2i77yJDQovLyDkvJjljJbniYjvvJrmjqXlj5fpooTorqHnrpfnmoRib2FyZEluZm/lkoxwaWVjZXNJbmZv77yM6YG/5YWN6YeN5aSN6K6h566XDQpjb25zdCBpc1Bvc2l0aW9uQWNjZXB0YWJsZSA9IChib2FyZCwgZnJvbSwgdG8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbyA9IG51bGwsIHBpZWNlc0luZm8gPSBudWxsLCB0cnlNb3ZlUGllY2UgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJykgPT4gew0KICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gdHJ5TW92ZVBpZWNlIHx8IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsNCiAgICBjb25zdCB0YXJnZXRQaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOw0KICAgIGNvbnN0IGlzQ2FwdHVyZSA9IHRhcmdldFBpZWNlICYmIHRhcmdldFBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyOw0KDQogICAgLy8g5pS26ZuG5omA5pyJ5qOL5a2Q5L+h5oGv77yM5Y+q5Zyo5rKh5pyJ5o+Q5L6b5pe26K6h566XDQogICAgbGV0IGxvY2FsUGllY2VzSW5mbyA9IHBpZWNlc0luZm87DQogICAgaWYgKCFsb2NhbFBpZWNlc0luZm8pIHsNCiAgICAgICAgbG9jYWxQaWVjZXNJbmZvID0gW107DQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0VmFsaWRNb3Zlcyhib2FyZCwgeyByLCBjIH0pOw0KICAgICAgICAgICAgICAgICAgICBsb2NhbFBpZWNlc0luZm8ucHVzaCh7DQogICAgICAgICAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHIsIGMsIG1vdmVzLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeTogW10sDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZDogW10sDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZGVkQnk6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdFZhbHVlOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICB0YWN0aWNWYWx1ZTogMA0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDorqHnrpfmo4vlrZDlhbPns7vlkozmjqfliLbkv6Hmga/vvIzlj6rlnKjmsqHmnInmj5Dkvpvml7borqHnrpcNCiAgICBsZXQgbG9jYWxCb2FyZEluZm8gPSBib2FyZEluZm87DQogICAgaWYgKCFsb2NhbEJvYXJkSW5mbykgew0KICAgICAgICBsb2NhbEJvYXJkSW5mbyA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpLm1hcCgoKSA9PiBbXSkpOw0KICAgICAgICBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyhib2FyZCwgbG9jYWxQaWVjZXNJbmZvLCBsb2NhbEJvYXJkSW5mbyk7DQogICAgfQ0KDQogICAgY29uc3QgY29udHJvbGxlcnMgPSBsb2NhbEJvYXJkSW5mb1t0by5yXVt0by5jXSB8fCBbXTsNCiAgICBsZXQgaGFzQWxseUNvbnRyb2xsZXIgPSBmYWxzZTsNCiAgICBsZXQgaGFzRW5lbXlDb250cm9sbGVyID0gZmFsc2U7DQoNCiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgY29udHJvbGxlcnMpIHsNCiAgICAgICAgLy8g5o6S6Zmk5q2j5Zyo56e75Yqo55qE5qOL5a2Q5pys6Lqr77yI6LWw5ZCO5a6D5LiN5YaN5LuO5Y6f5L2N5o6n5Yi255uu5qCH77yJDQogICAgICAgIGlmIChtb3ZpbmdQaWVjZSAmJiBjb250cm9sbGVyLnIgPT09IGZyb20uciAmJiBjb250cm9sbGVyLmMgPT09IGZyb20uYykgew0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGNvbnRyb2xsZXIuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgICAgIGhhc0FsbHlDb250cm9sbGVyID0gdHJ1ZTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbGxlciA9IHRydWU7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBpZiAoaXNDYXB0dXJlKSB7DQogICAgICAgIC8vIOeZveWQg++8muebruagh+acquiiq+aVjOaWueS/neaKpA0KICAgICAgICBpZiAoIWhhc0VuZW15Q29udHJvbGxlcikgew0KICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgIH0NCiAgICAgICAgLy8g566A5Y2VIFNFRe+8muWFiOW+l+ebruagh+WIhu+8jOiLpeS8muiiq+WPjeWQg+WImeWGjeWkseW3seaWueaji+WtkA0KICAgICAgICBjb25zdCB0YXJnZXRWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUodGFyZ2V0UGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgIGNvbnN0IG91clZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZShtb3ZpbmdQaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgbGV0IHNlZSA9IHRhcmdldFZhbHVlIC0gb3VyVmFsdWU7DQogICAgICAgIC8vIOiLpeacieW3seaWuee7p+e7reS/neaKpO+8jOeyl+eVpeiupOS4uuWPr+iDveWGjeWQg+WbnuacgOS9juS7t+WAvOeahOaVjOaWueS/neaKpOiAhQ0KICAgICAgICBpZiAoaGFzQWxseUNvbnRyb2xsZXIpIHsNCiAgICAgICAgICAgIGNvbnN0IGVuZW15R3VhcmRWYWx1ZXMgPSBjb250cm9sbGVycw0KICAgICAgICAgICAgICAgIC5maWx0ZXIoYyA9PiBjLmNvbG9yICE9PSBjdXJyZW50UGxheWVyICYmICEoYy5yID09PSBmcm9tLnIgJiYgYy5jID09PSBmcm9tLmMpKQ0KICAgICAgICAgICAgICAgIC5tYXAoYyA9PiB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtjLnJdW2MuY107DQogICAgICAgICAgICAgICAgICAgIHJldHVybiBwID8gZ2V0TWF0ZXJpYWxWYWx1ZShwLCBnYW1lU3RhZ2UpIDogMDsNCiAgICAgICAgICAgICAgICB9KQ0KICAgICAgICAgICAgICAgIC5maWx0ZXIodiA9PiB2ID4gMCkNCiAgICAgICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gYSAtIGIpOw0KICAgICAgICAgICAgaWYgKGVuZW15R3VhcmRWYWx1ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgIHNlZSArPSBlbmVteUd1YXJkVmFsdWVzWzBdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIC8vIOaYjuaYvuS6j+aNou+8iOWmgui9puaNouaXoOagueWFteS4lOS8muiiq+WPjeWQg++8ieWImei/h+a7pO+8m+W5s+aNoi/otZrmjaLnlZnnu5nmkJzntKINCiAgICAgICAgcmV0dXJuIHNlZSA+PSAwOw0KICAgIH0NCg0KICAgIC8vIOmdnuWQg+WtkO+8muebruagh+S7heiiq+aVjOaWueaOp+WItuWImeinhuS4uumAgeWQgw0KICAgIGlmIChjb250cm9sbGVycy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHRydWU7DQogICAgfQ0KICAgIHJldHVybiAhaGFzRW5lbXlDb250cm9sbGVyIHx8IGhhc0FsbHlDb250cm9sbGVyOw0KfTsNCg0KLy8g6K6h566X5a6J5YWo5YC8DQovLyDkuZ3lrqvkvY3nva7lrprkuYnvvJpb6LW35aeL6KGMLCDnu5PmnZ/ooYwsIOi1t+Wni+WIlywg57uT5p2f5YiXXSAtIOenu+WIsOWHveaVsOWklumDqO+8jOmBv+WFjemHjeWkjeWIm+W7ug0KY29uc3QgUEFMQUNFX1BPU0lUSU9OUyA9IHsNCiAgICByZWQ6IHsgc3RhcnRSb3c6IDAsIGVuZFJvdzogMiwgc3RhcnRDb2w6IDMsIGVuZENvbDogNSB9LCAvLyDnuqLmlrnkuZ3lrqvvvIjlsIbnmoTkvY3nva7vvIkNCiAgICBibGFjazogeyBzdGFydFJvdzogNywgZW5kUm93OiA5LCBzdGFydENvbDogMywgZW5kQ29sOiA1IH0gIC8vIOm7keaWueS5neWuq++8iOW4heeahOS9jee9ru+8iQ0KfTsNCg0KLy8g5Y2S5p6X57q/5a6a5LmJIC0g56e75Yiw5Ye95pWw5aSW6YOo77yM6YG/5YWN6YeN5aSN5Yib5bu6DQpjb25zdCBMSU5FTElORV9QT1NJVElPTlMgPSB7DQogICAgcmVkOiAzLCAgLy8g57qi5pa55Y2S5p6X57q/77yI6buR5YW16ZyA6KaB6LaF6L+H55qE57q/77yJDQogICAgYmxhY2s6IDYgIC8vIOm7keaWueWNkuael+e6v++8iOe6ouWFtemcgOimgei2hei/h+eahOe6v++8iQ0KfTsNCg0KLy8g5LuOcGllY2VzSW5mb+eUn+aIkOS9jee9ruaOp+WItuaYoOWwhOihqA0KY29uc3QgYnVpbGRQb3NpdGlvbkNvbnRyb2xNYXAgPSAocGllY2VzSW5mbykgPT4gew0KICAgIGNvbnN0IHBvc2l0aW9uQ29udHJvbE1hcCA9IG5ldyBNYXAoKTsNCiAgICANCiAgICAvLyDpgY3ljobmiYDmnInmo4vlrZDvvIzorrDlvZXmr4/kuKrkvY3nva7nmoTmjqfliLbogIUNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICAvLyDmo4Dmn6Vjb250cm9s5bGe5oCn5piv5ZCm5a2Y5Zyo5LiU5Li65pWw57uEDQogICAgICAgIGlmICghaW5mby5jb250cm9sIHx8ICFBcnJheS5pc0FycmF5KGluZm8uY29udHJvbCkpIHsNCiAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDpgY3ljobor6Xmo4vlrZDnmoTmiYDmnInmjqfliLbngrkNCiAgICAgICAgZm9yIChjb25zdCBjb250cm9sUG9zIG9mIGluZm8uY29udHJvbCkgew0KICAgICAgICAgICAgLy8g5qOA5p+lY29udHJvbFBvc+aYr+WQpuacieaViA0KICAgICAgICAgICAgaWYgKCFjb250cm9sUG9zIHx8IHR5cGVvZiBjb250cm9sUG9zLnIgIT09ICdudW1iZXInIHx8IHR5cGVvZiBjb250cm9sUG9zLmMgIT09ICdudW1iZXInKSB7DQogICAgICAgICAgICAgICAgY29udGludWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbnRyb2xQb3Mucn0sJHtjb250cm9sUG9zLmN9YDsNCiAgICAgICAgICAgIGlmICghcG9zaXRpb25Db250cm9sTWFwLmhhcyhrZXkpKSB7DQogICAgICAgICAgICAgICAgcG9zaXRpb25Db250cm9sTWFwLnNldChrZXksIFtdKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIC8vIOiusOW9leaOp+WItuiAheeahOminOiJsuWSjOaji+WtkOexu+Weiw0KICAgICAgICAgICAgcG9zaXRpb25Db250cm9sTWFwLmdldChrZXkpLnB1c2goew0KICAgICAgICAgICAgICAgIGNvbG9yOiBpbmZvLnBpZWNlLmNvbG9yLA0KICAgICAgICAgICAgICAgIHR5cGU6IGluZm8ucGllY2UudHlwZQ0KICAgICAgICAgICAgfSk7DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgcmV0dXJuIHBvc2l0aW9uQ29udHJvbE1hcDsNCn07DQoNCi8vIOiuoeeul+WuieWFqOWAvCAtIOmHjeaehOeJiO+8muWfuuS6jmJvYXJkSW5mb+eahOaOp+WItuWFs+ezuw0KY29uc3QgY2FsY3VsYXRlU2FmZXR5VmFsdWVzID0gKHBpZWNlc0luZm8sIGJvYXJkSW5mbykgPT4gew0KICAgIC8vIDEuIOaJvuWIsOWwhuWSjOW4hQ0KICAgIGNvbnN0IGdlbmVyYWxJbmZvID0gW107DQogICAgcGllY2VzSW5mby5mb3JFYWNoKGluZm8gPT4gew0KICAgICAgICBpZiAoaW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5HRU5FUkFMKSB7DQogICAgICAgICAgICBnZW5lcmFsSW5mby5wdXNoKGluZm8pOw0KICAgICAgICB9DQogICAgfSk7DQogICAgDQogICAgZm9yIChjb25zdCBnZW5lcmFsIG9mIGdlbmVyYWxJbmZvKSB7DQogICAgICAgIGNvbnN0IGdlbmVyYWxDb2xvciA9IGdlbmVyYWwucGllY2UuY29sb3I7DQogICAgICAgIGNvbnN0IGVuZW15Q29sb3IgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICANCiAgICAgICAgLy8g5qOA5p+l5bCG5biF55qE5o6n5Yi254K55piv5ZCm6KKr5pWM5pa55qOL5a2Q5o6n5Yi2DQogICAgICAgIGZvciAoY29uc3QgY29udHJvbFBvcyBvZiBnZW5lcmFsLmNvbnRyb2wpIHsNCiAgICAgICAgICAgIC8vIOiOt+WPluivpeaOp+WItueCueeahOaOp+WItuiAhQ0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBjb250cm9sUG9zOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25Db250cm9sbGVycyA9IGJvYXJkSW5mb1tyXVtjXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5qOA5p+l5piv5ZCm5pyJ5pWM5pa55qOL5a2Q5o6n5Yi26K+l5L2N572uDQogICAgICAgICAgICBjb25zdCBoYXNFbmVteUNvbnRyb2wgPSBwb3NpdGlvbkNvbnRyb2xsZXJzLnNvbWUoY29udHJvbGxlciA9PiANCiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmNvbG9yID09PSBlbmVteUNvbG9yDQogICAgICAgICAgICApOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDlpoLmnpzkvY3nva7mnInmlYzmlrnmo4vlrZDmjqfliLbvvIzmiaM1MOeahOWuieWFqOWAvA0KICAgICAgICAgICAgaWYgKGhhc0VuZW15Q29udHJvbCkgew0KICAgICAgICAgICAgICAgIGdlbmVyYWwuc2FmZXR5VmFsdWUgLT0gNTA7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQp9Ow0KDQoNCi8vIOiuoeeul+WogeiDgeWAvO+8iOWfuuS6juWujOaVtOeahOWogeiDgeWFs+ezu++8iQ0KLy8g5L+u5pS577ya5aiB6IOB5YC85bqU6K+l5LuO5pCc57Si5Y+R6LW35pa555qE6KeS5bqm6K6h566X77yM6ICM5LiN5piv5LuO5b2T5YmN6KGM5qOL5pa56KeS5bqmDQovLyDmt7vliqBnYW1lU3RhZ2Xlj4LmlbDvvIzpgb/lhY3lnKjlvqrnjq/kuK3ph43lpI3osIPnlKhnZXRHYW1lUGhhc2UNCi8vIOa3u+WKoGJvYXJkSW5mb+WPguaVsO+8jOeUqOS6juWtmOWCqOWogeiDgeexu+Wei+S/oeaBrw0KY29uc3QgY2FsY3VsYXRlVGhyZWF0VmFsdWVzID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyLCBkZXB0aCwgc2VhcmNoSW5pdGlhdG9yID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcsIGJvYXJkSW5mbyA9IG51bGwpID0+IHsNCiAgICAvLyDnu5/orqENCiAgICBpZiAoY3VycmVudFBsYXllcikgew0KICAgICAgICBwZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnRbY3VycmVudFBsYXllcl0rKzsNCiAgICB9DQogICAgDQogICAgLy8g5Yid5aeL5YyW5aiB6IOB57G75Z6L57uf6K6h5L+h5oGvDQogICAgaWYgKGJvYXJkSW5mbykgew0KICAgICAgICBib2FyZEluZm8uY2hlY2tzID0gW107ICAgICAgLy8g5bCG5Yab5L+h5oGvDQogICAgICAgIGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzID0gW107ICAvLyDooqvmjYnnmoTmo4vlrZANCiAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUgPSBbXTsgIC8vIOWPr+WQg+eahOaji+WtkA0KICAgIH0NCg0KICAgIGNvbnN0IGNoZWNrQm9udXMgPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuY2hlY2suYm9udXM7DQogICAgLy8g5ZCM5LiA5peg5qC55a2Q6KKr5aSa5pa55aiB6IOB5pe25Y+q6K6h5LiA5qyh5p2Q5paZ5aiB6IOB77yM6YG/5YWN6YeN5aSN5Yqg5YiGDQogICAgY29uc3Qgc2NvcmVkSGFuZ2luZ0tleXMgPSBuZXcgU2V0KCk7DQogICAgY29uc3QgY2hlY2tlZEdlbmVyYWxzID0gbmV3IFNldCgpOw0KICAgIA0KICAgIC8vIOmBjeWOhuaJgOacieaji+WtkO+8jOiuoeeul+WogeiDgeWFs+ezuw0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGNvbnN0IHsgcGllY2UgfSA9IGluZm87DQogICAgICAgIA0KICAgICAgICAvLyDmo4Dmn6XlvZPliY3mo4vlrZDmmK/lkKblqIHog4Hlhbbku5bmo4vlrZANCiAgICAgICAgZm9yIChjb25zdCB0aHJlYXRlbmVkUGllY2Ugb2YgaW5mby50aHJlYXQpIHsNCiAgICAgICAgICAgIGNvbnN0IGlzQXR0YWNrZXJDdXJyZW50UGxheWVyID0gcGllY2UuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXI7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOWwhuWGm++8muWPque7meWwj+mineWFiOaJi+WIhu+8jOe7neS4jeaMieWwhi/luIXmnZDmlpnlgLzlgZogU0VF77yI5ZCm5YiZ5Lya5Li65bCG5LiN5oOc6YCB5q2777yJDQogICAgICAgICAgICBjb25zdCBpc0NoZWNrID0gdGhyZWF0ZW5lZFBpZWNlLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkdFTkVSQUw7DQogICAgICAgICAgICBpZiAoaXNDaGVjaykgew0KICAgICAgICAgICAgICAgIGlmIChib2FyZEluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNoZWNrcy5wdXNoKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja2VyOiBpbmZvLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiB0aHJlYXRlbmVkUGllY2UsDQogICAgICAgICAgICAgICAgICAgICAgICBpc0NoZWNrOiB0cnVlDQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAvLyDlkIzkuIDlsIYv5biF6KKr5aSa5pa55bCG5Yab5pe277yM5YWI5omL5YiG5Y+q5Yqg5LiA5qyhDQogICAgICAgICAgICAgICAgY29uc3QgZ2VuZXJhbEtleSA9IGAke3RocmVhdGVuZWRQaWVjZS5yfSwke3RocmVhdGVuZWRQaWVjZS5jfWA7DQogICAgICAgICAgICAgICAgaWYgKCFjaGVja2VkR2VuZXJhbHMuaGFzKGdlbmVyYWxLZXkpKSB7DQogICAgICAgICAgICAgICAgICAgIGNoZWNrZWRHZW5lcmFscy5hZGQoZ2VuZXJhbEtleSk7DQogICAgICAgICAgICAgICAgICAgIGluZm8udGhyZWF0VmFsdWUgKz0gY2hlY2tCb251czsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgY29udGludWU7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IHRhcmdldFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZSh0aHJlYXRlbmVkUGllY2UucGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgICAgICBjb25zdCBoYXNHdWFyZCA9IHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnkgJiYgdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeS5sZW5ndGggPiAwOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBTRUXvvJrku4XnlKjkuo7liKTmlq3kuqTmjaLmmK/lkKblr7nmlLvlh7vmlrnmnInliKnvvJvlqIHog4HliIblj6rliqDlnKjmlLvlh7vmlrnvvIzpgb/lhY3lh4DliIblj4zorqENCiAgICAgICAgICAgIGxldCBzc2VTY29yZSA9IDA7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChoYXNHdWFyZCkgew0KICAgICAgICAgICAgICAgIGNvbnN0IGF0dGFja2VycyA9IHRocmVhdGVuZWRQaWVjZS50aHJlYXRlbmVkQnkNCiAgICAgICAgICAgICAgICAgICAgLm1hcChhdHRhY2tlciA9PiAoew0KICAgICAgICAgICAgICAgICAgICAgICAgLi4uYXR0YWNrZXIsDQogICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZTogZ2V0TWF0ZXJpYWxWYWx1ZShhdHRhY2tlci5waWVjZSwgZ2FtZVN0YWdlKQ0KICAgICAgICAgICAgICAgICAgICB9KSkNCiAgICAgICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IGEudmFsdWUgLSBiLnZhbHVlKTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBjb25zdCBndWFyZHMgPSB0aHJlYXRlbmVkUGllY2UuZ3VhcmRlZEJ5DQogICAgICAgICAgICAgICAgICAgIC5tYXAoZ3VhcmQgPT4gKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC4uLmd1YXJkLA0KICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGdldE1hdGVyaWFsVmFsdWUoZ3VhcmQucGllY2UsIGdhbWVTdGFnZSkNCiAgICAgICAgICAgICAgICAgICAgfSkpDQogICAgICAgICAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBhLnZhbHVlIC0gYi52YWx1ZSk7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgbGV0IGV4Y2hhbmdlU2NvcmUgPSAwOw0KICAgICAgICAgICAgICAgIGxldCBhdHRhY2tlckluZGV4ID0gMDsNCiAgICAgICAgICAgICAgICBsZXQgZ3VhcmRJbmRleCA9IDA7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgd2hpbGUgKGF0dGFja2VySW5kZXggPCBhdHRhY2tlcnMubGVuZ3RoICYmIGd1YXJkSW5kZXggPCBndWFyZHMubGVuZ3RoKSB7DQogICAgICAgICAgICAgICAgICAgIGlmIChndWFyZEluZGV4ID09PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IHRhcmdldFZhbHVlOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgLT0gYXR0YWNrZXJzW2F0dGFja2VySW5kZXhdLnZhbHVlOw0KICAgICAgICAgICAgICAgICAgICBpZiAoYXR0YWNrZXJJbmRleCArIDEgPCBhdHRhY2tlcnMubGVuZ3RoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IGd1YXJkc1tndWFyZEluZGV4XS52YWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBhdHRhY2tlckluZGV4Kys7DQogICAgICAgICAgICAgICAgICAgIGd1YXJkSW5kZXgrKzsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgc3NlU2NvcmUgPSBleGNoYW5nZVNjb3JlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBzc2VTY29yZSA9IHRhcmdldFZhbHVlOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyDlj6rmiorlr7nmlLvlh7vmlrnmnInliKnnmoTlqIHog4HorqHlhaUgdGhyZWF0VmFsdWXvvIjljZXlkJHorqHlhaXvvIzkuI3lgZogc2FmZXR5IOWvueensOaJo+WIhu+8iQ0KICAgICAgICAgICAgaWYgKCFoYXNHdWFyZCkgew0KICAgICAgICAgICAgICAgIGNvbnN0IGhhbmdLZXkgPSBgJHt0aHJlYXRlbmVkUGllY2Uucn0sJHt0aHJlYXRlbmVkUGllY2UuY31gOw0KICAgICAgICAgICAgICAgIGlmICghc2NvcmVkSGFuZ2luZ0tleXMuaGFzKGhhbmdLZXkpKSB7DQogICAgICAgICAgICAgICAgICAgIHNjb3JlZEhhbmdpbmdLZXlzLmFkZChoYW5nS2V5KTsNCiAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXRWYWx1ZSArPSB0YXJnZXRWYWx1ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkSW5mbykgew0KICAgICAgICAgICAgICAgICAgICBpZiAoaXNBdHRhY2tlckN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghYm9hcmRJbmZvLmNhbkNhcHR1cmUuaW5jbHVkZXMoaW5mbykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2FuQ2FwdHVyZS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCFib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5pbmNsdWRlcyh0aHJlYXRlbmVkUGllY2UpKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5wdXNoKHRocmVhdGVuZWRQaWVjZSk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKHNzZVNjb3JlID4gMCkgew0KICAgICAgICAgICAgICAgIC8vIOacieagueWtkOS9huS6pOaNouS7jei1mu+8muaKmOWNiuiuoeWFpe+8m+WQjOS4gOebruagh+WPqueUseS7t+WAvOacgOS9jueahOaUu+WHu+iAheiuoeWIhuS4gOasoQ0KICAgICAgICAgICAgICAgIGNvbnN0IGhhbmdLZXkgPSBgZzoke3RocmVhdGVuZWRQaWVjZS5yfSwke3RocmVhdGVuZWRQaWVjZS5jfWA7DQogICAgICAgICAgICAgICAgaWYgKCFzY29yZWRIYW5naW5nS2V5cy5oYXMoaGFuZ0tleSkpIHsNCiAgICAgICAgICAgICAgICAgICAgc2NvcmVkSGFuZ2luZ0tleXMuYWRkKGhhbmdLZXkpOw0KICAgICAgICAgICAgICAgICAgICBpbmZvLnRocmVhdFZhbHVlICs9IHNzZVNjb3JlICogMC41Ow0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIC8vIHNzZVNjb3JlIDw9IDDvvJrkuo/mjaIv5bmz5o2i77yM5LiN6K6w5aiB6IOB5YiGDQogICAgICAgIH0NCiAgICB9DQp9Ow0KDQovLyDluK7liqnlhbPns7vmiJjmnK/lgLzorqHnrpcNCmNvbnN0IGNhbGN1bGF0ZUFzc2lzdFZhbHVlID0gKHBpZWNlc0luZm8sIGluZm8pID0+IHsNCiAgICBjb25zdCB7IHBpZWNlLCByLCBjIH0gPSBpbmZvOw0KICAgIGxldCBhc3Npc3RWYWx1ZSA9IDA7DQogICAgDQogICAgLy8gMS4g5qOA5p+l5piv5ZCm5Li65bex5pa554Ku55qE54Ku5p6277yI5Yqg5YiG77yJDQogICAgZm9yIChjb25zdCBhbGx5SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChhbGx5SW5mby5waWVjZS5jb2xvciA9PT0gcGllY2UuY29sb3IgJiYgYWxseUluZm8gIT09IGluZm8gJiYgYWxseUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuQ0FOTk9OKSB7DQogICAgICAgICAgICAvLyDmo4Dmn6Xngq7lkozlvZPliY3mo4vlrZDmmK/lkKblnKjlkIzkuIDnm7Tnur/kuIoNCiAgICAgICAgICAgIGlmIChhbGx5SW5mby5yID09PSByIHx8IGFsbHlJbmZvLmMgPT09IGMpIHsNCiAgICAgICAgICAgICAgICAvLyDmo4Dmn6Xngq7lkozlvZPliY3mo4vlrZDkuYvpl7TmmK/lkKbmsqHmnInlhbbku5bmo4vlrZANCiAgICAgICAgICAgICAgICBsZXQgaGFzU2NyZWVuID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICBpZiAoYWxseUluZm8uciA9PT0gcikgew0KICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDooYwNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbihhbGx5SW5mby5jLCBjKSArIDE7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KGFsbHlJbmZvLmMsIGMpIC0gMTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgY29sID0gc3RhcnQ7IGNvbCA8PSBlbmQ7IGNvbCsrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiZXR3ZWVuUGllY2UgPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHIgJiYgcC5jID09PSBjb2wpOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJldHdlZW5QaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhc1NjcmVlbiA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA5YiXDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oYWxseUluZm8uciwgcikgKyAxOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heChhbGx5SW5mby5yLCByKSAtIDE7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IHJvdyA9IHN0YXJ0OyByb3cgPD0gZW5kOyByb3crKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmV0d2VlblBpZWNlID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSByb3cgJiYgcC5jID09PSBjKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiZXR3ZWVuUGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYXNTY3JlZW4gPSBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoaGFzU2NyZWVuKSB7DQogICAgICAgICAgICAgICAgICAgIGFzc2lzdFZhbHVlICs9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5hc3Npc3QuY2Fubm9uU2NyZWVuVmFsdWU7IC8vIOS4uuW3seaWueeCruaPkOS+m+eCruaetu+8jOWinuWKoOaImOacr+WAvA0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyAyLiDmo4Dmn6XmmK/lkKbkuLrmlYzmlrnngq7nmoTngq7mnrbvvIjmiaPliIbvvIkNCiAgICBmb3IgKGNvbnN0IGVuZW15SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChlbmVteUluZm8ucGllY2UuY29sb3IgIT09IHBpZWNlLmNvbG9yICYmIGVuZW15SW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5DQU5OT04pIHsNCiAgICAgICAgICAgIC8vIOajgOafpeaVjOaWueeCruWSjOW9k+WJjeaji+WtkOaYr+WQpuWcqOWQjOS4gOebtOe6v+S4ig0KICAgICAgICAgICAgaWYgKGVuZW15SW5mby5yID09PSByIHx8IGVuZW15SW5mby5jID09PSBjKSB7DQogICAgICAgICAgICAgICAgLy8g5qOA5p+l5pWM5pa554Ku5ZKM5b2T5YmN5qOL5a2Q5LmL6Ze05piv5ZCm5rKh5pyJ5YW25LuW5qOL5a2QDQogICAgICAgICAgICAgICAgbGV0IGlzRW5lbXlTY3JlZW4gPSB0cnVlOw0KICAgICAgICAgICAgICAgIGlmIChlbmVteUluZm8uciA9PT0gcikgew0KICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDooYwNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbihlbmVteUluZm8uYywgYykgKyAxOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heChlbmVteUluZm8uYywgYykgLSAxOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBjb2wgPSBzdGFydDsgY29sIDw9IGVuZDsgY29sKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJldHdlZW5QaWVjZSA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gciAmJiBwLmMgPT09IGNvbCk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYmV0d2VlblBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNFbmVteVNjcmVlbiA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA5YiXDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oZW5lbXlJbmZvLnIsIHIpICsgMTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoZW5lbXlJbmZvLnIsIHIpIC0gMTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgcm93ID0gc3RhcnQ7IHJvdyA8PSBlbmQ7IHJvdysrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiZXR3ZWVuUGllY2UgPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHJvdyAmJiBwLmMgPT09IGMpOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJldHdlZW5QaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzRW5lbXlTY3JlZW4gPSBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoaXNFbmVteVNjcmVlbikgew0KICAgICAgICAgICAgICAgICAgICBhc3Npc3RWYWx1ZSAtPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuYXNzaXN0LmNhbm5vblNjcmVlblZhbHVlOyAvLyDkuLrmlYzmlrnngq7mj5Dkvpvngq7mnrbvvIzlh4/lsJHmiJjmnK/lgLzvvIjmiaPliIbvvIkNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgcmV0dXJuIGFzc2lzdFZhbHVlOw0KfTsNCg0KLy8g6Zi75oyh5YWz57O75oiY5pyv5YC86K6h566XDQpjb25zdCBjYWxjdWxhdGVCbG9ja1ZhbHVlID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBpbmZvKSA9PiB7DQogICAgY29uc3QgeyBwaWVjZSwgciwgYyB9ID0gaW5mbzsNCiAgICBsZXQgYmxvY2tWYWx1ZSA9IDA7DQogICAgY29uc3QgZW5lbXlDb2xvciA9IHBpZWNlLmNvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICANCiAgICAvLyAxLiDpmLvmjKHmlYzkuroNCiAgICAvLyAxLjEg5qOA5p+l5piv5ZCm6Zi75oyh5a+55pa56L2m55qE6YGT6LevDQogICAgZm9yIChjb25zdCBlbmVteUluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoZW5lbXlJbmZvLnBpZWNlLmNvbG9yID09PSBlbmVteUNvbG9yICYmIGVuZW15SW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5DSEFSSU9UKSB7DQogICAgICAgICAgICAvLyDmo4Dmn6XovablkozlvZPliY3mo4vlrZDmmK/lkKblnKjlkIzkuIDnm7Tnur/kuIoNCiAgICAgICAgICAgIGlmIChlbmVteUluZm8uciA9PT0gciB8fCBlbmVteUluZm8uYyA9PT0gYykgew0KICAgICAgICAgICAgICAgIC8vIOajgOafpeS4pOiAheS5i+mXtOaYr+WQpuayoeacieWFtuWug+aji+WtkA0KICAgICAgICAgICAgICAgIGxldCBpc0Jsb2NraW5nID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoZW5lbXlJbmZvLnIgPT09IHIpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA6KGMDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oZW5lbXlJbmZvLmMsIGMpICsgMTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoZW5lbXlJbmZvLmMsIGMpIC0gMTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgY29sID0gc3RhcnQ7IGNvbCA8PSBlbmQ7IGNvbCsrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiZXR3ZWVuUGllY2UgPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHIgJiYgcC5jID09PSBjb2wpOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJldHdlZW5QaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQmxvY2tpbmcgPSBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOWIlw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKGVuZW15SW5mby5yLCByKSArIDE7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KGVuZW15SW5mby5yLCByKSAtIDE7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IHJvdyA9IHN0YXJ0OyByb3cgPD0gZW5kOyByb3crKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmV0d2VlblBpZWNlID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSByb3cgJiYgcC5jID09PSBjKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiZXR3ZWVuUGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0Jsb2NraW5nID0gZmFsc2U7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGlzQmxvY2tpbmcpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5qOA5p+l5piv5ZCm6Zi75oyh5LqG6L2m55qE56e75YqoDQogICAgICAgICAgICAgICAgICAgIGJsb2NrVmFsdWUgKz0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmJsb2NrLmVuZW15Q2hhcmlvdEJsb2NrVmFsdWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIDEuMiDmo4Dmn6XmmK/lkKbliKvlr7nmlrnpqaznmoTpqazohb8NCiAgICBmb3IgKGNvbnN0IGVuZW15SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChlbmVteUluZm8ucGllY2UuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgZW5lbXlJbmZvLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkhPUlNFKSB7DQogICAgICAgICAgICBjb25zdCBob3JzZVIgPSBlbmVteUluZm8ucjsNCiAgICAgICAgICAgIGNvbnN0IGhvcnNlQyA9IGVuZW15SW5mby5jOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDpqazohb/kvY3nva7vvJrpqaznmoTlkajlm7Q45Liq5pa55ZCR55qE6IW/55qE5L2N572uDQogICAgICAgICAgICBjb25zdCBsZWdQb3NpdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIgKyAxLCBjOiBob3JzZUMgfSwgLy8g5LiL5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIgLSAxLCBjOiBob3JzZUMgfSwgLy8g5LiK5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIsIGM6IGhvcnNlQyArIDEgfSwgLy8g5Y+z5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIsIGM6IGhvcnNlQyAtIDEgfSAgLy8g5bem5pa56IW/DQogICAgICAgICAgICBdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmo4Dmn6XlvZPliY3mo4vlrZDmmK/lkKblnKjpqazohb/kvY3nva4NCiAgICAgICAgICAgIGZvciAoY29uc3QgbGVnUG9zIG9mIGxlZ1Bvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGlmIChsZWdQb3MuciA9PT0gciAmJiBsZWdQb3MuYyA9PT0gYykgew0KICAgICAgICAgICAgICAgICAgICBibG9ja1ZhbHVlICs9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5ibG9jay5lbmVteUhvcnNlQmxvY2tWYWx1ZTsgLy8g5Yir6ams6IW/77yM5aKe5Yqg5oiY5pyv5YC8DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIDEuMyDmo4Dmn6XmmK/lkKbloLXloZ7lr7nmlrnosaHnmoTosaHnnLwNCiAgICBmb3IgKGNvbnN0IGVuZW15SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChlbmVteUluZm8ucGllY2UuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgZW5lbXlJbmZvLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkVMRVBIQU5UKSB7DQogICAgICAgICAgICBjb25zdCBlbGVwaGFudFIgPSBlbmVteUluZm8ucjsNCiAgICAgICAgICAgIGNvbnN0IGVsZXBoYW50QyA9IGVuZW15SW5mby5jOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDosaHnnLzkvY3nva7vvJrosaHnmoTlkajlm7Q05Liq5pa55ZCR55qE6LGh55y85L2N572uDQogICAgICAgICAgICBjb25zdCBleWVQb3NpdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgKyAxLCBjOiBlbGVwaGFudEMgKyAxIH0sIC8vIOWPs+S4i+ixoeecvA0KICAgICAgICAgICAgICAgIHsgcjogZWxlcGhhbnRSICsgMSwgYzogZWxlcGhhbnRDIC0gMSB9LCAvLyDlt6bkuIvosaHnnLwNCiAgICAgICAgICAgICAgICB7IHI6IGVsZXBoYW50UiAtIDEsIGM6IGVsZXBoYW50QyArIDEgfSwgLy8g5Y+z5LiK6LGh55y8DQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgLSAxLCBjOiBlbGVwaGFudEMgLSAxIH0gIC8vIOW3puS4iuixoeecvA0KICAgICAgICAgICAgXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5qOA5p+l5b2T5YmN5qOL5a2Q5piv5ZCm5Zyo6LGh55y85L2N572uDQogICAgICAgICAgICBmb3IgKGNvbnN0IGV5ZVBvcyBvZiBleWVQb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBpZiAoZXllUG9zLnIgPT09IHIgJiYgZXllUG9zLmMgPT09IGMpIHsNCiAgICAgICAgICAgICAgICAgICAgYmxvY2tWYWx1ZSArPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuYmxvY2suZW5lbXlFbGVwaGFudEJsb2NrVmFsdWU7IC8vIOWgteWhnuixoeecvO+8jOWinuWKoOaImOacr+WAvA0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyAyLiDpmLvmjKHlt7HmlrnvvIjmiaPliIbvvIkNCiAgICAvLyAyLjEg5qOA5p+l5piv5ZCm6Zi75oyh5bex5pa56L2m55qE6YGT6LevDQogICAgZm9yIChjb25zdCBhbGx5SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChhbGx5SW5mby5waWVjZS5jb2xvciA9PT0gcGllY2UuY29sb3IgJiYgYWxseUluZm8gIT09IGluZm8gJiYgYWxseUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuQ0hBUklPVCkgew0KICAgICAgICAgICAgLy8g5qOA5p+l6L2m5ZKM5b2T5YmN5qOL5a2Q5piv5ZCm5Zyo5ZCM5LiA55u057q/5LiKDQogICAgICAgICAgICBpZiAoYWxseUluZm8uciA9PT0gciB8fCBhbGx5SW5mby5jID09PSBjKSB7DQogICAgICAgICAgICAgICAgLy8g5qOA5p+l5Lik6ICF5LmL6Ze05piv5ZCm5rKh5pyJ5YW25a6D5qOL5a2QDQogICAgICAgICAgICAgICAgbGV0IGlzQmxvY2tpbmcgPSB0cnVlOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChhbGx5SW5mby5yID09PSByKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOihjA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKGFsbHlJbmZvLmMsIGMpICsgMTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoYWxseUluZm8uYywgYykgLSAxOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBjb2wgPSBzdGFydDsgY29sIDw9IGVuZDsgY29sKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJldHdlZW5QaWVjZSA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gciAmJiBwLmMgPT09IGNvbCk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYmV0d2VlblBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNCbG9ja2luZyA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA5YiXDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oYWxseUluZm8uciwgcikgKyAxOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heChhbGx5SW5mby5yLCByKSAtIDE7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IHJvdyA9IHN0YXJ0OyByb3cgPD0gZW5kOyByb3crKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmV0d2VlblBpZWNlID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSByb3cgJiYgcC5jID09PSBjKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiZXR3ZWVuUGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0Jsb2NraW5nID0gZmFsc2U7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGlzQmxvY2tpbmcpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g6Zi75oyh5bex5pa56L2m6YGT6Lev77yM5omj5YiGDQogICAgICAgICAgICAgICAgICAgIGJsb2NrVmFsdWUgLT0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmJsb2NrLmFsbHlDaGFyaW90QmxvY2tQZW5hbHR5Ow0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyAyLjIg5qOA5p+l5piv5ZCm5Yir5bex5pa56ams55qE6ams6IW/DQogICAgZm9yIChjb25zdCBhbGx5SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChhbGx5SW5mby5waWVjZS5jb2xvciA9PT0gcGllY2UuY29sb3IgJiYgYWxseUluZm8gIT09IGluZm8gJiYgYWxseUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuSE9SU0UpIHsNCiAgICAgICAgICAgIGNvbnN0IGhvcnNlUiA9IGFsbHlJbmZvLnI7DQogICAgICAgICAgICBjb25zdCBob3JzZUMgPSBhbGx5SW5mby5jOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDpqazohb/kvY3nva7vvJrpqaznmoTlkajlm7Q45Liq5pa55ZCR55qE6IW/55qE5L2N572uDQogICAgICAgICAgICBjb25zdCBsZWdQb3NpdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIgKyAxLCBjOiBob3JzZUMgfSwgLy8g5LiL5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIgLSAxLCBjOiBob3JzZUMgfSwgLy8g5LiK5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIsIGM6IGhvcnNlQyArIDEgfSwgLy8g5Y+z5pa56IW/DQogICAgICAgICAgICAgICAgeyByOiBob3JzZVIsIGM6IGhvcnNlQyAtIDEgfSAgLy8g5bem5pa56IW/DQogICAgICAgICAgICBdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmo4Dmn6XlvZPliY3mo4vlrZDmmK/lkKblnKjpqazohb/kvY3nva4NCiAgICAgICAgICAgIGZvciAoY29uc3QgbGVnUG9zIG9mIGxlZ1Bvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGlmIChsZWdQb3MuciA9PT0gciAmJiBsZWdQb3MuYyA9PT0gYykgew0KICAgICAgICAgICAgICAgICAgICBibG9ja1ZhbHVlIC09IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5ibG9jay5hbGx5SG9yc2VCbG9ja1BlbmFsdHk7IC8vIOWIq+W3seaWuemprOiFv++8jOaJo+WIhg0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyAyLjMg5qOA5p+l5piv5ZCm5aC15aGe5bex5pa56LGh55qE6LGh55y8DQogICAgZm9yIChjb25zdCBhbGx5SW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChhbGx5SW5mby5waWVjZS5jb2xvciA9PT0gcGllY2UuY29sb3IgJiYgYWxseUluZm8gIT09IGluZm8gJiYgYWxseUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuRUxFUEhBTlQpIHsNCiAgICAgICAgICAgIGNvbnN0IGVsZXBoYW50UiA9IGFsbHlJbmZvLnI7DQogICAgICAgICAgICBjb25zdCBlbGVwaGFudEMgPSBhbGx5SW5mby5jOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDosaHnnLzkvY3nva7vvJrosaHnmoTlkajlm7Q05Liq5pa55ZCR55qE6LGh55y85L2N572uDQogICAgICAgICAgICBjb25zdCBleWVQb3NpdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgKyAxLCBjOiBlbGVwaGFudEMgKyAxIH0sIC8vIOWPs+S4i+ixoeecvA0KICAgICAgICAgICAgICAgIHsgcjogZWxlcGhhbnRSICsgMSwgYzogZWxlcGhhbnRDIC0gMSB9LCAvLyDlt6bkuIvosaHnnLwNCiAgICAgICAgICAgICAgICB7IHI6IGVsZXBoYW50UiAtIDEsIGM6IGVsZXBoYW50QyArIDEgfSwgLy8g5Y+z5LiK6LGh55y8DQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgLSAxLCBjOiBlbGVwaGFudEMgLSAxIH0gIC8vIOW3puS4iuixoeecvA0KICAgICAgICAgICAgXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5qOA5p+l5b2T5YmN5qOL5a2Q5piv5ZCm5Zyo6LGh55y85L2N572uDQogICAgICAgICAgICBmb3IgKGNvbnN0IGV5ZVBvcyBvZiBleWVQb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBpZiAoZXllUG9zLnIgPT09IHIgJiYgZXllUG9zLmMgPT09IGMpIHsNCiAgICAgICAgICAgICAgICAgICAgYmxvY2tWYWx1ZSAtPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuYmxvY2suYWxseUVsZXBoYW50QmxvY2tQZW5hbHR5OyAvLyDloLXloZ7lt7HmlrnosaHnnLzvvIzmiaPliIYNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgcmV0dXJuIGJsb2NrVmFsdWU7DQp9Ow0KDQoNCi8vIC0tLSBUeXBlcyAoSW5saW5lZCB0byBhdm9pZCBpbXBvcnQgaXNzdWVzIGluIFdvcmtlcikgLS0tDQovLyAvLyB0eXBlIENvbG9yIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAncmVkJyB8ICdibGFjayc7DQovLyAvLyB0eXBlIFBpZWNlVHlwZSAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgJ2dlbmVyYWwnIHwgJ2Fkdmlzb3InIHwgJ2VsZXBoYW50JyB8ICdob3JzZScgfCAnY2hhcmlvdCcgfCAnY2Fubm9uJyB8ICdzb2xkaWVyJzsNCi8vIC8vIGludGVyZmFjZSBQaWVjZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gaW50ZXJmYWNlIFBvc2l0aW9uIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQovLyAvLyBpbnRlcmZhY2UgTW92ZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gdHlwZSBCb2FyZCAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgKFBpZWNlIHwgbnVsbClbXVtdOw0KDQovLyAtLS0gT3BlbmluZyBCb29rIFR5cGVzIC0tLQ0KLy8gT3BlbmluZyBCb29rIEVudHJ5IC0gcmVwcmVzZW50cyBwb3NzaWJsZSBtb3ZlcyBmb3IgYSBwb3NpdGlvbg0KLy8gaW50ZXJmYWNlIEJvb2tFbnRyeSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KDQovLyBJbmRpdmlkdWFsIG1vdmUgaW4gb3BlbmluZyBib29rIHdpdGggbWV0YWRhdGENCi8vIGludGVyZmFjZSBCb29rTW92ZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KDQovLyAtLS0gWm9icmlzdCBIYXNoaW5nIGZvciBPcGVuaW5nIEJvb2sgLS0tDQovLyBFYWNoIHBpZWNlIHR5cGUvY29sb3IvcG9zaXRpb24gZ2V0cyBhIHVuaXF1ZSByYW5kb20gNTMtYml0IGludGVnZXINCi8vIFVzZXMgc2VlZGVkIFJORyBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nDQpjbGFzcyBab2JyaXN0SGFzaGVyIHsNCiAgICBoYXNoVGFibGU7ICAvLyBbcm93XVtjb2xdW3BpZWNlSW5kZXhdDQogICAgcGllY2VUb0luZGV4Ow0KDQogICAgY29uc3RydWN0b3IoKSB7DQogICAgICAgIHRoaXMucGllY2VUb0luZGV4ID0gbmV3IE1hcChbDQogICAgICAgICAgICBbJ3JlZC1nZW5lcmFsJywgMF0sDQogICAgICAgICAgICBbJ3JlZC1hZHZpc29yJywgMV0sDQogICAgICAgICAgICBbJ3JlZC1lbGVwaGFudCcsIDJdLA0KICAgICAgICAgICAgWydyZWQtaG9yc2UnLCAzXSwNCiAgICAgICAgICAgIFsncmVkLWNoYXJpb3QnLCA0XSwNCiAgICAgICAgICAgIFsncmVkLWNhbm5vbicsIDVdLA0KICAgICAgICAgICAgWydyZWQtc29sZGllcicsIDZdLA0KICAgICAgICAgICAgWydibGFjay1nZW5lcmFsJywgN10sDQogICAgICAgICAgICBbJ2JsYWNrLWFkdmlzb3InLCA4XSwNCiAgICAgICAgICAgIFsnYmxhY2stZWxlcGhhbnQnLCA5XSwNCiAgICAgICAgICAgIFsnYmxhY2staG9yc2UnLCAxMF0sDQogICAgICAgICAgICBbJ2JsYWNrLWNoYXJpb3QnLCAxMV0sDQogICAgICAgICAgICBbJ2JsYWNrLWNhbm5vbicsIDEyXSwNCiAgICAgICAgICAgIFsnYmxhY2stc29sZGllcicsIDEzXSwNCiAgICAgICAgXSk7DQoNCiAgICAgICAgLy8gSW5pdGlhbGl6ZSByYW5kb20gaGFzaCB2YWx1ZXMgdXNpbmcgc2VlZGVkIFJORyAoNTMtYml0IGludGVnZXJzIHRvIGF2b2lkIHByZWNpc2lvbiBpc3N1ZXMpDQogICAgICAgIHRoaXMuaGFzaFRhYmxlID0gW107DQogICAgICAgIGNvbnN0IE1BWF9TQUZFID0gMHgxRkZGRkZGRkZGRkZGRjsgLy8gMl41MyAtIDENCiAgICAgICAgDQogICAgICAgIC8vIFNpbXBsZSBzZWVkZWQgUk5HIChMQ0cgLSBMaW5lYXIgQ29uZ3J1ZW50aWFsIEdlbmVyYXRvcikNCiAgICAgICAgbGV0IHNlZWQgPSAxMjM0NTY3ODk7IC8vIEZpeGVkIHNlZWQgZm9yIGRldGVybWluaXN0aWMgaGFzaGluZw0KICAgICAgICBjb25zdCBzZWVkZWRSYW5kb20gPSAoKSA9PiB7DQogICAgICAgICAgICBzZWVkID0gKHNlZWQgKiAxMTAzNTE1MjQ1ICsgMTIzNDUpICYgMHg3ZmZmZmZmZjsNCiAgICAgICAgICAgIHJldHVybiBzZWVkIC8gMHg3ZmZmZmZmZjsNCiAgICAgICAgfTsNCg0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgIHRoaXMuaGFzaFRhYmxlW3JdID0gW107DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgIHRoaXMuaGFzaFRhYmxlW3JdW2NdID0gW107DQogICAgICAgICAgICAgICAgZm9yIChsZXQgcCA9IDA7IHAgPCAxNDsgcCsrKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIGRldGVybWluaXN0aWMgNTMtYml0IGludGVnZXINCiAgICAgICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY11bcF0gPSBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENvbXB1dGUgaGFzaCBmb3IgYSBib2FyZCBwb3NpdGlvbg0KICAgICAqLw0KICAgIGhhc2goYm9hcmQpIHsNCiAgICAgICAgbGV0IGggPSAwOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7cGllY2UuY29sb3J9LSR7cGllY2UudHlwZX1gOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwaWVjZUlkeCA9IHRoaXMucGllY2VUb0luZGV4LmdldChrZXkpOw0KICAgICAgICAgICAgICAgICAgICBpZiAocGllY2VJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgaCBePSB0aGlzLmhhc2hUYWJsZVtyXVtjXVtwaWVjZUlkeF07DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIGg7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogTWlycm9yIGEgYm9hcmQgaG9yaXpvbnRhbGx5IChmb3Igc3ltbWV0cnkgZGV0ZWN0aW9uKQ0KICAgICAqLw0KICAgIG1pcnJvckJvYXJkKGJvYXJkKSB7DQogICAgICAgIGNvbnN0IG1pcnJvcmVkID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkpOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgbWlycm9yZWRbcl1bOCAtIGNdID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIG1pcnJvcmVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIE1pcnJvciBhIG1vdmUgaG9yaXpvbnRhbGx5DQogICAgICovDQogICAgbWlycm9yTW92ZShtb3ZlKSB7DQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiA4IC0gbW92ZS5mcm9tLmMgfSwNCiAgICAgICAgICAgIHRvOiB7IHI6IG1vdmUudG8uciwgYzogOCAtIG1vdmUudG8uYyB9DQogICAgICAgIH07DQogICAgfQ0KDQogICAgLyoqDQogICAgICogSW5jcmVtZW50YWxseSB1cGRhdGUgaGFzaCBhZnRlciBhIG1vdmUgKG11Y2ggZmFzdGVyIHRoYW4gcmVoYXNoaW5nKQ0KICAgICAqLw0KICAgIHVwZGF0ZUhhc2goY3VycmVudEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZFBpZWNlICkgew0KICAgICAgICBsZXQgbmV3SGFzaCA9IGN1cnJlbnRIYXNoOw0KDQogICAgICAgIC8vIFJlbW92ZSBwaWVjZSBmcm9tIHNvdXJjZSBwb3NpdGlvbg0KICAgICAgICBjb25zdCBtb3ZpbmdJZHggPSB0aGlzLnBpZWNlVG9JbmRleC5nZXQobW92aW5nUGllY2UpOw0KICAgICAgICBpZiAobW92aW5nSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXVttb3ZpbmdJZHhdOw0KICAgICAgICB9DQoNCiAgICAgICAgLy8gUmVtb3ZlIGNhcHR1cmVkIHBpZWNlIGlmIGFueQ0KICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgew0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRJZHggPSB0aGlzLnBpZWNlVG9JbmRleC5nZXQoY2FwdHVyZWRQaWVjZSk7DQogICAgICAgICAgICBpZiAoY2FwdHVyZWRJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS50by5yXVttb3ZlLnRvLmNdW2NhcHR1cmVkSWR4XTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIC8vIEFkZCBwaWVjZSB0byBkZXN0aW5hdGlvbg0KICAgICAgICBpZiAobW92aW5nSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS50by5yXVttb3ZlLnRvLmNdW21vdmluZ0lkeF07DQogICAgICAgIH0NCg0KICAgICAgICByZXR1cm4gbmV3SGFzaDsNCiAgICB9DQp9DQoNCi8qKg0KICogT3BlbmluZyBCb29rIE1hbmFnZXINCiAqLw0KY2xhc3MgT3BlbmluZ0Jvb2sgew0KICAgIGJvb2s7ICAvLyBab2JyaXN0IGhhc2ggLT4gbW92ZXMNCiAgICBoYXNoZXI7DQogICAgZW5hYmxlZDsNCiAgICBtYXhQbHk7ICAvLyBNYXhpbXVtIHBseSB0byB1c2Ugb3BlbmluZyBib29rIChlLmcuLCAyMCkNCg0KICAgIGNvbnN0cnVjdG9yKG1heFBseSA9IDEyKSB7DQogICAgICAgIHRoaXMuYm9vayA9IG5ldyBNYXAoKTsNCiAgICAgICAgdGhpcy5oYXNoZXIgPSBuZXcgWm9icmlzdEhhc2hlcigpOw0KICAgICAgICB0aGlzLmVuYWJsZWQgPSB0cnVlOw0KICAgICAgICB0aGlzLm1heFBseSA9IG1heFBseTsNCiAgICAgICAgdGhpcy5pbml0aWFsaXplQm9vaygpOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEluaXRpYWxpemUgd2l0aCBjb21tb24gQ2hpbmVzZSBDaGVzcyBvcGVuaW5ncw0KICAgICAqLw0KICAgIGluaXRpYWxpemVCb29rKCkgew0KICAgICAgICAvLyBBZGQgY2xhc3NpYyBDaGluZXNlIENoZXNzIG9wZW5pbmdzIG1hbnVhbGx5DQogICAgICAgIA0KICAgICAgICAvKg0KICAgICAgICAvLyAxLiDkuK3ngq7ov4fmsrPovablr7nlsY/po47pqazlubPngq7lr7novaYgKENlbnRyYWwgQ2Fubm9uIHZzIFNjcmVlbiBIb3JzZXMpDQogICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmUoWw0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDcsIGM6IDcgfSwgdG86IHsgcjogNywgYzogNCB9IH0sICAvLyAxLiDngq7kuozlubPkupQNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiA3IH0sIHRvOiB7IHI6IDIsIGM6IDYgfSB9LCAgLy8gMS4uLiDpqaw46L+bNw0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDcgfSwgdG86IHsgcjogNywgYzogNiB9IH0sICAvLyAyLiDpqazkuozov5vkuIkNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiA4IH0sIHRvOiB7IHI6IDAsIGM6IDcgfSB9LCAgLy8gMi4uLiDovaY55bmzOCAgICAgICAgICAgDQogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogOCB9LCB0bzogeyByOiA5LCBjOiA3IH0gfSwgIC8vIDMuIOi9puS4gOW5s+S6jA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDMsIGM6IDYgfSwgdG86IHsgcjogNCwgYzogNiB9IH0sICAvLyAzLi4uIOWNkjfov5sxDQogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogNyB9LCB0bzogeyByOiAzLCBjOiA3IH0gfSwgIC8vIDQuIOi9puS6jOi/m+WFrQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDEgfSwgdG86IHsgcjogMiwgYzogMiB9IH0sICAvLyA0Li4uIOmprDLov5szDQogICAgICAgICAgICB7IGZyb206IHsgcjogNiwgYzogMiB9LCB0bzogeyByOiA1LCBjOiAyIH0gfSwgIC8vIDUuIOWFteS4g+i/m+S4gA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDIsIGM6IDcgfSwgdG86IHsgcjogMiwgYzogOCB9IH0sICAvLyA1Li4uIOeCrjjlubM5DQogICAgICAgICAgICB7IGZyb206IHsgcjogMywgYzogNyB9LCB0bzogeyByOiAzLCBjOiA2IH0gfSwgIC8vIDYuIOi9puS6jOW5s+S4iQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDIsIGM6IDggfSwgdG86IHsgcjogMSwgYzogOCB9IH0sICAvLyA2Li4uIOeCrjnpgIAxICAgICAgICAgIA0KICAgICAgICBdLCBbODUsIDg1LCA5NSwgOTAsIDkwLCA4NSwgODUsIDgwLCA4NSwgODUsIDg1LCA4NV0pOw0KDQogICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tTm90YXRpb24oWw0KICAgICAgICAgICAgJ+eCruS6jOW5s+S6lCcsICfpqaw46L+bNycsICfpqazkuozov5vkuIknLCAn6L2mOeW5szgnLCAn6L2m5LiA5bmz5LqMJywgJ+WNkjfov5sxJywNCiAgICAgICAgICAgICfovabkuozov5vlha0nLCAn6amsMui/mzMnLCAn5YW15LiD6L+b5LiAJywgJ+eCrjjlubM5JywgJ+i9puS6jOW5s+S4iScsICfngq456YCAMScsDQogICAgICAgICAgICBdLCBbODUsIDg1LCA5NSwgOTAsIDkwLCA4NSwgODUsIDgwLCA4NSwgODUsIDg1LCA4NV0pOw0KDQogICAgICAgICAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21TdHJpbmcoWw0KICAgICAgICAgICAgJ+eCruS6jOW5s+S6lCDpqaw46L+bNyDpqazkuozov5vkuIkg6L2mOeW5szgg6L2m5LiA5bmz5LqMIOWNkjfov5sxIOi9puS6jOi/m+WFrSDpqawy6L+bMyDlhbXkuIPov5vkuIAg54KuOOW5szkg6L2m5LqM5bmz5LiJIOeCrjnpgIAxJw0KICAgICAgICBdLCBbODUsIDg1LCA5NSwgOTAsIDkwLCA4NSwgODUsIDgwLCA4NSwgODUsIDg1LCA4NV0pOw0KICAgICAgICAqLw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEFkZCBhbiBvcGVuaW5nIGxpbmUgdG8gdGhlIGJvb2sNCiAgICAgKiBAcGFyYW0gbW92ZXMgQXJyYXkgb2YgbW92ZXMgcmVwcmVzZW50aW5nIGFuIG9wZW5pbmcgbGluZQ0KICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIHdlaWdodHMgZm9yIGVhY2ggbW92ZSAoZGVmYXVsdCAxMDAgZm9yIGFsbCkNCiAgICAgKi8NCiAgICBhZGRPcGVuaW5nTGluZShtb3Zlcywgd2VpZ2h0cykgew0KICAgICAgICAvLyBTdGFydCB3aXRoIGluaXRpYWwgYm9hcmQgcG9zaXRpb24NCiAgICAgICAgY29uc3QgYm9hcmQgPSB0aGlzLmNyZWF0ZUluaXRpYWxCb2FyZCgpOw0KICAgICAgICBsZXQgY3VycmVudEhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKGJvYXJkKTsNCg0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbaV07DQogICAgICAgICAgICBjb25zdCB3ZWlnaHQgPSB3ZWlnaHRzPy5baV0gPz8gMTAwOw0KDQogICAgICAgICAgICAvLyBHZXQgb3IgY3JlYXRlIGJvb2sgZW50cnkgZm9yIHRoaXMgcG9zaXRpb24NCiAgICAgICAgICAgIGxldCBlbnRyeSA9IHRoaXMuYm9vay5nZXQoY3VycmVudEhhc2gpOw0KICAgICAgICAgICAgaWYgKCFlbnRyeSkgew0KICAgICAgICAgICAgICAgIGVudHJ5ID0geyBtb3ZlczogW10gfTsNCiAgICAgICAgICAgICAgICB0aGlzLmJvb2suc2V0KGN1cnJlbnRIYXNoLCBlbnRyeSk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEFkZCBtb3ZlIGlmIG5vdCBhbHJlYWR5IHByZXNlbnQNCiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nTW92ZSA9IGVudHJ5Lm1vdmVzLmZpbmQoDQogICAgICAgICAgICAgICAgbSA9PiBtLmZyb20uciA9PT0gbW92ZS5mcm9tLnIgJiYgbS5mcm9tLmMgPT09IG1vdmUuZnJvbS5jICYmDQogICAgICAgICAgICAgICAgICAgICBtLnRvLnIgPT09IG1vdmUudG8uciAmJiBtLnRvLmMgPT09IG1vdmUudG8uYw0KICAgICAgICAgICAgKTsNCg0KICAgICAgICAgICAgaWYgKCFleGlzdGluZ01vdmUpIHsNCiAgICAgICAgICAgICAgICBlbnRyeS5tb3Zlcy5wdXNoKHsNCiAgICAgICAgICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogbW92ZS5mcm9tLmMgfSwNCiAgICAgICAgICAgICAgICAgICAgdG86IHsgcjogbW92ZS50by5yLCBjOiBtb3ZlLnRvLmMgfSwNCiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiB3ZWlnaHQNCiAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8gVXBkYXRlIHdlaWdodCBpZiBtb3ZlIGFscmVhZHkgZXhpc3RzICh0YWtlIG1heGltdW0pDQogICAgICAgICAgICAgICAgZXhpc3RpbmdNb3ZlLndlaWdodCA9IE1hdGgubWF4KGV4aXN0aW5nTW92ZS53ZWlnaHQsIHdlaWdodCk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIE1ha2UgdGhlIG1vdmUgb24gdGhlIGJvYXJkDQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW21vdmUudG8ucl1bbW92ZS50by5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFwaWVjZSkgYnJlYWs7IC8vIEludmFsaWQgbGluZQ0KDQogICAgICAgICAgICBjb25zdCBwaWVjZUtleSA9IGAke3BpZWNlLmNvbG9yfS0ke3BpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkS2V5ID0gY2FwdHVyZWQgPyBgJHtjYXB0dXJlZC5jb2xvcn0tJHtjYXB0dXJlZC50eXBlfWAgOiB1bmRlZmluZWQ7DQoNCiAgICAgICAgICAgIC8vIFVwZGF0ZSBoYXNoIGluY3JlbWVudGFsbHkNCiAgICAgICAgICAgIGN1cnJlbnRIYXNoID0gdGhpcy5oYXNoZXIudXBkYXRlSGFzaChjdXJyZW50SGFzaCwgbW92ZSwgcGllY2VLZXksIGNhcHR1cmVkS2V5KTsNCg0KICAgICAgICAgICAgLy8gQXBwbHkgbW92ZQ0KICAgICAgICAgICAgYm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdID0gcGllY2U7DQogICAgICAgICAgICBib2FyZFttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdID0gbnVsbDsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEdldCBiZXN0IG1vdmUgZnJvbSBvcGVuaW5nIGJvb2sgZm9yIGN1cnJlbnQgcG9zaXRpb24NCiAgICAgKiBAcGFyYW0gYm9hcmQgQ3VycmVudCBib2FyZCBzdGF0ZQ0KICAgICAqIEBwYXJhbSBwbHkgQ3VycmVudCBwbHkgbnVtYmVyICgwID0gc3RhcnQgb2YgZ2FtZSkNCiAgICAgKiBAcmV0dXJucyBNb3ZlIGZyb20gYm9vaywgb3IgbnVsbCBpZiBwb3NpdGlvbiBub3QgaW4gYm9vaw0KICAgICAqLw0KICAgIGdldEJvb2tNb3ZlKGJvYXJkLCBwbHkpew0KICAgICAgICAvLyBEb24ndCB1c2UgYm9vayBpZiBkaXNhYmxlZCBvciBwYXN0IG1heCBwbHkNCiAgICAgICAgaWYgKCF0aGlzLmVuYWJsZWQgfHwgcGx5ID49IHRoaXMubWF4UGx5KSB7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnT3BlbmluZyBib29rIGRpc2FibGVkIG9yIHBhc3QgbWF4IHBseScsIHsgZW5hYmxlZDogdGhpcy5lbmFibGVkLCBtYXhQbHk6IHRoaXMubWF4UGx5LCBwbHk6IHBseSB9KTsNCiAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvL2NvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgZ2V0Qm9va01vdmUgY2FsbGVkJywgeyBwbHkgfSk7DQogICAgICAgIA0KICAgICAgICAvLyBUcnkgdG8gZmluZCBtb3ZlIGZvciBjdXJyZW50IHBvc2l0aW9uDQogICAgICAgIGNvbnN0IGhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKGJvYXJkKTsNCiAgICAgICAgLy9jb25zb2xlLmxvZygnQ3VycmVudCBwb3NpdGlvbiBoYXNoOicsIGhhc2gpOw0KICAgICAgICANCiAgICAgICAgbGV0IGVudHJ5ID0gdGhpcy5ib29rLmdldChoYXNoKTsNCiAgICAgICAgLy9jb25zb2xlLmxvZygnRW50cnkgZm91bmQgZm9yIGN1cnJlbnQgaGFzaDonLCBlbnRyeSA/IGVudHJ5Lm1vdmVzLmxlbmd0aCArICcgbW92ZXMnIDogJ251bGwnKTsNCiAgICAgICAgaWYgKGVudHJ5ICYmIGVudHJ5Lm1vdmVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdBbGwgcG9zc2libGUgYm9vayBtb3ZlcyB3aXRoIHdlaWdodHM6JywgSlNPTi5zdHJpbmdpZnkoZW50cnkubW92ZXMpKTsNCiAgICAgICAgICAgIC8vIENhbGN1bGF0ZSB0b3RhbCB3ZWlnaHQNCiAgICAgICAgICAgIGNvbnN0IHRvdGFsV2VpZ2h0ID0gZW50cnkubW92ZXMucmVkdWNlKChzdW0sIG1vdmUpID0+IHN1bSArIG1vdmUud2VpZ2h0LCAwKTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdUb3RhbCB3ZWlnaHQ6JywgdG90YWxXZWlnaHQpOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICBsZXQgbWlycm9yZWRNb3ZlID0gZmFsc2U7DQoNCiAgICAgICAgLy8gSWYgbm90IGZvdW5kLCB0cnkgbWlycm9yZWQgcG9zaXRpb24NCiAgICAgICAgaWYgKCFlbnRyeSB8fCBlbnRyeS5tb3Zlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIGNvbnN0IG1pcnJvcmVkQm9hcmQgPSB0aGlzLmhhc2hlci5taXJyb3JCb2FyZChib2FyZCk7DQogICAgICAgICAgICBjb25zdCBtaXJyb3JlZEhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKG1pcnJvcmVkQm9hcmQpOw0KICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIGVudHJ5IGZvdW5kLCB0cnlpbmcgbWlycm9yZWQgcG9zaXRpb246JywgbWlycm9yZWRIYXNoKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgZW50cnkgPSB0aGlzLmJvb2suZ2V0KG1pcnJvcmVkSGFzaCk7DQogICAgICAgICAgICBpZiAoZW50cnkgJiYgZW50cnkubW92ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ0VudHJ5IGZvdW5kIGZvciBtaXJyb3JlZCBoYXNoOicsIGVudHJ5Lm1vdmVzLmxlbmd0aCArICcgbW92ZXMnKTsNCiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdPcmlnaW5hbCBtaXJyb3IgbW92ZXM6JywgSlNPTi5zdHJpbmdpZnkoZW50cnkubW92ZXMpKTsNCiAgICAgICAgICAgICAgICBtaXJyb3JlZE1vdmUgPSB0cnVlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdObyBlbnRyeSBmb3VuZCBmb3IgbWlycm9yZWQgaGFzaCcpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgaWYgKCFlbnRyeSB8fCBlbnRyeS5tb3Zlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBtb3ZlIG5vdCBmb3VuZCBmb3IgY3VycmVudCBwb3NpdGlvbicpOw0KICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgIH0NCg0KICAgICAgICAvLyBTZWxlY3QgbW92ZSBiYXNlZCBvbiB3ZWlnaHRzDQogICAgICAgIGNvbnN0IHNlbGVjdGVkTW92ZSA9IHRoaXMuc2VsZWN0V2VpZ2h0ZWRNb3ZlKGVudHJ5Lm1vdmVzKTsNCiAgICAgICAgY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBtb3ZlIHNlbGVjdGVkOicsIHNlbGVjdGVkTW92ZSk7DQogICAgICAgIA0KICAgICAgICAvLyBJZiB3ZSB1c2VkIG1pcnJvcmVkIHBvc2l0aW9uLCBtaXJyb3IgdGhlIG1vdmUgYmFjaw0KICAgICAgICBpZiAoc2VsZWN0ZWRNb3ZlICYmIG1pcnJvcmVkTW92ZSkgew0KICAgICAgICAgICAgLy8gY29uc29sZS5sb2coJ1NlbGVjdGVkIG1pcnJvciBtb3ZlIGJlZm9yZSBjb252ZXJzaW9uOicsIEpTT04uc3RyaW5naWZ5KHNlbGVjdGVkTW92ZSkpOw0KICAgICAgICAgICAgY29uc3QgbWlycm9yZWRNb3ZlQ29udmVydGVkID0gdGhpcy5oYXNoZXIubWlycm9yTW92ZShzZWxlY3RlZE1vdmUpOw0KICAgICAgICAgICAgLy8gY29uc29sZS5sb2coJ0NvbnZlcnRlZCBtaXJyb3IgbW92ZTonLCBKU09OLnN0cmluZ2lmeShtaXJyb3JlZE1vdmVDb252ZXJ0ZWQpKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIG1pcnJvcmVkIG1vdmUgaGFzIHZhbGlkIHN0cnVjdHVyZQ0KICAgICAgICAgICAgaWYgKG1pcnJvcmVkTW92ZUNvbnZlcnRlZCAmJiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbSAmJiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQudG8gJiYNCiAgICAgICAgICAgICAgICB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tLmMgPT09ICdudW1iZXInICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIG1pcnJvcmVkTW92ZUNvbnZlcnRlZDsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ01pcnJvcmVkIG1vdmUgaGFzIGludmFsaWQgc3RydWN0dXJlLCByZXR1cm5pbmcgbnVsbCcpOw0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKHNlbGVjdGVkTW92ZSkgew0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHNlbGVjdGVkIG1vdmUgaGFzIHZhbGlkIHN0cnVjdHVyZQ0KICAgICAgICAgICAgaWYgKHNlbGVjdGVkTW92ZS5mcm9tICYmIHNlbGVjdGVkTW92ZS50byAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBzZWxlY3RlZE1vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLmZyb20uYyA9PT0gJ251bWJlcicgJiYNCiAgICAgICAgICAgICAgICB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLnRvLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBzZWxlY3RlZE1vdmUudG8uYyA9PT0gJ251bWJlcicpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gc2VsZWN0ZWRNb3ZlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU2VsZWN0ZWQgbW92ZSBoYXMgaW52YWxpZCBzdHJ1Y3R1cmUsIHJldHVybmluZyBudWxsJyk7DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIHJldHVybiBudWxsOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIFNlbGVjdCBhIG1vdmUgcmFuZG9tbHkgYmFzZWQgb24gd2VpZ2h0cw0KICAgICAqIEhpZ2hlciB3ZWlnaHQgPSBtb3JlIGxpa2VseSB0byBiZSBzZWxlY3RlZA0KICAgICAqLw0KICAgIHNlbGVjdFdlaWdodGVkTW92ZShtb3Zlcykgew0KICAgICAgICAvLyBDYWxjdWxhdGUgdG90YWwgd2VpZ2h0DQogICAgICAgIGNvbnN0IHRvdGFsV2VpZ2h0ID0gbW92ZXMucmVkdWNlKChzdW0sIG1vdmUpID0+IHN1bSArIG1vdmUud2VpZ2h0LCAwKTsNCg0KICAgICAgICAvLyBHZW5lcmF0ZSByYW5kb20gbnVtYmVyDQogICAgICAgIGxldCByYW5kb20gPSBNYXRoLnJhbmRvbSgpICogdG90YWxXZWlnaHQ7DQoNCiAgICAgICAgLy8gU2VsZWN0IG1vdmUNCiAgICAgICAgZm9yIChjb25zdCBtb3ZlIG9mIG1vdmVzKSB7DQogICAgICAgICAgICByYW5kb20gLT0gbW92ZS53ZWlnaHQ7DQogICAgICAgICAgICBpZiAocmFuZG9tIDw9IDApIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiBtb3ZlLmZyb20uYyB9LCB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IG1vdmUudG8uYyB9DQogICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIC8vIEZhbGxiYWNrIChzaG91bGQgbmV2ZXIgcmVhY2ggaGVyZSkNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIGZyb206IHsgcjogbW92ZXNbMF0uZnJvbS5yLCBjOiBtb3Zlc1swXS5mcm9tLmMgfSwgdG86IHsgcjogbW92ZXNbMF0udG8uciwgYzogbW92ZXNbMF0udG8uYyB9DQogICAgICAgIH07DQogICAgfQ0KDQogICAgLyoqDQogICAgICogSGVscGVyIHRvIGNyZWF0ZSBpbml0aWFsIGJvYXJkIChuZWVkZWQgZm9yIGJvb2sgaW5pdGlhbGl6YXRpb24pDQogICAgICovDQogICAgY3JlYXRlSW5pdGlhbEJvYXJkKCkgew0KICAgICAgICBjb25zdCBib2FyZCA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpKTsNCiAgICAgICAgDQogICAgICAgIC8vIFJlZCBwaWVjZXMgKGJvdHRvbSAtIHI9MC0yKQ0KICAgICAgICBib2FyZFswXVswXSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bMV0gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVsyXSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzNdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs0XSA9IHsgdHlwZTogJ2dlbmVyYWwnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bNV0gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzZdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bN10gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs4XSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMl1bMV0gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMl1bN10gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bMF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzJdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVs0XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bNl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzhdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KDQogICAgICAgIC8vIEJsYWNrIHBpZWNlcyAodG9wIC0gcj03LTkpDQogICAgICAgIGJvYXJkWzldWzBdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzFdID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVsyXSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bM10gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bNF0gPSB7IHR5cGU6ICdnZW5lcmFsJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bNV0gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bNl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzddID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs4XSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs3XVsxXSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzddWzddID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bMF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bMl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bNF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bNl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bOF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCg0KICAgICAgICByZXR1cm4gYm9hcmQ7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogRW5hYmxlIG9yIGRpc2FibGUgb3BlbmluZyBib29rDQogICAgICovDQogICAgc2V0RW5hYmxlZChlbmFibGVkKSB7DQogICAgICAgIHRoaXMuZW5hYmxlZCA9IGVuYWJsZWQ7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQ2hlY2sgaWYgb3BlbmluZyBib29rIGlzIGVuYWJsZWQNCiAgICAgKi8NCiAgICBpc0VuYWJsZWQoKSB7DQogICAgICAgIHJldHVybiB0aGlzLmVuYWJsZWQ7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogR2V0IHN0YXRpc3RpY3MgYWJvdXQgdGhlIG9wZW5pbmcgYm9vaw0KICAgICAqLw0KICAgIGdldFN0YXRzKCkgew0KICAgICAgICBsZXQgdG90YWxNb3ZlcyA9IDA7DQogICAgICAgIHRoaXMuYm9vay5mb3JFYWNoKGVudHJ5ID0+IHsNCiAgICAgICAgICAgIHRvdGFsTW92ZXMgKz0gZW50cnkubW92ZXMubGVuZ3RoOw0KICAgICAgICB9KTsNCg0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgcG9zaXRpb25zOiB0aGlzLmJvb2suc2l6ZSwNCiAgICAgICAgICAgIHRvdGFsTW92ZXMNCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBBZGQgb3BlbmluZyBsaW5lIGZyb20gdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbg0KICAgICAqIEBwYXJhbSBub3RhdGlvbiBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24gKGUuZy4sIFsn54Ku5LqM5bmz5LqUJywgJ+mprDjov5s3J10pDQogICAgICogQHBhcmFtIHdlaWdodHMgT3B0aW9uYWwgYXJyYXkgb2Ygd2VpZ2h0cyBmb3IgZWFjaCBtb3ZlDQogICAgICovDQogICAgYWRkT3BlbmluZ0xpbmVGcm9tTm90YXRpb24obm90YXRpb24sIHdlaWdodHMpIHsNCiAgICAgICAgLy8gQ29udmVydCB0cmFkaXRpb25hbCBub3RhdGlvbiB0byBjb29yZGluYXRlIGZvcm1hdA0KICAgICAgICBjb25zdCBtb3ZlcyA9IHRoaXMubm90YXRpb25Ub01vdmVzKG5vdGF0aW9uKTsNCiAgICAgICAgLy8gQWRkIHRoZSBtb3ZlcyB0byB0aGUgb3BlbmluZyBib29rDQogICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmUobW92ZXMsIHdlaWdodHMpOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEFkZCBvcGVuaW5nIGxpbmUgZnJvbSBzdHJpbmcgd2l0aCBzcGFjZS1zZXBhcmF0ZWQgdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbg0KICAgICAqIEBwYXJhbSBub3RhdGlvbkFycmF5IEFycmF5IG9mIHN0cmluZ3MsIGVhY2ggY29udGFpbmluZyBzcGFjZS1zZXBhcmF0ZWQgbW92ZXMgKGUuZy4sIFsn54Ku5LqM5bmz5LqUIOmprDjov5s3IOi9puS4gOW5s+S6jCddKQ0KICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIGFycmF5IG9mIHdlaWdodHMgZm9yIGVhY2ggbW92ZQ0KICAgICAqLw0KICAgIGFkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyhub3RhdGlvbkFycmF5LCB3ZWlnaHRzKSB7DQogICAgICAgIC8vIFByb2Nlc3MgZWFjaCBzdHJpbmcgaW4gdGhlIGFycmF5DQogICAgICAgIGlmICghbm90YXRpb25BcnJheSB8fCAhQXJyYXkuaXNBcnJheShub3RhdGlvbkFycmF5KSB8fCBub3RhdGlvbkFycmF5Lmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICB9DQogICAgICAgIG5vdGF0aW9uQXJyYXkuZm9yRWFjaChub3RhdGlvblN0cmluZyA9PiB7DQogICAgICAgICAgICAvLyBTcGxpdCB0aGUgc3RyaW5nIGJ5IHNwYWNlcyB0byBnZXQgaW5kaXZpZHVhbCBtb3Zlcw0KICAgICAgICAgICAgY29uc3Qgbm90YXRpb24gPSBub3RhdGlvblN0cmluZy5zcGxpdCgnICcpLmZpbHRlcihtb3ZlID0+IG1vdmUudHJpbSgpICE9PSAnJyk7DQogICAgICAgICAgICAvLyBDYWxsIGV4aXN0aW5nIGZ1bmN0aW9uIHRvIGFkZCB0aGUgbGluZQ0KICAgICAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihub3RhdGlvbiwgd2VpZ2h0cyk7DQogICAgICAgIH0pOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENvbnZlcnQgY29vcmRpbmF0ZS1iYXNlZCBtb3ZlcyB0byB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uDQogICAgICogQHBhcmFtIGJvYXJkSGlzdG9yeSBBcnJheSBvZiBib2FyZCBzdGF0ZXMgcmVwcmVzZW50aW5nIHRoZSBnYW1lIGhpc3RvcnkNCiAgICAgKiBAcGFyYW0gbW92ZUhpc3RvcnkgQXJyYXkgb2YgbW92ZXMgaW4gY29vcmRpbmF0ZSBmb3JtYXQNCiAgICAgKiBAcmV0dXJucyBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24NCiAgICAgKi8NCiAgICBtb3Zlc1RvTm90YXRpb24oYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSkgew0KICAgICAgICBjb25zdCBub3RhdGlvbiA9IFtdOw0KICAgICAgICBsZXQgY3VycmVudENvbG9yID0gJ3JlZCc7IC8vIFJlZCBtb3ZlcyBmaXJzdA0KDQogICAgICAgIC8vIFR5cGUgdG8gcGllY2UgY2hhcmFjdGVyIG1hcHBpbmcNCiAgICAgICAgY29uc3QgdHlwZVRvUGllY2UgPSB7DQogICAgICAgICAgICAnZ2VuZXJhbCc6IHsgJ3JlZCc6ICfluIUnLCAnYmxhY2snOiAn5bCGJyB9LA0KICAgICAgICAgICAgJ2Fkdmlzb3InOiB7ICdyZWQnOiAn5LuVJywgJ2JsYWNrJzogJ+WjqycgfSwNCiAgICAgICAgICAgICdlbGVwaGFudCc6IHsgJ3JlZCc6ICfnm7gnLCAnYmxhY2snOiAn6LGhJyB9LA0KICAgICAgICAgICAgJ2hvcnNlJzogeyAncmVkJzogJ+mprCcsICdibGFjayc6ICfpqawnIH0sDQogICAgICAgICAgICAnY2hhcmlvdCc6IHsgJ3JlZCc6ICfovaYnLCAnYmxhY2snOiAn6L2mJyB9LA0KICAgICAgICAgICAgJ2Nhbm5vbic6IHsgJ3JlZCc6ICfngq4nLCAnYmxhY2snOiAn54KuJyB9LA0KICAgICAgICAgICAgJ3NvbGRpZXInOiB7ICdyZWQnOiAn5YW1JywgJ2JsYWNrJzogJ+WNkicgfQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENvbHVtbiBtYXBwaW5nIChjb29yZGluYXRlIDAtOCB0byB0cmFkaXRpb25hbCDkuZ0t5LiAIGZvciByZWQsIDktMSBmb3IgYmxhY2spDQogICAgICAgIGNvbnN0IGNvbFRvQ2hpbmVzZSA9IFsn5LmdJywgJ+WFqycsICfkuIMnLCAn5YWtJywgJ+S6lCcsICflm5snLCAn5LiJJywgJ+S6jCcsICfkuIAnXTsNCiAgICAgICAgY29uc3QgY29sVG9BcmFiaWMgPSBbJzknLCAnOCcsICc3JywgJzYnLCAnNScsICc0JywgJzMnLCAnMicsICcxJ107DQoNCiAgICAgICAgLy8gRGlnaXQgdG8gQ2hpbmVzZSBudW1iZXIgbWFwcGluZyBmb3Igc3RlcHMNCiAgICAgICAgY29uc3QgZGlnaXRUb0NoaW5lc2UgPSBbJycsICfkuIAnLCAn5LqMJywgJ+S4iScsICflm5snLCAn5LqUJywgJ+WFrScsICfkuIMnLCAn5YWrJywgJ+S5nSddOw0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiB0aGVyZSBhcmUgbXVsdGlwbGUgc2FtZS10eXBlIHBpZWNlcyBpbiB0aGUgc2FtZSBjb2x1bW4NCiAgICAgICAgY29uc3QgaGFzU2FtZVR5cGVJbkNvbHVtbiA9IChib2FyZCwgcGllY2VUeXBlLCBjb2xvciwgY29sLCBleGNsdWRlUm93KSA9PiB7DQogICAgICAgICAgICBsZXQgY291bnQgPSAwOw0KICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjb2xdOw0KICAgICAgICAgICAgICAgIGlmIChyID09PSBleGNsdWRlUm93KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gcGllY2VUeXBlICYmIHBpZWNlLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgICAgICAgICBjb3VudCsrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHJldHVybiBjb3VudCA+IDA7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGRldGVybWluZSBmcm9udC9iYWNrIG1hcmtlcg0KICAgICAgICBjb25zdCBnZXRGcm9udEJhY2tNYXJrZXIgPSAoYm9hcmQsIHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgY3VycmVudFJvdykgPT4gew0KICAgICAgICAgICAgY29uc3Qgc2FtZVR5cGVQaWVjZXMgPSBbXTsNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY29sXTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gcGllY2VUeXBlICYmIHBpZWNlLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgICAgICAgICBzYW1lVHlwZVBpZWNlcy5wdXNoKHIpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmIChzYW1lVHlwZVBpZWNlcy5sZW5ndGggPD0gMSkgcmV0dXJuICcnOw0KICAgICAgICAgICAgaWYgKGNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8iHI9Ny0577yJ77yMcuWAvOi2iuWkp+i2iumdoOi/keaVjOaWue+8jOaYryLliY0iDQogICAgICAgICAgICAgICAgY29uc3Qgc29ydGVkUm93cyA9IFsuLi5zYW1lVHlwZVBpZWNlc10uc29ydCgoYSwgYikgPT4gYiAtIGEpOyAvLyBIaWdoZXIgcm93cyBmaXJzdCA9IGNsb3NlciB0byBvcHBvbmVudA0KICAgICAgICAgICAgICAgIHJldHVybiBzb3J0ZWRSb3dzWzBdID09PSBjdXJyZW50Um93ID8gJ+WJjScgOiAn5ZCOJzsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yIcj0wLTLvvInvvIxy5YC86LaK5bCP6LaK6Z2g6L+R5pWM5pa577yM5pivIuWJjSINCiAgICAgICAgICAgICAgICBjb25zdCBzb3J0ZWRSb3dzID0gWy4uLnNhbWVUeXBlUGllY2VzXS5zb3J0KChhLCBiKSA9PiBhIC0gYik7IC8vIExvd2VyIHJvd3MgZmlyc3QgPSBjbG9zZXIgdG8gb3Bwb25lbnQNCiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkUm93c1swXSA9PT0gY3VycmVudFJvdyA/ICfliY0nIDogJ+WQjic7DQogICAgICAgICAgICB9DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gUHJvY2VzcyBlYWNoIG1vdmUNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtb3ZlSGlzdG9yeS5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVIaXN0b3J5W2ldOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRCZWZvcmUgPSBib2FyZEhpc3RvcnlbaV07DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkQmVmb3JlW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghcGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBwaWVjZSBmb3VuZCBhdCBmcm9tIHBvc2l0aW9uOicsIG1vdmUuZnJvbSk7DQogICAgICAgICAgICAgICAgY29udGludWU7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlLnR5cGU7DQogICAgICAgICAgICBjb25zdCBwaWVjZUNoYXIgPSB0eXBlVG9QaWVjZVtwaWVjZVR5cGVdW3BpZWNlLmNvbG9yXTsNCiAgICAgICAgICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGVyZSBhcmUgbXVsdGlwbGUgc2FtZS10eXBlIHBpZWNlcyBpbiB0aGUgc2FtZSBjb2x1bW4NCiAgICAgICAgICAgIGNvbnN0IGhhc0R1cGxpY2F0ZSA9IGhhc1NhbWVUeXBlSW5Db2x1bW4oYm9hcmRCZWZvcmUsIHBpZWNlVHlwZSwgcGllY2UuY29sb3IsIG1vdmUuZnJvbS5jLCBtb3ZlLmZyb20ucik7DQogICAgICAgICAgICAvLyBHZXQgZnJvbnQvYmFjayBtYXJrZXIgaWYgbmVlZGVkDQogICAgICAgICAgICBjb25zdCBwb3NpdGlvbk1hcmtlciA9IGhhc0R1cGxpY2F0ZSA/IGdldEZyb250QmFja01hcmtlcihib2FyZEJlZm9yZSwgcGllY2VUeXBlLCBwaWVjZS5jb2xvciwgbW92ZS5mcm9tLmMsIG1vdmUuZnJvbS5yKSA6ICcnOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBEZXRlcm1pbmUgbm90YXRpb24gYmFzZWQgb24gcGllY2UgdHlwZSBhbmQgbW92ZSBkaXJlY3Rpb24NCiAgICAgICAgICAgIGxldCBub3RhdGlvblN0cjsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2hvcnNlJyB8fCBwaWVjZVR5cGUgPT09ICdhZHZpc29yJyB8fCBwaWVjZVR5cGUgPT09ICdlbGVwaGFudCcpIHsNCiAgICAgICAgICAgICAgICAvLyBEaWFnb25hbCBtb3ZpbmcgcGllY2VzIC0gb25seSB1c2Ug6L+bL+mAgCwgcmVjb3JkIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9DaGluZXNlW21vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/ov5vvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IG1vdmUudG8uciA+IG1vdmUuZnJvbS5yID8gJ+i/mycgOiAn6YCAJzsNCiAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yIcj0w77yJ77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+i/m++8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gbW92ZS50by5yIDwgbW92ZS5mcm9tLnIgPyAn6L+bJyA6ICfpgIAnOw0KICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdnZW5lcmFsJyB8fCBwaWVjZVR5cGUgPT09ICdjaGFyaW90JyB8fCBwaWVjZVR5cGUgPT09ICdjYW5ub24nIHx8IHBpZWNlVHlwZSA9PT0gJ3NvbGRpZXInKSB7DQogICAgICAgICAgICAgICAgLy8gU3RyYWlnaHQgbW92aW5nIHBpZWNlcyAtIOi/my/pgIAv5bmzDQogICAgICAgICAgICAgICAgaWYgKG1vdmUuZnJvbS5jID09PSBtb3ZlLnRvLmMpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gVmVydGljYWwgbW92ZSAtIOi/my/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RlcHMgPSBNYXRoLmFicyhtb3ZlLnRvLnIgLSBtb3ZlLmZyb20ucik7DQogICAgICAgICAgICAgICAgICAgIC8vIOi/m+aYr+mdoOi/keaVjOaWueeahOaWueWQke+8jOmAgOaYr+i/nOemu+aVjOaWueeahOaWueWQkQ0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6L+b77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6L+b77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSAoaXNSZWQgPyBtb3ZlLnRvLnIgPiBtb3ZlLmZyb20uciA6IG1vdmUudG8uciA8IG1vdmUuZnJvbS5yKSA/ICfov5snIDogJ+mAgCc7DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHN0ZXBzIGlzIGEgdmFsaWQgbnVtYmVyIGJldHdlZW4gMS05DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWxpZFN0ZXBzID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oOSwgTWF0aC5yb3VuZChzdGVwcyB8fCAxKSkpOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHtkaWdpdFRvQ2hpbmVzZVt2YWxpZFN0ZXBzXSB8fCAnJ31gOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCEDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBzdGVwcyBpcyBhIHZhbGlkIG51bWJlcg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsaWRTdGVwcyA9IE1hdGgucm91bmQoc3RlcHMgfHwgMSk7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3ZhbGlkU3RlcHN9YDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgbW92ZSAtIOW5sw0KICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfeW5syR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhA0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x95bmzJHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdVbmtub3duIHBpZWNlIHR5cGU6JywgcGllY2VUeXBlKTsNCiAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgbm90YXRpb24ucHVzaChub3RhdGlvblN0cik7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFN3aXRjaCBjb2xvciBmb3IgbmV4dCBtb3ZlDQogICAgICAgICAgICBjdXJyZW50Q29sb3IgPSBjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICByZXR1cm4gbm90YXRpb247DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQ29udmVydCB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uIHRvIGNvb3JkaW5hdGUgbW92ZXMNCiAgICAgKiBAcGFyYW0gbm90YXRpb24gQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uDQogICAgICogQHJldHVybnMgQXJyYXkgb2YgbW92ZXMgaW4gY29vcmRpbmF0ZSBmb3JtYXQNCiAgICAgKi8NCiAgICBub3RhdGlvblRvTW92ZXMobm90YXRpb24sIGluaXRpYWxCb2FyZCA9IG51bGwpIHsNCiAgICAgICAgLy8g56Gu5L+dbm90YXRpb27mmK/mlbDnu4TkuJTkuI3kuLrnqboNCiAgICAgICAgaWYgKCFub3RhdGlvbiB8fCAhQXJyYXkuaXNBcnJheShub3RhdGlvbikgfHwgbm90YXRpb24ubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICByZXR1cm4gW107DQogICAgICAgIH0NCiAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgbGV0IGN1cnJlbnRDb2xvciA9ICdyZWQnOyAvLyBSZWQgbW92ZXMgZmlyc3QNCg0KICAgICAgICAvLyBQaWVjZSBjaGFyYWN0ZXIgdG8gdHlwZSBtYXBwaW5nDQogICAgICAgIGNvbnN0IHBpZWNlTWFwID0gew0KICAgICAgICAgICAgJ+Wwhic6ICdnZW5lcmFsJywgJ+W4hSc6ICdnZW5lcmFsJywNCiAgICAgICAgICAgICflo6snOiAnYWR2aXNvcicsICfku5UnOiAnYWR2aXNvcicsDQogICAgICAgICAgICAn6LGhJzogJ2VsZXBoYW50JywgJ+ebuCc6ICdlbGVwaGFudCcsDQogICAgICAgICAgICAn6amsJzogJ2hvcnNlJywNCiAgICAgICAgICAgICfovaYnOiAnY2hhcmlvdCcsDQogICAgICAgICAgICAn54KuJzogJ2Nhbm5vbicsDQogICAgICAgICAgICAn5Y2SJzogJ3NvbGRpZXInLCAn5YW1JzogJ3NvbGRpZXInDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ29sdW1uIG1hcHBpbmcgKHRyYWRpdGlvbmFsIG5vdGF0aW9uIHVzZXMgMS05IGZyb20gcmlnaHQgdG8gbGVmdCkNCiAgICAgICAgY29uc3QgY29sTWFwID0gew0KICAgICAgICAgICAgJ+S4gCc6IDgsICcxJzogOCwNCiAgICAgICAgICAgICfkuownOiA3LCAnMic6IDcsDQogICAgICAgICAgICAn5LiJJzogNiwgJzMnOiA2LA0KICAgICAgICAgICAgJ+Wbmyc6IDUsICc0JzogNSwNCiAgICAgICAgICAgICfkupQnOiA0LCAnNSc6IDQsDQogICAgICAgICAgICAn5YWtJzogMywgJzYnOiAzLA0KICAgICAgICAgICAgJ+S4gyc6IDIsICc3JzogMiwNCiAgICAgICAgICAgICflhasnOiAxLCAnOCc6IDEsDQogICAgICAgICAgICAn5LmdJzogMCwgJzknOiAwDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ2hpbmVzZSBudW1iZXIgdG8gZGlnaXQgbWFwcGluZw0KICAgICAgICBjb25zdCBjaGluZXNlTnVtYmVyTWFwID0gew0KICAgICAgICAgICAgJ+S4gCc6IDEsICcxJzogMSwNCiAgICAgICAgICAgICfkuownOiAyLCAnMic6IDIsDQogICAgICAgICAgICAn5LiJJzogMywgJzMnOiAzLA0KICAgICAgICAgICAgJ+Wbmyc6IDQsICc0JzogNCwNCiAgICAgICAgICAgICfkupQnOiA1LCAnNSc6IDUsDQogICAgICAgICAgICAn5YWtJzogNiwgJzYnOiA2LA0KICAgICAgICAgICAgJ+S4gyc6IDcsICc3JzogNywNCiAgICAgICAgICAgICflhasnOiA4LCAnOCc6IDgsDQogICAgICAgICAgICAn5LmdJzogOSwgJzknOiA5DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSW5pdGlhbCBwb3NpdGlvbnMgb2YgcGllY2VzIChyZWQgYW5kIGJsYWNrKQ0KICAgICAgICAvLyDkv67lpI3vvJrkuI7mlrDlnZDmoIfns7vnu5/kv53mjIHkuIDoh7TvvIznuqLmlrnlnKjlupXpg6jvvIhyPTAtMu+8ie+8jOm7keaWueWcqOmhtumDqO+8iHI9Ny0577yJDQogICAgICAgIGNvbnN0IGRlZmF1bHRJbml0aWFsUG9zaXRpb25zID0gew0KICAgICAgICAgICAgJ3JlZC1nZW5lcmFsJzogeyByOiAwLCBjOiA0IH0sDQogICAgICAgICAgICAncmVkLWFkdmlzb3InOiBbeyByOiAwLCBjOiAzIH0sIHsgcjogMCwgYzogNSB9XSwNCiAgICAgICAgICAgICdyZWQtZWxlcGhhbnQnOiBbeyByOiAwLCBjOiAyIH0sIHsgcjogMCwgYzogNiB9XSwNCiAgICAgICAgICAgICdyZWQtaG9yc2UnOiBbeyByOiAwLCBjOiAxIH0sIHsgcjogMCwgYzogNyB9XSwNCiAgICAgICAgICAgICdyZWQtY2hhcmlvdCc6IFt7IHI6IDAsIGM6IDAgfSwgeyByOiAwLCBjOiA4IH1dLA0KICAgICAgICAgICAgJ3JlZC1jYW5ub24nOiBbeyByOiAyLCBjOiAxIH0sIHsgcjogMiwgYzogNyB9XSwNCiAgICAgICAgICAgICdyZWQtc29sZGllcic6IFt7IHI6IDMsIGM6IDAgfSwgeyByOiAzLCBjOiAyIH0sIHsgcjogMywgYzogNCB9LCB7IHI6IDMsIGM6IDYgfSwgeyByOiAzLCBjOiA4IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWdlbmVyYWwnOiB7IHI6IDksIGM6IDQgfSwNCiAgICAgICAgICAgICdibGFjay1hZHZpc29yJzogW3sgcjogOSwgYzogMyB9LCB7IHI6IDksIGM6IDUgfV0sDQogICAgICAgICAgICAnYmxhY2stZWxlcGhhbnQnOiBbeyByOiA5LCBjOiAyIH0sIHsgcjogOSwgYzogNiB9XSwNCiAgICAgICAgICAgICdibGFjay1ob3JzZSc6IFt7IHI6IDksIGM6IDEgfSwgeyByOiA5LCBjOiA3IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWNoYXJpb3QnOiBbeyByOiA5LCBjOiAwIH0sIHsgcjogOSwgYzogOCB9XSwNCiAgICAgICAgICAgICdibGFjay1jYW5ub24nOiBbeyByOiA3LCBjOiAxIH0sIHsgcjogNywgYzogNyB9XSwNCiAgICAgICAgICAgICdibGFjay1zb2xkaWVyJzogW3sgcjogNiwgYzogMCB9LCB7IHI6IDYsIGM6IDIgfSwgeyByOiA2LCBjOiA0IH0sIHsgcjogNiwgYzogNiB9LCB7IHI6IDYsIGM6IDggfV0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBUcmFjayBwaWVjZSBwb3NpdGlvbnMgYXMgbW92ZXMgYXJlIG1hZGUNCiAgICAgICAgbGV0IHBpZWNlUG9zaXRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShkZWZhdWx0SW5pdGlhbFBvc2l0aW9ucykpOw0KICAgICAgICANCiAgICAgICAgLy8gSWYgaW5pdGlhbCBib2FyZCBpcyBwcm92aWRlZCwgaW5pdGlhbGl6ZSBwaWVjZSBwb3NpdGlvbnMgZnJvbSBpdA0KICAgICAgICBpZiAoaW5pdGlhbEJvYXJkKSB7DQogICAgICAgICAgICAvLyBSZXNldCBwaWVjZSBwb3NpdGlvbnMgYmFzZWQgb24gaW5pdGlhbCBib2FyZA0KICAgICAgICAgICAgcGllY2VQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgJ3JlZC1nZW5lcmFsJzogeyByOiAtMSwgYzogLTEgfSwNCiAgICAgICAgICAgICAgICAncmVkLWFkdmlzb3InOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWVsZXBoYW50JzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1ob3JzZSc6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtY2hhcmlvdCc6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtY2Fubm9uJzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1zb2xkaWVyJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWdlbmVyYWwnOiB7IHI6IC0xLCBjOiAtMSB9LA0KICAgICAgICAgICAgICAgICdibGFjay1hZHZpc29yJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWVsZXBoYW50JzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWhvcnNlJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWNoYXJpb3QnOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stY2Fubm9uJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLXNvbGRpZXInOiBbXQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gUG9wdWxhdGUgcGllY2UgcG9zaXRpb25zIGZyb20gaW5pdGlhbCBib2FyZA0KICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBpbml0aWFsQm9hcmRbcl1bY107DQogICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7cGllY2UuY29sb3J9LSR7cGllY2UudHlwZX1gOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2tleV0gPSB7IHIsIGMgfTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgcGllY2VQb3NpdGlvbnNba2V5XS5wdXNoKHsgciwgYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBmaW5kIHBpZWNlIHBvc2l0aW9uDQogICAgICAgIGNvbnN0IGZpbmRQaWVjZVBvc2l0aW9uID0gKHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgZGlyZWN0aW9uLCBib2FyZCwgZnJvbnRCYWNrTWFya2VyID0gbnVsbCkgPT4gew0KICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7Y29sb3J9LSR7cGllY2VUeXBlfWA7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1trZXldOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiBwb3NpdGlvbnMgZXhpc3QgYW5kIGFyZSB2YWxpZA0KICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBwb3NpdGlvbnMgZm91bmQgZm9yIHBpZWNlOicsIGtleSk7DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgIHJldHVybiBwb3NpdGlvbnM7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEZpbmQgcGllY2VzIG9uIHRoZSBzcGVjaWZpZWQgY29sdW1uDQogICAgICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gcG9zaXRpb25zLmZpbHRlcihwb3MgPT4gcG9zLmMgPT09IGNvbCk7DQoNCiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIGNhbmRpZGF0ZXMgZm91bmQgZm9yIHBpZWNlOicsIGtleSwgJ29uIGNvbHVtbjonLCBjb2wpOw0KICAgICAgICAgICAgICAgIC8vIEFkZGl0aW9uYWwgZGVidWcgaW5mbyBmb3IgY2Fubm9uDQogICAgICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2Nhbm5vbicgJiYgY29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0RFQlVHOiBDYW5kaWRhdGVzIGFmdGVyIGZpbHRlcjonLCBjYW5kaWRhdGVzKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMSkgew0KICAgICAgICAgICAgICAgIHJldHVybiBjYW5kaWRhdGVzWzBdOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBJZiBmcm9udC9iYWNrIG1hcmtlciBpcyBwcm92aWRlZCwgdXNlIGl0IHRvIGRldGVybWluZSB0aGUgcGllY2UNCiAgICAgICAgICAgIGlmIChmcm9udEJhY2tNYXJrZXIgPT09ICfliY0nKSB7DQogICAgICAgICAgICAgICAgLy8g5YmN54Ku77ya6Z2g6L+R5pWM5pa555qE5qOL5a2QDQogICAgICAgICAgICAgICAgLy8g57qi5pa577yacuWAvOi+g+Wkp+eahOabtOmdoOi/keaVjOaWue+8iOWJje+8iQ0KICAgICAgICAgICAgICAgIC8vIOm7keaWue+8mnLlgLzovoPlsI/nmoTmm7TpnaDov5HmlYzmlrnvvIjliY3vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfSBlbHNlIGlmIChmcm9udEJhY2tNYXJrZXIgPT09ICflkI4nKSB7DQogICAgICAgICAgICAgICAgLy8g5ZCO54Ku77ya6Z2g6L+R5bex5pa555qE5qOL5a2QDQogICAgICAgICAgICAgICAgLy8g57qi5pa577yacuWAvOi+g+Wwj+eahOabtOmdoOi/keW3seaWue+8iOWQju+8iQ0KICAgICAgICAgICAgICAgIC8vIOm7keaWue+8mnLlgLzovoPlpKfnmoTmm7TpnaDov5Hlt7HmlrnvvIjlkI7vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBJZiBtdWx0aXBsZSBwaWVjZXMgb24gdGhlIHNhbWUgY29sdW1uIGFuZCBubyBtYXJrZXIsIGRldGVybWluZSBiYXNlZCBvbiBkaXJlY3Rpb24NCiAgICAgICAgICAgIC8vIOWvueS6juWQjOS4gOWIl+eahOaji+WtkO+8jOmAmui/h+avlOi+g3LlgLzmnaXljLrliIYNCiAgICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT09ICfov5snKSB7DQogICAgICAgICAgICAgICAgLy8g6L+b5piv5ZCR5pWM5pa55pa55ZCR56e75Yqo77yM5omA5Lul6YCJ5oup5pu06Z2g6L+R5bex5pa555qE5qOL5a2Q77yI5ZCO77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoZGlyZWN0aW9uID09PSAn6YCAJykgew0KICAgICAgICAgICAgICAgIC8vIOmAgOaYr+WQkeW3seaWueaWueWQkeenu+WKqO+8jOaJgOS7pemAieaLqeabtOmdoOi/keaVjOaWueeahOaji+WtkO+8iOWJje+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIHJldHVybiBjYW5kaWRhdGVzWzBdOyAvLyBEZWZhdWx0IHRvIGZpcnN0IGlmIGRpcmVjdGlvbiBpcyAn5bmzJyBhbmQgbm8gbWFya2VyDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIHVwZGF0ZSBwaWVjZSBwb3NpdGlvbg0KICAgICAgICBjb25zdCB1cGRhdGVQaWVjZVBvc2l0aW9uID0gKHBpZWNlVHlwZSwgY29sb3IsIG9sZFBvcywgbmV3UG9zKSA9PiB7DQogICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtjb2xvcn0tJHtwaWVjZVR5cGV9YDsNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2tleV07DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHBvc2l0aW9ucyBleGlzdCBhbmQgYXJlIHZhbGlkDQogICAgICAgICAgICBpZiAoIXBvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogTm8gcG9zaXRpb25zIGZvdW5kIGZvciBwaWVjZTonLCBrZXkpOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zLnIgPSBuZXdQb3MucjsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnMuYyA9IG5ld1Bvcy5jOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgY29uc3QgaW5kZXggPSBwb3NpdGlvbnMuZmluZEluZGV4KHBvcyA9PiBwb3MuciA9PT0gb2xkUG9zLnIgJiYgcG9zLmMgPT09IG9sZFBvcy5jKTsNCiAgICAgICAgICAgIGlmIChpbmRleCAhPT0gLTEpIHsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnNbaW5kZXhdLnIgPSBuZXdQb3MucjsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnNbaW5kZXhdLmMgPSBuZXdQb3MuYzsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBDb3VsZCBub3QgZmluZCBwaWVjZSBwb3NpdGlvbiB0byB1cGRhdGU6Jywgb2xkUG9zLCAnaW4nLCBwb3NpdGlvbnMpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiBwb3NpdGlvbiBpcyB2YWxpZA0KICAgICAgICBjb25zdCBpc1ZhbGlkUG9zID0gKHIsIGMpID0+IHIgPj0gMCAmJiByIDwgMTAgJiYgYyA+PSAwICYmIGMgPCA5Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgaG9yc2UgbW92ZXMNCiAgICAgICAgY29uc3QgZ2V0SG9yc2VNb3ZlcyA9IChwb3MsIGNvbG9yKSA9PiB7DQogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IGRyOiAtMiwgZGM6IC0xIH0sIHsgZHI6IC0yLCBkYzogMSB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IC0xLCBkYzogLTIgfSwgeyBkcjogLTEsIGRjOiAyIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMSwgZGM6IC0yIH0sIHsgZHI6IDEsIGRjOiAyIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMiwgZGM6IC0xIH0sIHsgZHI6IDIsIGRjOiAxIH0NCiAgICAgICAgICAgIF07DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBob3JzZSBjYW4gbW92ZSBpbiB0aGUgZGlyZWN0aW9uDQogICAgICAgICAgICBjb25zdCBjYW5Nb3ZlID0gKGRyLCBkYywgYmxvY2tlZFIsIGJsb2NrZWRDKSA9PiB7DQogICAgICAgICAgICAgICAgaWYgKCFpc1ZhbGlkUG9zKHIgKyBibG9ja2VkUiwgYyArIGJsb2NrZWRDKSkgcmV0dXJuIGZhbHNlOw0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfTsNCg0KICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9LCBpbmRleCkgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IGJsb2NrZWRSID0gZHIgPiAwID8gMSA6IGRyIDwgMCA/IC0xIDogMDsNCiAgICAgICAgICAgICAgICBjb25zdCBibG9ja2VkQyA9IGRjID4gMCA/IDEgOiBkYyA8IDAgPyAtMSA6IDA7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHBhdGggaXMgYmxvY2tlZA0KICAgICAgICAgICAgICAgIGlmICgoaW5kZXggPCAyIHx8IGluZGV4ID49IDYpICYmIGJsb2NrZWRSICE9PSAwKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIGJsb2NrZWQNCiAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5Nb3ZlKGRyLCBkYywgYmxvY2tlZFIsIDApKSByZXR1cm47DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChibG9ja2VkQyAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIGJsb2NrZWQNCiAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5Nb3ZlKGRyLCBkYywgMCwgYmxvY2tlZEMpKSByZXR1cm47DQogICAgICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpKSB7DQogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0pOw0KDQogICAgICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBlbGVwaGFudCBtb3Zlcw0KICAgICAgICBjb25zdCBnZXRFbGVwaGFudE1vdmVzID0gKHBvcywgY29sb3IpID0+IHsNCiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107DQogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgZHI6IC0yLCBkYzogLTIgfSwgeyBkcjogLTIsIGRjOiAyIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMiwgZGM6IC0yIH0sIHsgZHI6IDIsIGRjOiAyIH0NCiAgICAgICAgICAgIF07DQoNCiAgICAgICAgICAgIC8vIEVsZXBoYW50J3MgdGVycml0b3J5IC0gcmVkIGVsZXBoYW50cyBjYW4gb25seSBiZSBpbiByPD00LCBibGFjayBlbGVwaGFudHMgaW4gcj49NQ0KICAgICAgICAgICAgY29uc3QgaXNJblRlcnJpdG9yeSA9IChyKSA9PiB7DQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IHIgPD0gNCA6IHIgPj0gNTsNCiAgICAgICAgICAgIH07DQoNCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSkgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IG1pZFIgPSByICsgZHIgLyAyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG1pZEMgPSBjICsgZGMgLyAyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsNCg0KICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIG1pZCBwb3NpdGlvbiBpcyBlbXB0eSBhbmQgbmV3IHBvc2l0aW9uIGlzIHZhbGlkDQogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobWlkUiwgbWlkQykgJiYgaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSAmJiBpc0luVGVycml0b3J5KG5ld1IpKSB7DQogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0pOw0KDQogICAgICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBhZHZpc29yIG1vdmVzDQogICAgICAgIGNvbnN0IGdldEFkdmlzb3JNb3ZlcyA9IChwb3MsIGNvbG9yKSA9PiB7DQogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IGRyOiAtMSwgZGM6IC0xIH0sIHsgZHI6IC0xLCBkYzogMSB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDEsIGRjOiAtMSB9LCB7IGRyOiAxLCBkYzogMSB9DQogICAgICAgICAgICBdOw0KDQogICAgICAgICAgICAvLyBBZHZpc29yJ3MgdGVycml0b3J5IChwYWxhY2UpIC0gcmVkIGFkdmlzb3JzIGluIHI9MC0yLGM9My01LCBibGFjayBhZHZpc29ycyBpbiByPTctOSxjPTMtNQ0KICAgICAgICAgICAgY29uc3QgaXNJblBhbGFjZSA9IChyLCBjKSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgclJhbmdlID0gY29sb3IgPT09ICdyZWQnID8gWzAsIDJdIDogWzcsIDldOw0KICAgICAgICAgICAgICAgIHJldHVybiByID49IHJSYW5nZVswXSAmJiByIDw9IHJSYW5nZVsxXSAmJiBjID49IDMgJiYgYyA8PSA1Ow0KICAgICAgICAgICAgfTsNCg0KICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9KSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpICYmIGlzSW5QYWxhY2UobmV3UiwgbmV3QykpIHsNCiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSk7DQoNCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgYm9hcmQgdG8gdHJhY2sgbW92ZXMNCiAgICAgICAgbGV0IHRlbXBCb2FyZCA9IHRoaXMuY3JlYXRlSW5pdGlhbEJvYXJkKCk7DQogICAgICAgIA0KICAgICAgICAvLyBFbnN1cmUgdGVtcEJvYXJkIGlzIHByb3Blcmx5IGluaXRpYWxpemVkDQogICAgICAgIGlmICghdGVtcEJvYXJkIHx8IHRlbXBCb2FyZC5sZW5ndGggIT09IDEwKSB7DQogICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIGJvYXJkIGluaXRpYWxpemF0aW9uJyk7DQogICAgICAgICAgICByZXR1cm4gW107DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIFZlcmlmeSBhbGwgcm93cyBoYXZlIDkgY29sdW1ucw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwOyBpKyspIHsNCiAgICAgICAgICAgIGlmICghdGVtcEJvYXJkW2ldIHx8IHRlbXBCb2FyZFtpXS5sZW5ndGggIT09IDkpIHsNCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbaV0gPSBBcnJheSg5KS5maWxsKG51bGwpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgY29uc29sZS5sb2coJ1RvdGFsIG1vdmVzOicsIG5vdGF0aW9uLmxlbmd0aCk7DQogICAgICAgIG5vdGF0aW9uLmZvckVhY2gobW92ZU5vdGF0aW9uID0+IHsNCg0KDQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFBhcnNlIHRoZSBtb3ZlIG5vdGF0aW9uIC0ga2VlcCBsYXN0IGdyb3VwIG9wdGlvbmFsDQogICAgICAgICAgICBjb25zdCByZWdleCA9IC8oW+WJjeWQjl0pPyhb5bCG5biF5aOr5LuV6LGh55u46ams6L2m54Ku5YW15Y2SXSkoW+S4gOS6jOS4ieWbm+S6lOWFreS4g+WFq+S5nTEyMzQ1Njc4OV0pKFvov5vpgIDlubNdKShb5LiA5LqM5LiJ5Zub5LqU5YWt5LiD5YWr5LmdMTIzNDU2Nzg5XSk/LzsNCiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gbW92ZU5vdGF0aW9uLm1hdGNoKHJlZ2V4KTsNCg0KICAgICAgICAgICAgaWYgKCFtYXRjaCkgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgbW92ZSBub3RhdGlvbjonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgY29uc3QgWywgZnJvbnRCYWNrTWFya2VyLCBwaWVjZUNoYXIsIGZyb21Db2xOb3RhdGlvbiwgZGlyZWN0aW9uLCB0b0NvbE9yU3RlcE5vdGF0aW9uXSA9IG1hdGNoOw0KICAgICAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2VNYXBbcGllY2VDaGFyXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gR2V0IGNvbHVtbiBtYXBwaW5nIGJhc2VkIG9uIGN1cnJlbnQgY29sb3IgKGJsYWNrIHNlZXMgY29sdW1ucyBtaXJyb3JlZCkNCiAgICAgICAgICAgIGxldCBmcm9tQ29sID0gY29sTWFwW2Zyb21Db2xOb3RhdGlvbl07DQogICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrIChmcm9tIGJsYWNrJ3MgcGVyc3BlY3RpdmUpDQogICAgICAgICAgICAgICAgZnJvbUNvbCA9IDggLSBmcm9tQ29sOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBGaW5kIHRoZSBjdXJyZW50IHBvc2l0aW9uIG9mIHRoZSBwaWVjZQ0KICAgICAgICAgICAgY29uc3QgZnJvbVBvcyA9IGZpbmRQaWVjZVBvc2l0aW9uKHBpZWNlVHlwZSwgY3VycmVudENvbG9yLCBmcm9tQ29sLCBkaXJlY3Rpb24sIHRlbXBCb2FyZCwgZnJvbnRCYWNrTWFya2VyKTsNCg0KICAgICAgICAgICAgaWYgKCFmcm9tUG9zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignQ291bGQgbm90IGZpbmQgcGllY2UgcG9zaXRpb24gZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGxldCB0b1BvczsNCg0KICAgICAgICAgICAgaWYgKGRpcmVjdGlvbiA9PT0gJ+W5sycpIHsNCiAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIG1vdmVtZW50DQogICAgICAgICAgICAgICAgbGV0IHRvQ29sID0gY29sTWFwW3RvQ29sT3JTdGVwTm90YXRpb25dOw0KICAgICAgICAgICAgICAgIGlmICh0b0NvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbjonLCB0b0NvbE9yU3RlcE5vdGF0aW9uLCAnZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sgd2hlbiBtb3ZpbmcgaG9yaXpvbnRhbGx5DQogICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICB0b0NvbCA9IDggLSB0b0NvbDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgdG9Qb3MgPSB7IHI6IGZyb21Qb3MuciwgYzogdG9Db2wgfTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8gVmVydGljYWwgb3IgZGlhZ29uYWwgbW92ZW1lbnQNCiAgICAgICAgICAgICAgICBjb25zdCBzdGVwcyA9IGNoaW5lc2VOdW1iZXJNYXBbdG9Db2xPclN0ZXBOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoc3RlcHMgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHN0ZXAgY291bnQ6JywgdG9Db2xPclN0ZXBOb3RhdGlvbiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICB9DQoNCiAgICAgICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnaG9yc2UnKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEhvcnNlIG1vdmVzIGluIEwtc2hhcGUNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEhvcnNlTW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsNCiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvbE5vdGF0aW9uID0gdG9Db2xPclN0ZXBOb3RhdGlvbjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uIGZvciBob3JzZTonLCB0YXJnZXRDb2xOb3RhdGlvbiwgJ2luIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrDQogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldENvbCA9IDggLSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIG1vdmUgdGhhdCBtYXRjaGVzIGJvdGggZGlyZWN0aW9uIGFuZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZGlyZWN0aW9uIChyb3cpDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbk1hdGNoID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yID4gZnJvbVBvcy5yIDogbW92ZS5yIDwgZnJvbVBvcy5yKSA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgY29sdW1uDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2x1bW5NYXRjaCA9IG1vdmUuYyA9PT0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOw0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2VsZXBoYW50Jykgew0KICAgICAgICAgICAgICAgICAgICAvLyBFbGVwaGFudCBtb3ZlcyBkaWFnb25hbGx5IDIgc3RlcHMNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEVsZXBoYW50TW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsNCiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvbE5vdGF0aW9uID0gdG9Db2xPclN0ZXBOb3RhdGlvbjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uIGZvciBlbGVwaGFudDonLCB0YXJnZXRDb2xOb3RhdGlvbiwgJ2luIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrDQogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldENvbCA9IDggLSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIG1vdmUgdGhhdCBtYXRjaGVzIGJvdGggZGlyZWN0aW9uIGFuZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZGlyZWN0aW9uIChyb3cpDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbk1hdGNoID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yID4gZnJvbVBvcy5yIDogbW92ZS5yIDwgZnJvbVBvcy5yKSA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgY29sdW1uDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2x1bW5NYXRjaCA9IG1vdmUuYyA9PT0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOw0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2Fkdmlzb3InKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEFkdmlzb3IgbW92ZXMgZGlhZ29uYWxseSAxIHN0ZXANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEFkdmlzb3JNb3Zlcyhmcm9tUG9zLCBjdXJyZW50Q29sb3IpOw0KICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24NCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOw0KICAgICAgICAgICAgICAgICAgICBsZXQgdGFyZ2V0Q29sID0gY29sTWFwW3RhcmdldENvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGFkdmlzb3I6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjaw0KICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gU3RyYWlnaHQgbGluZSBtb3ZlbWVudCAoY2hhcmlvdCwgY2Fubm9uLCBzb2xkaWVyKQ0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGVwID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gMSA6IC0xKSAqIHN0ZXBzIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gLTEgOiAxKSAqIHN0ZXBzOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gZnJvbVBvcy5yICsgc3RlcDsNCiAgICAgICAgICAgICAgICAgICAgaWYgKG5ld1IgPCAwIHx8IG5ld1IgPj0gMTApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgcm93IHBvc2l0aW9uIGFmdGVyIG1vdmU6JywgbmV3UiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSB7IHI6IG5ld1IsIGM6IGZyb21Qb3MuYyB9Ow0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKCF0b1Bvcykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBkZXRlcm1pbmUgdGFyZ2V0IHBvc2l0aW9uIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBBZGQgdGhlIG1vdmUgdG8gdGhlIGxpc3QNCiAgICAgICAgICAgIG1vdmVzLnB1c2goeyBmcm9tOiB7IHI6IGZyb21Qb3MuciwgYzogZnJvbVBvcy5jIH0sIHRvOiB7IHI6IHRvUG9zLnIsIGM6IHRvUG9zLmMgfSB9KTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUncyBhIGNhcHR1cmVkIHBpZWNlDQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZFBpZWNlID0gdGVtcEJvYXJkW3RvUG9zLnJdW3RvUG9zLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBJZiB0aGVyZSdzIGEgY2FwdHVyZWQgcGllY2UsIHJlbW92ZSBpdCBmcm9tIHBpZWNlUG9zaXRpb25zDQogICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkS2V5ID0gYCR7Y2FwdHVyZWRQaWVjZS5jb2xvcn0tJHtjYXB0dXJlZFBpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZFBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoY2FwdHVyZWRQb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5bCGL+W4heS4jeS8muiiq+WQg+aOie+8jOaJgOS7peWPquWkhOeQhuWFtuS7luaji+WtkA0KICAgICAgICAgICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZS50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJlbW92ZSB0aGUgY2FwdHVyZWQgcG9zaXRpb24gZnJvbSB0aGUgYXJyYXkNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNhcHR1cmVkUG9zaXRpb25zKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHVwZGF0ZWRQb3NpdGlvbnMgPSBjYXB0dXJlZFBvc2l0aW9ucy5maWx0ZXIocG9zID0+IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgKHBvcy5yICE9PSB0b1Bvcy5yIHx8IHBvcy5jICE9PSB0b1Bvcy5jKQ0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgcGllY2VQb3NpdGlvbnNbY2FwdHVyZWRLZXldID0gdXBkYXRlZFBvc2l0aW9uczsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBWZXJpZnkgcmVtb3ZhbCB3YXMgc3VjY2Vzc2Z1bA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0aWxsRXhpc3RzID0gdXBkYXRlZFBvc2l0aW9ucy5zb21lKHBvcyA9PiANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zICYmIHBvcy5yID09PSB0b1Bvcy5yICYmIHBvcy5jID09PSB0b1Bvcy5jDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoc3RpbGxFeGlzdHMpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBDYXB0dXJlZCBwaWVjZSBzdGlsbCBleGlzdHMgaW4gcGllY2VQb3NpdGlvbnMhJyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ+KchSBTVUNDRVNTOiBDYXB0dXJlZCBwaWVjZSByZW1vdmVkIGZyb20gcGllY2VQb3NpdGlvbnMnKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogVW5leHBlY3RlZCBub24tYXJyYXkgcG9zaXRpb25zIGZvciBwaWVjZTonLCBjYXB0dXJlZEtleSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IE5vIHBvc2l0aW9ucyBmb3VuZCBmb3IgY2FwdHVyZWQgcGllY2U6JywgY2FwdHVyZWRLZXkpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gVmVyaWZ5IHRoZSBjYXB0dXJlZCBwaWVjZSBoYXMgYmVlbiByZW1vdmVkDQogICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkS2V5ID0gYCR7Y2FwdHVyZWRQaWVjZS5jb2xvcn0tJHtjYXB0dXJlZFBpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgICAgICBjb25zdCBmaW5hbFBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XTsNCiAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaW5hbFBvc2l0aW9ucykpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RpbGxFeGlzdHMgPSBmaW5hbFBvc2l0aW9ucy5zb21lKHBvcyA9PiANCiAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiBwb3MuciA9PT0gdG9Qb3MuciAmJiBwb3MuYyA9PT0gdG9Qb3MuYw0KICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgICAgICBpZiAoc3RpbGxFeGlzdHMpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0VSUk9SOiBDYXB0dXJlZCBwaWVjZSBzdGlsbCBleGlzdHMgaW4gcGllY2VQb3NpdGlvbnM6JywgY2FwdHVyZWRQaWVjZSwgJ2F0JywgdG9Qb3MpOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NVQ0NFU1M6IENhcHR1cmVkIHBpZWNlIHJlbW92ZWQgZnJvbSBwaWVjZVBvc2l0aW9ucycpOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBNYWtlIHRoZSBtb3ZlIG9uIHRoZSB0ZW1wb3JhcnkgYm9hcmQgZmlyc3QgYmVmb3JlIHVwZGF0aW5nIHBpZWNlIHBvc2l0aW9ucw0KICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MoZnJvbVBvcy5yLCBmcm9tUG9zLmMpICYmIGlzVmFsaWRQb3ModG9Qb3MuciwgdG9Qb3MuYykgJiYgDQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2Zyb21Qb3Mucl0gJiYgdGVtcEJvYXJkW3RvUG9zLnJdKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSB0ZW1wQm9hcmRbZnJvbVBvcy5yXVtmcm9tUG9zLmNdOw0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFt0b1Bvcy5yXVt0b1Bvcy5jXSA9IHBpZWNlOw0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtmcm9tUG9zLnJdW2Zyb21Qb3MuY10gPSBudWxsOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IEludmFsaWQgcG9zaXRpb25zIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbiwgZnJvbVBvcywgdG9Qb3MpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBVcGRhdGUgdGhlIHBpZWNlIHBvc2l0aW9uIGluIHBpZWNlUG9zaXRpb25zDQogICAgICAgICAgICB1cGRhdGVQaWVjZVBvc2l0aW9uKHBpZWNlVHlwZSwgY3VycmVudENvbG9yLCBmcm9tUG9zLCB0b1Bvcyk7DQogICAgICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFN3aXRjaCBjb2xvciBmb3IgbmV4dCBtb3ZlDQogICAgICAgICAgICBjdXJyZW50Q29sb3IgPSBjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICB9KTsNCg0KICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgfQ0KfQ0KDQovLyAtLS0gQ29uc3RhbnRzIC0tLQ0KDQovLyBJbml0aWFsaXplIE9wZW5pbmcgQm9vaw0KY29uc3Qgb3BlbmluZ0Jvb2sgPSBuZXcgT3BlbmluZ0Jvb2soMTIpOw0KDQpjb25zdCBQSUVDRV9WQUxVRVMgPSB7DQogIGdlbmVyYWw6IDEwMDAwLCAgICAgLy8g5bCGL+W4hQ0KICBjaGFyaW90OiA5MDAsICAgICAgIC8vIOi9pg0KICBjYW5ub246IDQ1MCwgICAgICAgIC8vIOeCrg0KICBob3JzZTogNDAwLCAgICAgICAgIC8vIOmprA0KICBlbGVwaGFudDogMjAwLCAgICAgIC8vIOixoS/nm7gNCiAgYWR2aXNvcjogMjAwLCAgICAgICAvLyDlo6sv5LuVDQogIHNvbGRpZXI6IDEwMCwgICAgICAgLy8g5YW1L+WNkg0KfTsNCg0KLy8gLS0tIFBpZWNlLVNxdWFyZSBUYWJsZXMgLS0tDQpjb25zdCBQU1RfU09MRElFUiA9IFsNCiAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogIFsxMCwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDEwXSwNCiAgWzEwLCAxNSwgMjUsIDMwLCAzMCwgMzAsIDI1LCAxNSwgMTBdLA0KICBbNSwgMTAsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTAsIDVdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KXTsNCmNvbnN0IFBTVF9DSEFSSU9UID0gWw0KICBbNSwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDVdLA0KICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICBbNSwgMTAsIDEyLCAxMCwgMTAsIDEwLCAxMiwgMTAsIDVdLA0KICBbMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMF0sDQogIFswLCAxMCwgNSwgMTAsIDUsIDEwLCA1LCAxMCwgMF0NCl07DQpjb25zdCBQU1RfSE9SU0UgPSBbDQogIFswLCAtNSwgMCwgMCwgMCwgMCwgMCwgLTUsIDBdLA0KICBbMCwgNSwgMTUsIDEwLCAxMCwgMTAsIDE1LCA1LCAwXSwNCiAgWzUsIDUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgNSwgNV0sDQogIFs1LCAxMCwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxMCwgNV0sDQogIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICBbMCwgNSwgMTUsIDIwLCAyMCwgMjAsIDE1LCA1LCAwXSwNCiAgWzAsIDUsIDEwLCAxNSwgMTUsIDE1LCAxMCwgNSwgMF0sDQogIFswLCAwLCA1LCA1LCA1LCA1LCA1LCAwLCAwXSwNCiAgWzAsIC01LCAwLCA1LCA1LCA1LCAwLCAtNSwgMF0sDQogIFswLCAtMTAsIC01LCAwLCAwLCAwLCAtNSwgLTEwLCAwXQ0KXTsNCmNvbnN0IFBTVF9DQU5OT04gPSBbDQogIFswLCAwLCA1LCAxMCwgMTAsIDEwLCA1LCAwLCAwXSwNCiAgWzAsIDUsIDE1LCAxMCwgMTAsIDEwLCAxNSwgNSwgMF0sDQogIFswLCA1LCAxNSwgMjUsIDI1LCAyNSwgMTUsIDUsIDBdLA0KICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgWzAsIDUsIDUsIDUsIDUsIDUsIDUsIDUsIDBdLA0KICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgWzUsIDE1LCAyMCwgMzAsIDMwLCAzMCwgMjAsIDE1LCA1XSwgDQogIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQpdOw0KY29uc3QgUFNUX0RFRkVOU0UgPSBbDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAyMCwgMzAsIDIwLCAwLCAwLCAwXQ0KXTsNCg0KY29uc3QgZ2V0UFNUVmFsdWUgPSAodHlwZSwgY29sb3IsIHIsIGMpID0+IHsNCiAgY29uc3Qgcm93SWR4ID0gY29sb3IgPT09ICdyZWQnID8gciA6ICg5IC0gcik7DQogIGxldCB0YWJsZSA9IFtdOw0KICBzd2l0Y2ggKHR5cGUpIHsNCiAgICBjYXNlICdzb2xkaWVyJzogdGFibGUgPSBQU1RfU09MRElFUjsgYnJlYWs7DQogICAgY2FzZSAnY2hhcmlvdCc6IHRhYmxlID0gUFNUX0NIQVJJT1Q7IGJyZWFrOw0KICAgIGNhc2UgJ2hvcnNlJzogdGFibGUgPSBQU1RfSE9SU0U7IGJyZWFrOw0KICAgIGNhc2UgJ2Nhbm5vbic6IHRhYmxlID0gUFNUX0NBTk5PTjsgYnJlYWs7DQogICAgZGVmYXVsdDogdGFibGUgPSBQU1RfREVGRU5TRTsgYnJlYWs7IA0KICB9DQogIHJldHVybiB0YWJsZVtyb3dJZHhdPy5bY10gfHwgMDsNCn07DQoNCmNvbnN0IGlzVmFsaWRQb3MgPSAociwgYykgPT4gciA+PSAwICYmIHIgPCBST1dTICYmIGMgPj0gMCAmJiBjIDwgQ09MUzsNCg0KLy8g6I635Y+W5qOL5a2Q55qE5aiB6IOB55uu5qCH5ZKM5L+d5oqk55uu5qCHDQpjb25zdCBnZXRQaWVjZVRhcmdldHMgPSAoYm9hcmQsIHBvcywgcGllY2UpID0+IHsNCiAgY29uc3QgdGhyZWF0ID0gW107ICAgICAgICAgICAvLyDlvZPliY3mo4vlrZDlqIHog4HnmoTmlYzmlrnmo4vlrZANCiAgY29uc3QgZ3VhcmQgPSBbXTsgICAgICAgLy8g5b2T5YmN5qOL5a2Q5L+d5oqk55qE5bex5pa55qOL5a2QDQogIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCg0KICBjb25zdCBhZGRJZlZhbGlkID0gKHRyLCB0YykgPT4gew0KICAgIGlmIChpc1ZhbGlkUG9zKHRyLCB0YykpIHsNCiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbdHJdW3RjXTsNCiAgICAgICAgaWYgKHRhcmdldCkgew0KICAgICAgICAgICAgaWYgKHRhcmdldC5jb2xvciAhPT0gcGllY2UuY29sb3IpIHsNCiAgICAgICAgICAgICAgICAvLyDmlYzmlrnmo4vlrZDvvIzliqDlhaXlqIHog4HliJfooagNCiAgICAgICAgICAgICAgICB0aHJlYXQucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g5bex5pa55qOL5a2Q77yM5Yqg5YWl5L+d5oqk5YiX6KGo77yM5bCG5biF5LiN6ZyA6KaB5LqL5ZCO55qE5L+d5oqkDQogICAgICAgICAgICAgICAgaWYgKHRhcmdldC50eXBlICE9ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgICAgICBndWFyZC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgfTsNCiAgDQoNCg0KICBzd2l0Y2ggKHBpZWNlLnR5cGUpIHsNCiAgICBjYXNlICdnZW5lcmFsJzogDQogICAgICBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgaWYgKG5jID49IDMgJiYgbmMgPD0gNSkgew0KICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA+PSAwICYmIG5yIDw9IDIpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnYWR2aXNvcic6DQogICAgICBbWzEsIDFdLCBbMSwgLTFdLCBbLTEsIDFdLCBbLTEsIC0xXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBpZiAobmMgPj0gMyAmJiBuYyA8PSA1KSB7DQogICAgICAgICAgaWYgKGlzUmVkICYmIG5yID49IDAgJiYgbnIgPD0gMikgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA3ICYmIG5yIDw9IDkpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdlbGVwaGFudCc6DQogICAgICBbWzIsIDJdLCBbMiwgLTJdLCBbLTIsIDJdLCBbLTIsIC0yXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBjb25zdCBleWVSID0gciArIGRyIC8gMiwgZXllQyA9IGMgKyBkYyAvIDI7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYgYm9hcmRbZXllUl1bZXllQ10gPT09IG51bGwpIHsNCiAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPD0gNCkgYWRkSWZWYWxpZChuciwgbmMpOyANCiAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNSkgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2hvcnNlJzoNCiAgICAgIFtbMiwgMV0sIFsyLCAtMV0sIFstMiwgMV0sIFstMiwgLTFdLCBbMSwgMl0sIFsxLCAtMl0sIFstMSwgMl0sIFstMSwgLTJdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGNvbnN0IGxlZ1IgPSByICsgKE1hdGguYWJzKGRyKSA9PT0gMiA/IE1hdGguc2lnbihkcikgOiAwKTsNCiAgICAgICAgY29uc3QgbGVnQyA9IGMgKyAoTWF0aC5hYnMoZGMpID09PSAyID8gTWF0aC5zaWduKGRjKSA6IDApOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhsZWdSLCBsZWdDKSAmJiBib2FyZFtsZWdSXVtsZWdDXSA9PT0gbnVsbCkgew0KICAgICAgICAgIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdjaGFyaW90JzoNCiAgICAgIFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgd2hpbGUgKGlzVmFsaWRQb3MobnIsIG5jKSkgew0KICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdID09PSBudWxsKSB7DQogICAgICAgICAgICAvLyDnqbrkvY3nva7vvIzkuI3lgZrlpITnkIYNCiAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgfQ0KICAgICAgICAgIG5yICs9IGRyOyBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdjYW5ub24nOg0KICAgICAgW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBsZXQgc2NyZWVuRm91bmQgPSBmYWxzZTsNCiAgICAgICAgd2hpbGUgKGlzVmFsaWRQb3MobnIsIG5jKSkgew0KICAgICAgICAgIGlmICghc2NyZWVuRm91bmQpIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdID09PSBudWxsKSB7DQogICAgICAgICAgICAgIC8vIOepuuS9jee9ru+8jOS4jeWBmuWkhOeQhg0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgc2NyZWVuRm91bmQgPSB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSAhPT0gbnVsbCkgew0KICAgICAgICAgICAgICBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgIH0NCiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnc29sZGllcic6IHsNCiAgICAgIC8vIOe6ouaWueWFteWIneWni+S9jee9ruWcqHI9M++8jOWQkeWJjei1sOaYr3Llop7lpKfvvIjlkJHkuIvvvInvvJvpu5HmlrnlhbXliJ3lp4vkvY3nva7lnKhyPTbvvIzlkJHliY3otbDmmK9y5YeP5bCP77yI5ZCR5LiK77yJDQogICAgICBjb25zdCBmb3J3YXJkID0gaXNSZWQgPyAxIDogLTE7DQogICAgICAvLyDnuqLmlrnlhbXov4fmsrPmnaHku7bmmK9yID49IDXvvIzpu5HmlrnlhbXov4fmsrPmnaHku7bmmK9yIDw9IDQNCiAgICAgIC8vIOays+eVjOS9jeS6jnI9NOWSjHI9NeS5i+mXtO+8jOe6ouaWueWFtemcgOimgei1sOWIsHI9NeaJjeiDvei/h+ays++8jOm7keaWueWFtemcgOimgei1sOWIsHI9NOaJjeiDvei/h+aysw0KICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gaXNSZWQgPyByID49IDUgOiByIDw9IDQ7DQogICAgICBhZGRJZlZhbGlkKHIgKyBmb3J3YXJkLCBjKTsNCiAgICAgIGlmIChjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgYWRkSWZWYWxpZChyLCBjIC0gMSk7DQogICAgICAgIGFkZElmVmFsaWQociwgYyArIDEpOw0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICB9DQogIHJldHVybiB7IHRocmVhdCwgZ3VhcmQgfTsNCn07DQoNCmNvbnN0IGdldFBpZWNlTW92ZXMgPSAoYm9hcmQsIHBvcywgcGllY2UpID0+IHsNCiAgY29uc3QgbW92ZXMgPSBbXTsNCiAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KDQogIGNvbnN0IGFkZElmVmFsaWQgPSAodHIsIHRjKSA9PiB7DQogICAgaWYgKGlzVmFsaWRQb3ModHIsIHRjKSkgew0KICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFt0cl1bdGNdOw0KICAgICAgICBpZiAoIXRhcmdldCB8fCB0YXJnZXQuY29sb3IgIT09IHBpZWNlLmNvbG9yKSB7DQogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICB9DQogICAgfQ0KICB9Ow0KDQogIHN3aXRjaCAocGllY2UudHlwZSkgew0KICAgIGNhc2UgJ2dlbmVyYWwnOiANCiAgICAgIFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBpZiAobmMgPj0gMyAmJiBuYyA8PSA1KSB7DQogICAgICAgICAgaWYgKGlzUmVkICYmIG5yID49IDAgJiYgbnIgPD0gMikgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA3ICYmIG5yIDw9IDkpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdhZHZpc29yJzoNCiAgICAgIFtbMSwgMV0sIFsxLCAtMV0sIFstMSwgMV0sIFstMSwgLTFdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGlmIChuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDcgJiYgbnIgPD0gOSkgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2VsZXBoYW50JzoNCiAgICAgIFtbMiwgMl0sIFsyLCAtMl0sIFstMiwgMl0sIFstMiwgLTJdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGNvbnN0IGV5ZVIgPSByICsgZHIgLyAyLCBleWVDID0gYyArIGRjIC8gMjsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MobnIsIG5jKSAmJiBib2FyZFtleWVSXVtleWVDXSA9PT0gbnVsbCkgew0KICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA8PSA0KSBhZGRJZlZhbGlkKG5yLCBuYyk7IA0KICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA1KSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnaG9yc2UnOg0KICAgICAgW1syLCAxXSwgWzIsIC0xXSwgWy0yLCAxXSwgWy0yLCAtMV0sIFsxLCAyXSwgWzEsIC0yXSwgWy0xLCAyXSwgWy0xLCAtMl1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgY29uc3QgbGVnUiA9IHIgKyAoTWF0aC5hYnMoZHIpID09PSAyID8gTWF0aC5zaWduKGRyKSA6IDApOw0KICAgICAgICBjb25zdCBsZWdDID0gYyArIChNYXRoLmFicyhkYykgPT09IDIgPyBNYXRoLnNpZ24oZGMpIDogMCk7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKGxlZ1IsIGxlZ0MpICYmIGJvYXJkW2xlZ1JdW2xlZ0NdID09PSBudWxsKSB7DQogICAgICAgICAgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2NoYXJpb3QnOg0KICAgICAgW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7DQogICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIHsNCiAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdLmNvbG9yICE9PSBwaWVjZS5jb2xvcikgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgIH0NCiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnY2Fubm9uJzoNCiAgICAgIFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgbGV0IHNjcmVlbkZvdW5kID0gZmFsc2U7DQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgc2NyZWVuRm91bmQgPSB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSAhPT0gbnVsbCkgew0KICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXS5jb2xvciAhPT0gcGllY2UuY29sb3IpIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgIH0NCiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnc29sZGllcic6IHsNCiAgICAgIC8vIOe6ouaWueWFteWIneWni+S9jee9ruWcqHI9M++8jOWQkeWJjei1sOaYr3Llop7lpKfvvIjlkJHkuIvvvInvvJvpu5HmlrnlhbXliJ3lp4vkvY3nva7lnKhyPTbvvIzlkJHliY3otbDmmK9y5YeP5bCP77yI5ZCR5LiK77yJDQogICAgICBjb25zdCBmb3J3YXJkID0gaXNSZWQgPyAxIDogLTE7DQogICAgICAvLyDnuqLmlrnlhbXov4fmsrPmnaHku7bmmK9yID49IDXvvIzpu5HmlrnlhbXov4fmsrPmnaHku7bmmK9yIDw9IDQNCiAgICAgIC8vIOays+eVjOS9jeS6jnI9NOWSjHI9NeS5i+mXtO+8jOe6ouaWueWFtemcgOimgei1sOWIsHI9NeaJjeiDvei/h+ays++8jOm7keaWueWFtemcgOimgei1sOWIsHI9NOaJjeiDvei/h+aysw0KICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gaXNSZWQgPyByID49IDUgOiByIDw9IDQ7DQogICAgICBhZGRJZlZhbGlkKHIgKyBmb3J3YXJkLCBjKTsNCiAgICAgIGlmIChjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgYWRkSWZWYWxpZChyLCBjIC0gMSk7DQogICAgICAgIGFkZElmVmFsaWQociwgYyArIDEpOw0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICB9DQogIHJldHVybiBtb3ZlczsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOaOp+WItueCuQ0KY29uc3QgZ2V0UGllY2VDb250cm9sID0gKGJvYXJkLCBwb3MsIHBpZWNlKSA9PiB7DQogIGNvbnN0IGNvbnRyb2wgPSBbXTsNCiAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KDQogIGNvbnN0IGFkZElmVmFsaWQgPSAodHIsIHRjKSA9PiB7DQogICAgaWYgKGlzVmFsaWRQb3ModHIsIHRjKSkgew0KICAgICAgICBjb250cm9sLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgfQ0KICB9Ow0KDQogIC8vIOWvueS6jumdnueCruaji+WtkO+8jOaOp+WItueCueWPquWMheaLrOWFtuWPr+S7peaJk+WIsOeahOepuuS9jee9ru+8jOWNs+WmguaenOaVjOaWueaji+WtkOi/m+WFpei/meS6m+eCueWwhuiiq+aUu+WHuw0KICBpZiAocGllY2UudHlwZSAhPT0gJ2Nhbm5vbicpIHsNCiAgICAvLyDojrflj5bmiYDmnInlj6/og73nmoTnp7vliqjkvY3nva7vvIznhLblkI7ov4fmu6TmjonmnInmo4vlrZDnmoTkvY3nva4NCiAgICBjb25zdCBtb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHBvcywgcGllY2UpOw0KICAgIG1vdmVzLmZvckVhY2gobW92ZSA9PiB7DQogICAgICAvLyDlj6rmt7vliqDnqbrkvY3nva7kvZzkuLrmjqfliLbngrkNCiAgICAgIGlmIChib2FyZFttb3ZlLnJdW21vdmUuY10gPT09IG51bGwpIHsNCiAgICAgICAgY29udHJvbC5wdXNoKG1vdmUpOw0KICAgICAgfQ0KICAgIH0pOw0KICB9IGVsc2Ugew0KICAgIC8vIOWvueS6jueCruaji+WtkO+8jOmcgOimgeeJueauiuiuoeeul+aOp+WItueCue+8jOaOp+WItueCueWPquWMheaLrOWFtuWPr+S7peaJk+WIsOeahOepuuS9jee9ru+8jOWNs+WmguaenOaVjOaWueaji+WtkOi/m+WFpei/meS6m+eCueWwhuiiq+aUu+WHuw0KICAgIC8vIOeCruiDveaOp+WItueahOaYr+esrDHkuKrngq7lj7DkuYvlkI7vvIjkuI3lkKvngq7lj7DvvInnrKwy5Liq54Ku5Y+w5LmL5YmN77yI5LiN5ZCr54Ku5Y+w77yJ55qE5omA5pyJ56m65L2N572uDQogICAgLy8g5aaC5p6c5rKh5pyJ56ysMuS4queCruWPsOmCo+S5iOWwseaYr+esrDHkuKrngq7lj7DkuYvlkI7vvIjkuI3lkKvngq7lj7DvvInnmoTmiYDmnInnqbrkvY3nva4NCiAgICBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgbGV0IHNjcmVlbkZvdW5kQ291bnQgPSAwOw0KICAgICAgDQogICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpICYmIHNjcmVlbkZvdW5kQ291bnQgPCAyKSB7DQogICAgICAgIGNvbnN0IGN1cnJlbnRQaWVjZSA9IGJvYXJkW25yXVtuY107DQogICAgICAgIA0KICAgICAgICBpZiAoY3VycmVudFBpZWNlICE9PSBudWxsKSB7DQogICAgICAgICAgLy8g5om+5Yiw5LiA5Liq54Ku5Y+w77yM5aKe5Yqg6K6h5pWwDQogICAgICAgICAgc2NyZWVuRm91bmRDb3VudCsrOw0KICAgICAgICB9IGVsc2UgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDEpIHsNCiAgICAgICAgICAvLyDnrKwx5Liq54Ku5Y+w5LmL5ZCO77yM56ysMuS4queCruWPsOS5i+WJjeeahOepuuS9jee9ru+8jOa3u+WKoOWIsOaOp+WItueCuQ0KICAgICAgICAgIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgfQ0KICAgIH0pOw0KICB9DQoNCiAgcmV0dXJuIGNvbnRyb2w7DQp9Ow0KDQpjb25zdCBpc0ZseWluZ0dlbmVyYWwgPSAoYm9hcmQpID0+IHsNCiAgbGV0IHJlZEcgPSBudWxsOw0KICBsZXQgYmxhY2tHID0gbnVsbDsNCiAgZm9yKGxldCByPTA7IHI8Uk9XUzsgcisrKSB7DQogICAgICBmb3IobGV0IGM9MzsgYzw9NTsgYysrKSB7DQogICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgIGlmIChwPy50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgaWYgKHAuY29sb3IgPT09ICdyZWQnKSByZWRHID0ge3IsIGN9Ow0KICAgICAgICAgICAgICBlbHNlIGJsYWNrRyA9IHtyLCBjfTsNCiAgICAgICAgICB9DQogICAgICB9DQogIH0NCiAgaWYgKCFyZWRHIHx8ICFibGFja0cgfHwgcmVkRy5jICE9PSBibGFja0cuYykgcmV0dXJuIGZhbHNlOw0KICANCiAgLy8g56Gu5L+d5b6q546v5pa55ZCR5q2j56Gu77yM5LuO6L6D5bCP55qEcuWIsOi+g+Wkp+eahHINCiAgY29uc3Qgc3RhcnRSID0gTWF0aC5taW4oYmxhY2tHLnIsIHJlZEcucikgKyAxOw0KICBjb25zdCBlbmRSID0gTWF0aC5tYXgoYmxhY2tHLnIsIHJlZEcucikgLSAxOw0KICANCiAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsNCiAgICBpZiAoYm9hcmRbcl1bcmVkRy5jXSAhPT0gbnVsbCkgcmV0dXJuIGZhbHNlOw0KICB9DQogIHJldHVybiB0cnVlOw0KfTsNCg0KY29uc3QgaXNDaGVjayA9IChib2FyZCwgY29sb3IsIHBpZWNlc0luZm8gPSBudWxsLCBib2FyZEluZm8gPSBudWxsKSA9PiB7DQogICAgLy8g5LyY5YWI5L2/55So6aKE6K6h566X55qE5bCG5Yab54q25oCBDQogICAgaWYgKGJvYXJkSW5mbykgew0KICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZElzSW5DaGVjayA6IGJvYXJkSW5mby5ibGFja0lzSW5DaGVjazsNCiAgICB9DQogICAgDQogICAgLy8g5aaC5p6c5pyJcGllY2VzSW5mb++8jOS5n+WPr+S7peS7juS4reiOt+WPluWwhuWGm+eKtuaAgQ0KICAgIGlmIChwaWVjZXNJbmZvICYmIHBpZWNlc0luZm8ubGVuZ3RoID4gMCkgew0KICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gcGllY2VzSW5mb1swXS5yZWRJc0luQ2hlY2sgOiBwaWVjZXNJbmZvWzBdLmJsYWNrSXNJbkNoZWNrOw0KICAgIH0NCiAgICANCiAgICAvLyDmsqHmnInpooTorqHnrpfnu5Pmnpzml7bvvIzmiafooYzljp/lp4vorqHnrpcNCiAgICAvLyDkvJjljJblkI7nmoRpc0NoZWNr5Ye95pWw77yM6YG/5YWN6YeN5aSN6LCD55SoZ2V0UGllY2VNb3Zlcw0KICAgIGxldCBnZW5lcmFsUG9zID0gbnVsbDsNCiAgICBmb3IobGV0IHI9MDsgcjxST1dTOyByKyspIHsNCiAgICAgICAgZm9yKGxldCBjPTA7IGM8Q09MUzsgYysrKSB7IA0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICBnZW5lcmFsUG9zID0ge3IsIGN9Ow0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmIChnZW5lcmFsUG9zKSBicmVhazsNCiAgICB9DQogICAgDQogICAgaWYgKCFnZW5lcmFsUG9zKSByZXR1cm4gdHJ1ZTsNCg0KICAgIGNvbnN0IGVuZW15Q29sb3IgPSBjb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgY29uc3QgeyByOiBnciwgYzogZ2MgfSA9IGdlbmVyYWxQb3M7DQogICAgDQogICAgLy8g5qOA5p+l55u057q/5pS75Ye777yI6L2m44CB5bCG77yJDQogICAgY29uc3QgZGlyZWN0aW9ucyA9IFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV07DQogICAgZm9yIChjb25zdCBbZHIsIGRjXSBvZiBkaXJlY3Rpb25zKSB7DQogICAgICAgIGxldCBuciA9IGdyICsgZHI7DQogICAgICAgIGxldCBuYyA9IGdjICsgZGM7DQogICAgICAgIA0KICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgIGlmIChwKSB7DQogICAgICAgICAgICAgICAgaWYgKHAuY29sb3IgPT09IGVuZW15Q29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKChwLnR5cGUgPT09ICdjaGFyaW90JyB8fCBwLnR5cGUgPT09ICdnZW5lcmFsJykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDkuJPpl6jmo4Dmn6Xngq7nmoTmlLvlh7vvvJrmlYzmlrnngq7lkozmiJHmlrnlsIblnKjkuIDmnaHnur/vvIzkuK3pl7TpmpTnnYDkuIDkuKrku7vmhI/mo4vlrZANCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdjYW5ub24nKSB7DQogICAgICAgICAgICAgICAgLy8g5qOA5p+l54Ku5ZKM5bCG5piv5ZCm5Zyo5ZCM5LiA55u057q/5LiKDQogICAgICAgICAgICAgICAgaWYgKHIgPT09IGdyIHx8IGMgPT09IGdjKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOebtOe6v+S4iu+8jOiuoeeul+S4remXtOeahOaji+WtkOaVsOmHjw0KICAgICAgICAgICAgICAgICAgICBsZXQgc2NyZWVuQ291bnQgPSAwOw0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgaWYgKHIgPT09IGdyKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDooYwNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0Q29sID0gTWF0aC5taW4oYywgZ2MpOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kQ29sID0gTWF0aC5tYXgoYywgZ2MpOw0KICAgICAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBjb2wgPSBzdGFydENvbCArIDE7IGNvbCA8IGVuZENvbDsgY29sKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoYm9hcmRbcl1bY29sXSAhPT0gbnVsbCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzY3JlZW5Db3VudCsrOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOWIlw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnRSb3cgPSBNYXRoLm1pbihyLCBncik7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmRSb3cgPSBNYXRoLm1heChyLCBncik7DQogICAgICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAobGV0IHJvdyA9IHN0YXJ0Um93ICsgMTsgcm93IDwgZW5kUm93OyByb3crKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChib2FyZFtyb3ddW2NdICE9PSBudWxsKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjcmVlbkNvdW50Kys7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyDngq7pnIDopoHkuIDkuKrngq7mnrbmiY3og73mlLvlh7sNCiAgICAgICAgICAgICAgICAgICAgaWYgKHNjcmVlbkNvdW50ID09PSAxKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDmo4Dmn6Xmlpznur/mlLvlh7vvvIjpqazjgIHlo6vjgIHosaHvvIkNCiAgICAvLyDmo4Dmn6XpqaznmoTmlLvlh7sNCiAgICBjb25zdCBob3JzZU1vdmVzID0gW1syLCAxXSwgWzIsIC0xXSwgWy0yLCAxXSwgWy0yLCAtMV0sIFsxLCAyXSwgWzEsIC0yXSwgWy0xLCAyXSwgWy0xLCAtMl1dOw0KICAgIGZvciAoY29uc3QgW2RyLCBkY10gb2YgaG9yc2VNb3Zlcykgew0KICAgICAgICBjb25zdCBuciA9IGdyICsgZHI7DQogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkYzsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MobnIsIG5jKSkgew0KICAgICAgICAgICAgLy8g5qOA5p+l6ams6IW/DQogICAgICAgICAgICBjb25zdCBsZWdSID0gZ3IgKyAoTWF0aC5hYnMoZHIpID09PSAyID8gTWF0aC5zaWduKGRyKSA6IDApOw0KICAgICAgICAgICAgY29uc3QgbGVnQyA9IGdjICsgKE1hdGguYWJzKGRjKSA9PT0gMiA/IE1hdGguc2lnbihkYykgOiAwKTsNCiAgICAgICAgICAgIGlmIChib2FyZFtsZWdSXVtsZWdDXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnaG9yc2UnKSB7DQogICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDmo4Dmn6Xlo6vnmoTmlLvlh7vvvIjlj6rlnKjkuZ3lrqvlhoXvvIkNCiAgICBjb25zdCBhZHZpc29yTW92ZXMgPSBbWzEsIDFdLCBbMSwgLTFdLCBbLTEsIDFdLCBbLTEsIC0xXV07DQogICAgZm9yIChjb25zdCBbZHIsIGRjXSBvZiBhZHZpc29yTW92ZXMpIHsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGRyOw0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYgDQogICAgICAgICAgICAoKGNvbG9yID09PSAncmVkJyAmJiBuciA+PSAwICYmIG5yIDw9IDIpIHx8IChjb2xvciA9PT0gJ2JsYWNrJyAmJiBuciA+PSA3ICYmIG5yIDw9IDkpKSAmJg0KICAgICAgICAgICAgbmMgPj0gMyAmJiBuYyA8PSA1KSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnYWR2aXNvcicpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDmo4Dmn6XlhbXnmoTmlLvlh7sNCiAgICBjb25zdCBzb2xkaWVyRGlyID0gY29sb3IgPT09ICdyZWQnID8gMSA6IC0xOw0KICAgIGNvbnN0IHNvbGRpZXJNb3ZlcyA9IFtbc29sZGllckRpciwgMF0sIFswLCAxXSwgWzAsIC0xXV07DQogICAgZm9yIChjb25zdCBbZHIsIGRjXSBvZiBzb2xkaWVyTW92ZXMpIHsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGRyOw0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIC8vIOajgOafpeWFteaYr+WQpuWPr+S7peaUu+WHu+WIsOWwhu+8iOi/h+ays+WQjueahOWFteWPr+S7peW3puWPs+enu+WKqO+8iQ0KICAgICAgICAgICAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGNvbG9yID09PSAncmVkJyA/IG5yID49IDUgOiBuciA8PSA0Ow0KICAgICAgICAgICAgICAgIGlmIChkciAhPT0gMCAmJiBjcm9zc2VkUml2ZXIgfHwgZHIgPT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIHJldHVybiBmYWxzZTsNCn07DQoNCi8vIOS/ruWkje+8muavj+asoeajgOafpei1sOazleaXtuWFi+mahuaji+ebmO+8jOmBv+WFjeS/ruaUueWOn+Wni+WvueixoQ0KY29uc3QgZ2V0VmFsaWRNb3ZlcyA9IChib2FyZCwgcG9zKSA9PiB7DQogIGNvbnN0IHBpZWNlID0gYm9hcmRbcG9zLnJdW3Bvcy5jXTsNCiAgaWYgKCFwaWVjZSkgcmV0dXJuIFtdOw0KICANCiAgY29uc3QgcHNldWRvTW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCBwb3MsIHBpZWNlKTsNCiAgY29uc3QgdmFsaWRNb3ZlcyA9IFtdOw0KICANCiAgZm9yIChjb25zdCB0byBvZiBwc2V1ZG9Nb3Zlcykgew0KICAgIC8vIOWFi+mahuaji+ebmO+8jOmBv+WFjeS/ruaUueWOn+Wni+WvueixoQ0KICAgIGNvbnN0IGNsb25lZEJvYXJkID0gYm9hcmQubWFwKHJvdyA9PiBbLi4ucm93XSk7DQogICAgDQogICAgLy8g5L+u5pS55YWL6ZqG5ZCO55qE5qOL55uYDQogICAgY2xvbmVkQm9hcmRbdG8ucl1bdG8uY10gPSBjbG9uZWRCb2FyZFtwb3Mucl1bcG9zLmNdOw0KICAgIGNsb25lZEJvYXJkW3Bvcy5yXVtwb3MuY10gPSBudWxsOw0KICAgIA0KICAgIC8vIOajgOafpei1sOazleaYr+WQpuWQiOazlQ0KICAgIGxldCBpc1ZhbGlkID0gdHJ1ZTsNCiAgICBpZiAoaXNGbHlpbmdHZW5lcmFsKGNsb25lZEJvYXJkKSkgew0KICAgICAgaXNWYWxpZCA9IGZhbHNlOw0KICAgIH0gZWxzZSBpZiAoaXNDaGVjayhjbG9uZWRCb2FyZCwgcGllY2UuY29sb3IpKSB7DQogICAgICBpc1ZhbGlkID0gZmFsc2U7DQogICAgfQ0KICAgIA0KICAgIGlmIChpc1ZhbGlkKSB7DQogICAgICB2YWxpZE1vdmVzLnB1c2godG8pOw0KICAgIH0NCiAgfQ0KICANCiAgcmV0dXJuIHZhbGlkTW92ZXM7DQp9Ow0KDQpjb25zdCBpc1ZhbGlkUGxhY2VtZW50ID0gKHR5cGUsIGNvbG9yLCByLCBjKSA9PiB7DQogICAgY29uc3QgaXNSZWQgPSBjb2xvciA9PT0gJ3JlZCc7DQogICAgc3dpdGNoKHR5cGUpIHsNCiAgICAgICAgY2FzZSAnZ2VuZXJhbCc6DQogICAgICAgICAgICAvLyDluIXlsIblj6rog73lnKjkuZ3lrqvkuK3lv4PnmoTkuIDmnaHnur/kuIoNCiAgICAgICAgICAgIGlmIChjIDwgMyB8fCBjID4gNSkgcmV0dXJuIGZhbHNlOw0KICAgICAgICAgICAgaWYgKGlzUmVkKSByZXR1cm4gciA+PSAwICYmIHIgPD0gMjsNCiAgICAgICAgICAgIGVsc2UgcmV0dXJuIHIgPj0gNyAmJiByIDw9IDk7DQogICAgICAgIGNhc2UgJ2Fkdmlzb3InOg0KICAgICAgICAgICAgLy8g5aOr5Y+q6IO95Zyo5Lmd5a6r55qENeS4queCueS5i+S4gA0KICAgICAgICAgICAgY29uc3QgdmFsaWRBZHZpc29yUG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgIHJlZDogW1swLCAzXSwgWzAsIDVdLCBbMSwgNF0sIFsyLCAzXSwgWzIsIDVdXSwNCiAgICAgICAgICAgICAgICBibGFjazogW1s3LCAzXSwgWzcsIDVdLCBbOCwgNF0sIFs5LCAzXSwgWzksIDVdXQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIHJldHVybiB2YWxpZEFkdmlzb3JQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICBjYXNlICdlbGVwaGFudCc6DQogICAgICAgICAgICAvLyDnm7jlj6rog73lnKjlt7HmlrnljYrlnLrnmoQ35Liq54K55LmL5LiADQogICAgICAgICAgICBjb25zdCB2YWxpZEVsZXBoYW50UG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgIHJlZDogW1swLCAyXSwgWzAsIDZdLCBbMiwgMF0sIFsyLCA0XSwgWzIsIDhdLCBbNCwgMl0sIFs0LCA2XV0sDQogICAgICAgICAgICAgICAgYmxhY2s6IFtbNSwgMl0sIFs1LCA2XSwgWzcsIDBdLCBbNywgNF0sIFs3LCA4XSwgWzksIDJdLCBbOSwgNl1dDQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgcmV0dXJuIHZhbGlkRWxlcGhhbnRQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICBjYXNlICdzb2xkaWVyJzoNCiAgICAgICAgICAgIC8vIOWFteeahOS9jee9rumZkOWItu+8mui/h+ays+WJjeWPquiDveWcqOWBtuaVsOWIl++8jOi/h+ays+WQjuWPr+S7peWcqOS7u+S9leWIlw0KICAgICAgICAgICAgLy8g57qi5pa55YW16L+H5rKz5p2h5Lu25pivciA+PSA177yM6buR5pa55YW16L+H5rKz5p2h5Lu25pivciA8PSA0DQogICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBpc1JlZCA/IHIgPj0gNSA6IHIgPD0gNDsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICAvLyDov4fmsrPliY3lj6rog73lnKjlgbbmlbDliJfvvIhjPTAsMiw0LDYsOO+8iQ0KICAgICAgICAgICAgICAgIGlmICghWzAsIDIsIDQsIDYsIDhdLmluY2x1ZGVzKGMpKSByZXR1cm4gZmFsc2U7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOWFteeahOS9jee9rumZkOWItu+8mui/h+ays+WJjeWPquiDveWcqOWFteS9jeWSjOWFteS9jeWJjeaWue+8jOi/h+ays+WQjuaVjOaWueWNiuWcuumDveWQiOazlQ0KICAgICAgICAgICAgY29uc3QgdmFsaWRTb2xkaWVyUG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgIHJlZDogew0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnliJ3lp4vlhbXkvY3vvJpyPTMsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGluaXRpYWw6IFtbMywgMF0sIFszLCAyXSwgWzMsIDRdLCBbMywgNl0sIFszLCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWueWFteS9jeWJjeaWue+8mnI9NCwgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgZm9yd2FyZDogW1s0LCAwXSwgWzQsIDJdLCBbNCwgNF0sIFs0LCA2XSwgWzQsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+H5rKz57q/77yacj49NQ0KICAgICAgICAgICAgICAgICAgICBjcm9zc2VkUml2ZXI6IHIgPj0gNQ0KICAgICAgICAgICAgICAgIH0sDQogICAgICAgICAgICAgICAgYmxhY2s6IHsNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55Yid5aeL5YW15L2N77yacj02LCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBpbml0aWFsOiBbWzYsIDBdLCBbNiwgMl0sIFs2LCA0XSwgWzYsIDZdLCBbNiwgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnlhbXkvY3liY3mlrnvvJpyPTUsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGZvcndhcmQ6IFtbNSwgMF0sIFs1LCAyXSwgWzUsIDRdLCBbNSwgNl0sIFs1LCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/h+ays+e6v++8mnI8PTQNCiAgICAgICAgICAgICAgICAgICAgY3Jvc3NlZFJpdmVyOiByIDw9IDQNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgDQogICAgICAgICAgICBjb25zdCBzb2xkaWVySW5mbyA9IHZhbGlkU29sZGllclBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ107DQogICAgICAgICAgICBjb25zdCBpc0luaXRpYWxQb3MgPSBzb2xkaWVySW5mby5pbml0aWFsLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICAgICAgY29uc3QgaXNGb3J3YXJkUG9zID0gc29sZGllckluZm8uZm9yd2FyZC5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKHNvbGRpZXJJbmZvLmNyb3NzZWRSaXZlcikgew0KICAgICAgICAgICAgICAgIC8vIOi/h+ays+WQjuaVjOaWueWNiuWcuumDveWQiOazlQ0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDov4fmsrPliY3lj6rog73lnKjlhbXkvY3lkozlhbXkvY3liY3mlrkNCiAgICAgICAgICAgICAgICByZXR1cm4gaXNJbml0aWFsUG9zIHx8IGlzRm9yd2FyZFBvczsNCiAgICAgICAgICAgIH0NCiAgICAgICAgZGVmYXVsdDoNCiAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgIH0NCn07DQoNCmNvbnN0IGNoZWNrR2FtZVN0YXRlID0gKGJvYXJkLCB0dXJuLCBwaWVjZXNJbmZvID0gbnVsbCwgYm9hcmRJbmZvID0gbnVsbCkgPT4gew0KICAgIC8vIOS8mOWFiOS9v+eUqOmihOiuoeeul+eahGdhbWVTdGF0ZQ0KICAgIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLmdhbWVTdGF0ZSkgew0KICAgICAgICByZXR1cm4gYm9hcmRJbmZvLmdhbWVTdGF0ZTsNCiAgICB9DQogICAgDQogICAgLy8g5rKh5pyJ6aKE6K6h566X57uT5p6c5pe277yM5omn6KGM5Y6f5aeL6K6h566XDQogICAgbGV0IGhhc01vdmVzID0gZmFsc2U7DQogICAgZm9yKGxldCByPTA7IHI8Uk9XUzsgcisrKSB7DQogICAgICAgIGZvcihsZXQgYz0wOyBjPENPTFM7IGMrKykgew0KICAgICAgICAgICAgaWYgKGJvYXJkW3JdW2NdPy5jb2xvciA9PT0gdHVybikgew0KICAgICAgICAgICAgICAgIGlmIChnZXRWYWxpZE1vdmVzKGJvYXJkLCB7cixjfSkubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgICAgICBoYXNNb3ZlcyA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoaGFzTW92ZXMpIGJyZWFrOw0KICAgIH0NCg0KICAgIGlmIChoYXNNb3ZlcykgcmV0dXJuIHsgc3RhdHVzOiAncGxheWluZycgfTsNCg0KICAgIGNvbnN0IGluQ2hlY2sgPSBpc0NoZWNrKGJvYXJkLCB0dXJuLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgIGNvbnN0IG9wcG9uZW50ID0gdHVybiA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgDQogICAgaWYgKGluQ2hlY2spIHsNCiAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnY2hlY2ttYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgIH0gZWxzZSB7DQogICAgICAgIHJldHVybiB7IHN0YXR1czogJ3N0YWxlbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICB9DQp9Ow0KDQoNCg0KLy8g5aKe5by655qE5ri45oiP6Zi25q616K+G5YirDQpjb25zdCBnZXRHYW1lUGhhc2UgPSAoYm9hcmQpID0+IHsNCiAgLyoNCiAgY29uc3QgcGllY2VDb3VudCA9IGNvdW50UGllY2VzKGJvYXJkKTsNCiAgDQogIGlmIChwaWVjZUNvdW50IDw9IDgpIHJldHVybiAnZW5kZ2FtZSc7DQogIGlmIChwaWVjZUNvdW50IDw9IDE2KSByZXR1cm4gJ21pZGRsZWdhbWUnOw0KICByZXR1cm4gJ29wZW5pbmcnOw0KICAqLw0KICByZXR1cm4gJ29wZW5pbmcnOw0KfTsNCg0KLy8g5Yqo5oCB5p2D6YeN6K6h566XDQpjb25zdCBjYWxjdWxhdGVEeW5hbWljV2VpZ2h0cyA9IChwaGFzZSkgPT4gew0KICBzd2l0Y2ggKHBoYXNlKSB7DQogICAgY2FzZSAnb3BlbmluZyc6DQogICAgICByZXR1cm4geyBtYXRlcmlhbDogOCwgcG9zaXRpb246IDIsIHRhY3RpYzogNiwgc2FmZXR5OiA0LCBtb2JpbGl0eTogNywgdGhyZWF0OiAzIH07DQogICAgY2FzZSAnbWlkZGxlZ2FtZSc6DQogICAgICByZXR1cm4geyBtYXRlcmlhbDogNiwgcG9zaXRpb246IDksIHRhY3RpYzogNywgc2FmZXR5OiA2LCBtb2JpbGl0eTogOCwgdGhyZWF0OiA3IH07DQogICAgY2FzZSAnZW5kZ2FtZSc6DQogICAgICByZXR1cm4geyBtYXRlcmlhbDogOSwgcG9zaXRpb246IDcsIHRhY3RpYzogMiwgc2FmZXR5OiA4LCBtb2JpbGl0eTogNCwgdGhyZWF0OiA5IH07DQogICAgZGVmYXVsdDoNCiAgICAgIHJldHVybiB7IG1hdGVyaWFsOiA4LCBwb3NpdGlvbjogNSwgdGFjdGljOiA1LCBzYWZldHk6IDYsIG1vYmlsaXR5OiA1LCB0aHJlYXQ6IDUgfTsNCiAgfQ0KfTsNCg0KLy8g6K6h566X5qOL5a2Q5oC75pWwDQpjb25zdCBjb3VudFBpZWNlcyA9IChib2FyZCkgPT4gew0KICBsZXQgY291bnQgPSAwOw0KICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICBpZiAoYm9hcmRbcl1bY10pIGNvdW50Kys7DQogICAgfQ0KICB9DQogIHJldHVybiBjb3VudDsNCn07DQoNCi8vIOWunuS+i+WMllpvYnJpc3RIYXNoZXINCmNvbnN0IHpvYnJpc3RIYXNoZXIgPSBuZXcgWm9icmlzdEhhc2hlcigpOw0KDQovLyDnva7mjaLooajlrp7njrANCmNsYXNzIFRyYW5zcG9zaXRpb25UYWJsZSB7DQogICAgY29uc3RydWN0b3Ioc2l6ZSA9IE1hdGgucG93KDIsIDI0KSkgew0KICAgICAgICB0aGlzLnRhYmxlID0gbmV3IE1hcCgpOw0KICAgICAgICB0aGlzLnNpemUgPSBzaXplOw0KICAgICAgICB0aGlzLmhhc2hlciA9IHpvYnJpc3RIYXNoZXI7DQogICAgICAgIC8vIOe7n+iuoeS/oeaBrw0KICAgICAgICB0aGlzLnN0YXRzID0gew0KICAgICAgICAgICAgaGl0czogMCwNCiAgICAgICAgICAgIG1pc3NlczogMCwNCiAgICAgICAgICAgIGV4YWN0SGl0czogMCwNCiAgICAgICAgICAgIGxvd2VyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgdXBwZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICBzdG9yZXM6IDAsDQogICAgICAgICAgICBscnVFdmljdGlvbnM6IDAsDQogICAgICAgICAgICBjbGVhcnM6IDANCiAgICAgICAgfTsNCiAgICB9DQogICAgDQogICAgc3RvcmUoaGFzaCwgZGVwdGgsIHZhbHVlLCBmbGFnLCBiZXN0TW92ZSA9IG51bGwpIHsNCiAgICAgICAgaWYgKHRoaXMudGFibGUuc2l6ZSA+PSB0aGlzLnNpemUpIHsNCiAgICAgICAgICAgIC8vIOeugOWNleeahExSVeetlueVpe+8muenu+mZpOesrOS4gOS4quWFg+e0oA0KICAgICAgICAgICAgY29uc3QgZmlyc3RLZXkgPSB0aGlzLnRhYmxlLmtleXMoKS5uZXh0KCkudmFsdWU7DQogICAgICAgICAgICB0aGlzLnRhYmxlLmRlbGV0ZShmaXJzdEtleSk7DQogICAgICAgICAgICB0aGlzLnN0YXRzLmxydUV2aWN0aW9ucysrOw0KICAgICAgICB9DQogICAgICAgIHRoaXMudGFibGUuc2V0KGhhc2gsIHsgZGVwdGgsIHZhbHVlLCBmbGFnLCBiZXN0TW92ZSB9KTsNCiAgICAgICAgdGhpcy5zdGF0cy5zdG9yZXMrKzsNCiAgICB9DQogICAgDQogICAgcmV0cmlldmUoaGFzaCkgew0KICAgICAgICBjb25zdCBlbnRyeSA9IHRoaXMudGFibGUuZ2V0KGhhc2gpIHx8IG51bGw7DQogICAgICAgIGlmIChlbnRyeSkgew0KICAgICAgICAgICAgdGhpcy5zdGF0cy5oaXRzKys7DQogICAgICAgICAgICAvLyDnu5/orqHkuI3lkIznsbvlnovnmoTlkb3kuK0NCiAgICAgICAgICAgIHN3aXRjaCAoZW50cnkuZmxhZykgew0KICAgICAgICAgICAgICAgIGNhc2UgJ2V4YWN0JzoNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0cy5leGFjdEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgY2FzZSAnbG93ZXJib3VuZCc6DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMubG93ZXJib3VuZEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgY2FzZSAndXBwZXJib3VuZCc6DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMudXBwZXJib3VuZEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICB0aGlzLnN0YXRzLm1pc3NlcysrOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBlbnRyeTsNCiAgICB9DQogICAgDQogICAgY2xlYXIoKSB7DQogICAgICAgIHRoaXMudGFibGUuY2xlYXIoKTsNCiAgICAgICAgdGhpcy5zdGF0cy5jbGVhcnMrKzsNCiAgICB9DQogICAgDQogICAgLy8g6I635Y+W57uf6K6h5L+h5oGv5bm26K6h566X5ZG95Lit546HDQogICAgZ2V0U3RhdHMoKSB7DQogICAgICAgIGNvbnN0IHRvdGFsQWNjZXNzZXMgPSB0aGlzLnN0YXRzLmhpdHMgKyB0aGlzLnN0YXRzLm1pc3NlczsNCiAgICAgICAgY29uc3QgaGl0UmF0ZSA9IHRvdGFsQWNjZXNzZXMgPiAwID8gKHRoaXMuc3RhdHMuaGl0cyAvIHRvdGFsQWNjZXNzZXMgKiAxMDApLnRvRml4ZWQoMikgOiAwOw0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgLi4udGhpcy5zdGF0cywNCiAgICAgICAgICAgIHRvdGFsQWNjZXNzZXMsDQogICAgICAgICAgICBoaXRSYXRlLA0KICAgICAgICAgICAgY3VycmVudFNpemU6IHRoaXMudGFibGUuc2l6ZSwNCiAgICAgICAgICAgIG1heFNpemU6IHRoaXMuc2l6ZSwNCiAgICAgICAgICAgIGZpbGxQZXJjZW50YWdlOiAodGhpcy50YWJsZS5zaXplIC8gdGhpcy5zaXplICogMTAwKS50b0ZpeGVkKDIpDQogICAgICAgIH07DQogICAgfQ0KICAgIA0KICAgIC8vIOmHjee9rue7n+iuoeS/oeaBrw0KICAgIHJlc2V0U3RhdHMoKSB7DQogICAgICAgIHRoaXMuc3RhdHMgPSB7DQogICAgICAgICAgICBoaXRzOiAwLA0KICAgICAgICAgICAgbWlzc2VzOiAwLA0KICAgICAgICAgICAgZXhhY3RIaXRzOiAwLA0KICAgICAgICAgICAgbG93ZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICB1cHBlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHN0b3JlczogMCwNCiAgICAgICAgICAgIGxydUV2aWN0aW9uczogMCwNCiAgICAgICAgICAgIGNsZWFyczogMA0KICAgICAgICB9Ow0KICAgIH0NCn0NCg0KLy8g5oCn6IO957uf6K6hDQpsZXQgcGVyZlN0YXRzID0gew0KICAgIGV2YWx1YXRlQm9hcmRDb3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sDQogICAgcHJlcGFyZVNlYXJjaEluZm9Db3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sDQogICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnQ6IHsgcmVkOiAwLCBibGFjazogMCB9LA0KICAgIGFscGhhQmV0YUNhbGxzOiAwLCAgLy8g5oC76LCD55So5qyh5pWwDQogICAgbm9kZXNTZWFyY2hlZDoge30sIC8vIOaMiea3seW6pue7n+iuoeaQnOe0oueahOiKgueCueaVsA0KICAgIG1vdmVzR2VuZXJhdGVkOiB7fSwgLy8g5oyJ5rex5bqm57uf6K6h55Sf5oiQ55qE6LWw5rOV5pWwDQogICAgY3V0b2Zmczoge30sIC8vIOaMiea3seW6pue7n+iuoeWJquaeneasoeaVsA0KICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKQ0KfTsNCg0KLy8g6YeN572u57uf6K6h77yI5q+P5qyh5pCc57Si5byA5aeL5pe26LCD55So77yJDQpjb25zdCByZXNldFBlcmZTdGF0cyA9ICgpID0+IHsNCiAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50ID0geyByZWQ6IDAsIGJsYWNrOiAwIH07DQogICAgcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsNCiAgICBwZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsNCiAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMgPSAwOw0KICAgIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkID0ge307DQogICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkID0ge307DQogICAgcGVyZlN0YXRzLmN1dG9mZnMgPSB7fTsNCiAgICBwZXJmU3RhdHMuc3RhcnRUaW1lID0gRGF0ZS5ub3coKTsNCn07DQoNCi8vIOaJk+WNsOe7n+iuoeS/oeaBrw0KY29uc3QgbG9nUGVyZlN0YXRzID0gKGN1cnJlbnRQbGF5ZXIpID0+IHsNCiAgICBjb25zdCBlbGFwc2VkID0gRGF0ZS5ub3coKSAtIHBlcmZTdGF0cy5zdGFydFRpbWU7DQogICAgY29uc29sZS5sb2coYPCfk4og5oCn6IO957uf6K6hICgke2N1cnJlbnRQbGF5ZXJ9KSAtICR7ZWxhcHNlZH1tczpgKTsNCiAgICBjb25zb2xlLmxvZyhgICAgZXZhbHVhdGVCb2FyZDogcmVkPSR7cGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRDb3VudC5yZWR9LCBibGFjaz0ke3BlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQuYmxhY2t9YCk7DQogICAgY29uc29sZS5sb2coYCAgIHByZXBhcmVTZWFyY2hJbmZvOiByZWQ9JHtwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudC5yZWR9LCBibGFjaz0ke3BlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50LmJsYWNrfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXM6IHJlZD0ke3BlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudC5yZWR9LCBibGFjaz0ke3BlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudC5ibGFja31gKTsNCiAgICBjb25zb2xlLmxvZyhgICAgYWxwaGFCZXRh6LCD55So5qyh5pWwOiAke3BlcmZTdGF0cy5hbHBoYUJldGFDYWxsc31gKTsNCiAgICANCiAgICAvLyDmiZPljbDmjInmt7Hluqbnu5/orqHnmoToioLngrnmlbDjgIHotbDms5XmlbDjgIHliarmnp3mlbANCiAgICBjb25zdCBkZXB0aHMgPSBPYmplY3Qua2V5cyhwZXJmU3RhdHMubm9kZXNTZWFyY2hlZCkuc29ydCgoYSwgYikgPT4gYSAtIGIpOw0KICAgIGlmIChkZXB0aHMubGVuZ3RoID4gMCkgew0KICAgICAgICBjb25zb2xlLmxvZygnICAg5oyJ5rex5bqm57uf6K6hOicpOw0KICAgICAgICBmb3IgKGNvbnN0IGQgb2YgZGVwdGhzKSB7DQogICAgICAgICAgICBjb25zb2xlLmxvZyhgICAgICDmt7HluqYke2R9OiDoioLngrk9JHtwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXX0sIOi1sOazlT0ke3BlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSB8fCAwfSwg5Ymq5p6dPSR7cGVyZlN0YXRzLmN1dG9mZnNbZF0gfHwgMH1gKTsNCiAgICAgICAgfQ0KICAgIH0NCn07DQoNCmNvbnN0IHRyYW5zcG9zaXRpb25UYWJsZSA9IG5ldyBUcmFuc3Bvc2l0aW9uVGFibGUoKTsNCg0KLy8gV29ya2VyIG1lc3NhZ2UgaGFuZGxpbmcNCmlmICh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcpIHsNCiAgICBzZWxmLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKGUpIHsNCiAgICBjb25zdCB7IHR5cGUsIHBheWxvYWQgfSA9IGUuZGF0YTsNCiAgICANCiAgICBzd2l0Y2ggKHR5cGUpIHsgICAgICAgICAgICANCiAgICAgICAgY2FzZSAnU0VBUkNIJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogc2VhcmNoQm9hcmQsIHR1cm46IHNlYXJjaFR1cm4sIGRlcHRoOiBzZWFyY2hEZXB0aCwgcmFuZG9tbmVzczogc2VhcmNoUmFuZG9tbmVzcywgZ2FtZUlkLCBvcGVuaW5nQm9va0VuYWJsZWQ6IHNlYXJjaE9wZW5pbmdCb29rRW5hYmxlZCA9IHRydWUsIHBseTogc2VhcmNoUGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0OiBzZWFyY2hFbmFibGVUaW1lTGltaXQgPSBmYWxzZSB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIC8vIFNldCBvcGVuaW5nIGJvb2sgZW5hYmxlZCBzdGF0dXMNCiAgICAgICAgICAgIG9wZW5pbmdCb29rLnNldEVuYWJsZWQoc2VhcmNoT3BlbmluZ0Jvb2tFbmFibGVkKTsNCiAgICAgICAgICAgIC8vIOiusOW9leaQnOe0ouW8gOWni+aXtumXtA0KICAgICAgICAgICAgY29uc3Qgc3RhcnRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCk7DQogICAgICAgICAgICAvLyDmiafooYzmkJzntKINCiAgICAgICAgICAgIGNvbnN0IGJlc3RTZWFyY2hNb3ZlID0gZ2V0QmVzdE1vdmUoc2VhcmNoQm9hcmQsIHNlYXJjaFR1cm4sIHNlYXJjaERlcHRoLCBzZWFyY2hSYW5kb21uZXNzLCBzZWFyY2hQbHksIHNlYXJjaEVuYWJsZVRpbWVMaW1pdCk7DQogICAgICAgICAgICAvLyDorrDlvZXmkJzntKLnu5PmnZ/ml7bpl7TlubborqHnrpfmgJ3ogIPml7bpl7QNCiAgICAgICAgICAgIGNvbnN0IGVuZFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKTsNCiAgICAgICAgICAgIGNvbnN0IHRoaW5raW5nVGltZSA9IGVuZFRpbWUgLSBzdGFydFRpbWU7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOajgOafpeaYr+WQpuadpeiHquW8gOWxgOW6kw0KICAgICAgICAgICAgY29uc3QgYm9va01vdmVTZWFyY2ggPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShzZWFyY2hCb2FyZCwgc2VhcmNoUGx5KTsNCiAgICAgICAgICAgIGNvbnN0IGZyb21Cb29rU2VhcmNoID0gISFib29rTW92ZVNlYXJjaCAmJiBKU09OLnN0cmluZ2lmeShib29rTW92ZVNlYXJjaCkgPT09IEpTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5re75Yqg5oCn6IO957uf6K6h5pel5b+XDQogICAgICAgICAgICBsb2dQZXJmU3RhdHMoc2VhcmNoVHVybik7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOa3u+WKoOaAneiAg+aXtumXtOaXpeW/lw0KICAgICAgICAgICAgY29uc29sZS5sb2coYFNlYXJjaCBjb21wbGV0ZWQgaW4gJHtNYXRoLnJvdW5kKHRoaW5raW5nVGltZSl9bXMsIGdhbWVJZD0ke2dhbWVJZH0sIGJlc3RNb3ZlPSR7SlNPTi5zdHJpbmdpZnkoYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmUpfSwgc2Vjb25kQmVzdE1vdmU9JHtKU09OLnN0cmluZ2lmeShiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZSl9LCBmcm9tQm9vaz0ke2Zyb21Cb29rU2VhcmNofWApOw0KICAgICAgICAgICAgLy8g5Y+R6YCB5pCc57Si57uT5p6c5ZKM5oCd6ICD5pe26Ze0DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ1NFQVJDSF9DT01QTEVURScsIA0KICAgICAgICAgICAgICAgIHBheWxvYWQ6IHsgDQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlOiBiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSwgDQogICAgICAgICAgICAgICAgICAgIHNlY29uZEJlc3RNb3ZlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZSwgDQogICAgICAgICAgICAgICAgICAgIGdhbWVJZCwgDQogICAgICAgICAgICAgICAgICAgIGZyb21Cb29rOiBmcm9tQm9va1NlYXJjaCwgDQogICAgICAgICAgICAgICAgICAgIHRoaW5raW5nVGltZTogTWF0aC5yb3VuZCh0aGlua2luZ1RpbWUpLCAvLyDlm5voiI3kupTlhaXliLDmr6vnp5INCiAgICAgICAgICAgICAgICAgICAgbW92ZVNlcXVlbmNlOiBiZXN0U2VhcmNoTW92ZS5tb3ZlU2VxdWVuY2UsDQogICAgICAgICAgICAgICAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kTW92ZVNlcXVlbmNlLA0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNjb3JlOiBiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZVNjb3JlLA0KICAgICAgICAgICAgICAgICAgICBzZWNvbmRCZXN0TW92ZVNjb3JlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZVNjb3JlLA0KICAgICAgICAgICAgICAgICAgICBhbGxNb3Zlc1dpdGhTY29yZXM6IGJlc3RTZWFyY2hNb3ZlLmFsbE1vdmVzV2l0aFNjb3JlcyB8fCBbXQ0KICAgICAgICAgICAgICAgIH0gDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGNhc2UgJ2dldFZhbGlkTW92ZXMnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiB2bUJvYXJkLCBwb3M6IHZtUG9zIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgdmFsaWRNb3ZlcyA9IGdldFZhbGlkTW92ZXModm1Cb2FyZCwgdm1Qb3MpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ3ZhbGlkTW92ZXMnLA0KICAgICAgICAgICAgICAgIG1vdmVzOiB2YWxpZE1vdmVzDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnZ2V0UGllY2VSZWxhdGlvbnMnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBwckJvYXJkLCBwb3M6IHByUG9zIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBwckJvYXJkW3ByUG9zLnJdW3ByUG9zLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDosIPnlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE5qOL5a2Q5L+h5oGv5ZKMYm9hcmRJbmZvDQogICAgICAgICAgICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZShwckJvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRFdmFsdWF0aW9uID0gZXZhbHVhdGVCb2FyZChwckJvYXJkLCBmYWxzZSwgbnVsbCwgMCwgbnVsbCwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlc0luZm8gPSBib2FyZEV2YWx1YXRpb24ucGllY2VzSW5mbzsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5ib2FyZEluZm87DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIEdldCB0aGUgY3VycmVudCBwb3NpdGlvbidzIGNvbnRyb2xsZXJzIGZyb20gYm9hcmRJbmZvDQogICAgICAgICAgICBjb25zdCBjb250cm9sbGVycyA9IGJvYXJkSW5mb1twclBvcy5yXVtwclBvcy5jXSB8fCBbXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgbGV0IHJlbGF0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLCANCiAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnk6IFtdLCANCiAgICAgICAgICAgICAgICBndWFyZDogW10sIA0KICAgICAgICAgICAgICAgIGd1YXJkZWRCeTogW10sIA0KICAgICAgICAgICAgICAgIGNvbnRyb2w6IFtdLA0KICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJzOiBjb250cm9sbGVycyAvLyDmt7vliqDmjqfliLbogIXkv6Hmga/vvIznjrDlnKjmmK/kvY3nva7mlbDnu4QgW3tyLGN9XSANCiAgICAgICAgICAgIH07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOWmguaenOeCueWHu+eahOaYr+aji+WtkO+8jOi/lOWbnuivpeaji+WtkOeahOWFs+ezu+S/oeaBrw0KICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgY3VycmVudCBwaWVjZSBpbmZvDQogICAgICAgICAgICAgICAgY29uc3QgY3VycmVudFBpZWNlSW5mbyA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gcHJQb3MuciAmJiBwLmMgPT09IHByUG9zLmMpOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGllY2VJbmZvKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgcmVsYXRpb25zDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRocmVhdCA9IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0Lm1hcCh0aHJlYXRQaWVjZSA9PiAoeyByOiB0aHJlYXRQaWVjZS5yLCBjOiB0aHJlYXRQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGhyZWF0ZW5lZEJ5ID0gY3VycmVudFBpZWNlSW5mby50aHJlYXRlbmVkQnkubWFwKHRocmVhdGVuZWRCeVBpZWNlID0+ICh7IHI6IHRocmVhdGVuZWRCeVBpZWNlLnIsIGM6IHRocmVhdGVuZWRCeVBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBndWFyZCA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmQubWFwKGd1YXJkUGllY2UgPT4gKHsgcjogZ3VhcmRQaWVjZS5yLCBjOiBndWFyZFBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBndWFyZGVkQnkgPSBjdXJyZW50UGllY2VJbmZvLmd1YXJkZWRCeS5tYXAoZ3VhcmRlZEJ5UGllY2UgPT4gKHsgcjogZ3VhcmRlZEJ5UGllY2UuciwgYzogZ3VhcmRlZEJ5UGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2wgPSBjdXJyZW50UGllY2VJbmZvLmNvbnRyb2wubWFwKGNvbnRyb2xQb3MgPT4gKHsgcjogY29udHJvbFBvcy5yLCBjOiBjb250cm9sUG9zLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25zID0gew0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0LCANCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeSwgDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZCwgDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZGVkQnksIA0KICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbCwNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJzDQogICAgICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VSZWxhdGlvbnMnLA0KICAgICAgICAgICAgICAgIHJlbGF0aW9uczogcmVsYXRpb25zDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnY2hlY2tHYW1lU3RhdGUnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBjZ3NCb2FyZCwgdHVybjogY2dzVHVybiB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGNoZWNrR2FtZVN0YXRlKGNnc0JvYXJkLCBjZ3NUdXJuKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdnYW1lU3RhdGUnLA0KICAgICAgICAgICAgICAgIHN0YXRlOiBnYW1lU3RhdGUNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdldmFsdWF0ZUJvYXJkJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogZXZhbEJvYXJkLCB0dXJuOiBldmFsVHVybiwgaXNSZXBsYXkgPSBmYWxzZSwgZGVwdGggPSAxIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgLy8g5omT5Y2w5o6l5pS255qE5Y+C5pWwDQogICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdldmFsdWF0ZUJvYXJkIGNhbGxlZCB3aXRoOicsIHsgdHVybjogZXZhbFR1cm4sIGlzUmVwbGF5LCBkZXB0aCB9KTsNCiAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKGV2YWxCb2FyZCk7DQogICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCiAgICAgICAgICAgIGNvbnN0IGRldGFpbGVkRXZhbCA9IGV2YWx1YXRlQm9hcmQoZXZhbEJvYXJkLCBpc1JlcGxheSwgZXZhbFR1cm4sIGRlcHRoLCBldmFsVHVybiwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdkZXRhaWxlZEV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IGRldGFpbGVkRXZhbA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KDQogICAgICAgIGNhc2UgJ2V2YWx1YXRlUGllY2UnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBwaWVjZUV2YWxCb2FyZCwgcG9zOiBwaWVjZUV2YWxQb3MsIHR1cm4gfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IHBpZWNlRXZhbEJvYXJkW3BpZWNlRXZhbFBvcy5yXVtwaWVjZUV2YWxQb3MuY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghcGllY2UpIHsNCiAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMA0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g5Li75Yqo6LCD55SoZXZhbHVhdGVCb2FyZOiOt+WPluWujOaVtOeahOivhOS8sOS/oeaBrw0KICAgICAgICAgICAgICAgIC8vIOiOt+WPluW9k+WJjea4uOaIj+mYtuautQ0KICAgICAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKHBpZWNlRXZhbEJvYXJkKTsNCiAgICAgICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCiAgICAgICAgICAgICAgICBjb25zdCBib2FyZEV2YWx1YXRpb24gPSBldmFsdWF0ZUJvYXJkKHBpZWNlRXZhbEJvYXJkLCBmYWxzZSwgdHVybiwgMCwgdHVybiwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAvLyDku45ldmFsdWF0ZUJvYXJk55qE6L+U5Zue5YC85Lit5om+5Yiw5b2T5YmN5qOL5a2Q55qE5L+h5oGvDQogICAgICAgICAgICAgICAgY3VycmVudFBpZWNlSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5waWVjZXNJbmZvLmZpbmQoDQogICAgICAgICAgICAgICAgICAgIHAgPT4gcC5yID09PSBwaWVjZUV2YWxQb3MuciAmJiBwLmMgPT09IHBpZWNlRXZhbFBvcy5jDQogICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoY3VycmVudFBpZWNlSW5mbykgew0KICAgICAgICAgICAgICAgICAgICAvLyDlupTnlKjmnYPph43lubbov5Tlm57ljZXkuKrmo4vlrZDnmoTor4TkvLDlgLwNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXZhbHVhdGlvbiA9IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsOiBjdXJyZW50UGllY2VJbmZvLm1hdGVyaWFsVmFsdWUgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsLA0KICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IGN1cnJlbnRQaWVjZUluZm8ucG9zaXRpb25WYWx1ZSAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sDQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogY3VycmVudFBpZWNlSW5mby5tb2JpbGl0eVZhbHVlICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogY3VycmVudFBpZWNlSW5mby50aHJlYXRWYWx1ZSAqIFZBTFVFX1dFSUdIVFMudGhyZWF0LA0KICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiBjdXJyZW50UGllY2VJbmZvLnNhZmV0eVZhbHVlICogVkFMVUVfV0VJR0hUUy5zYWZldHksDQogICAgICAgICAgICAgICAgICAgICAgICB0YWN0aWM6IGN1cnJlbnRQaWVjZUluZm8udGFjdGljVmFsdWUgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYw0KICAgICAgICAgICAgICAgICAgICB9Ow0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IGV2YWx1YXRpb24NCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5aaC5p6c5LuN54S25om+5LiN5Yiw5qOL5a2Q5L+h5oGv77yM6L+U5Zue6buY6K6k5YC8DQogICAgICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgICAgICAgICBldmFsdWF0aW9uOiB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YWN0aWM6IDANCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2lzQ2hlY2snOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBjQm9hcmQsIGNvbG9yOiBjQ29sb3IgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVjayhjQm9hcmQsIGNDb2xvcik7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAnY2hlY2snLA0KICAgICAgICAgICAgICAgIGlzQ2hlY2s6IGluQ2hlY2sNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdpc1ZhbGlkUGxhY2VtZW50Jzogew0KICAgICAgICAgICAgY29uc3QgeyB0eXBlOiBpcFR5cGUsIGNvbG9yOiBpcENvbG9yLCByLCBjIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgdmFsaWRQbGFjZW1lbnQgPSBpc1ZhbGlkUGxhY2VtZW50KGlwVHlwZSwgaXBDb2xvciwgciwgYyk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAndmFsaWRQbGFjZW1lbnQnLA0KICAgICAgICAgICAgICAgIGlzVmFsaWQ6IHZhbGlkUGxhY2VtZW50DQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nJzogew0KICAgICAgICAgICAgY29uc3QgeyBtb3Zlcywgd2VpZ2h0cyB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIC8vIEFkZCB0aGUgb3BlbmluZyBsaW5lIHRvIHRoZSBvcGVuaW5nIGJvb2sNCiAgICAgICAgICAgIG9wZW5pbmdCb29rLmFkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyhbbW92ZXNdLCB3ZWlnaHRzKTsNCiAgICAgICAgICAgIC8vIFNlbmQgY29uZmlybWF0aW9uDQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ29wZW5pbmdMaW5lQWRkZWQnLCANCiAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlIA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ21vdmVzVG9Ob3RhdGlvbic6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IG5vdGF0aW9uID0gb3BlbmluZ0Jvb2subW92ZXNUb05vdGF0aW9uKGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7IA0KICAgICAgICAgICAgICAgIHR5cGU6ICdub3RhdGlvbicsIA0KICAgICAgICAgICAgICAgIG5vdGF0aW9uOiBub3RhdGlvbiANCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdub3RhdGlvblRvTW92ZXMnOiB7DQogICAgICAgICAgICBjb25zdCB7IG5vdGF0aW9uOiBub3RhdGlvblN0cmluZywgaW5pdGlhbEJvYXJkIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgbW92ZXNGcm9tTm90YXRpb24gPSBvcGVuaW5nQm9vay5ub3RhdGlvblRvTW92ZXMobm90YXRpb25TdHJpbmcsIGluaXRpYWxCb2FyZCk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ21vdmVzJywgDQogICAgICAgICAgICAgICAgbW92ZXM6IG1vdmVzRnJvbU5vdGF0aW9uIA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ3NldFZhbHVlV2VpZ2h0cyc6IHsNCiAgICAgICAgICAgIFZBTFVFX1dFSUdIVFMgPSB7IC4uLlZBTFVFX1dFSUdIVFMsIC4uLnBheWxvYWQgfTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdVcGRhdGVkIFZBTFVFX1dFSUdIVFM6JywgVkFMVUVfV0VJR0hUUyk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgIH0NCn07DQoNCiAgICAvLyBPdmVycmlkZSBjb25zb2xlLmxvZyB0byBzZW5kIG1lc3NhZ2VzIGJhY2sgdG8gbWFpbiB0aHJlYWQNCiAgICBjb25zdCBvcmlnaW5hbENvbnNvbGVMb2cgPSBjb25zb2xlLmxvZzsNCiAgICBjb25zb2xlLmxvZyA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHsNCiAgICAgICAgLy8gU2VuZCB0byBtYWluIHRocmVhZA0KICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgIHR5cGU6ICdsb2cnLA0KICAgICAgICAgICAgZGF0YTogYXJncy5qb2luKCcgJykNCiAgICAgICAgfSk7DQogICAgICAgIA0KICAgICAgICAvLyBBbHNvIGxvZyB0byB3b3JrZXIgY29uc29sZQ0KICAgICAgICBvcmlnaW5hbENvbnNvbGVMb2cuYXBwbHkoY29uc29sZSwgYXJncyk7DQogICAgfTsNCn0NCg0KLy8g6L+t5Luj5Yqg5rex5pCc57Si5a6e546wDQpjb25zdCBpdGVyYXRpdmVEZWVwZW5pbmcgPSAoYm9hcmQsIHR1cm4sIG1heERlcHRoID0gNCwgdGltZUxpbWl0ID0gNTAwMCwgZW5hYmxlVGltZUxpbWl0ID0gZmFsc2UpID0+IHsNCiAgLy8g6YeN572u5oCn6IO957uf6K6hDQogIHJlc2V0UGVyZlN0YXRzKCk7DQogIA0KICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpOw0KICBsZXQgYmVzdE1vdmUgPSBudWxsOw0KICBsZXQgc2Vjb25kQmVzdE1vdmUgPSBudWxsOw0KDQogIC8vIOa4heepuue9ruaNouihqA0KICB0cmFuc3Bvc2l0aW9uVGFibGUucmVzZXRTdGF0cygpOw0KICB0cmFuc3Bvc2l0aW9uVGFibGUuY2xlYXIoKTsNCiAgDQogIC8vIOesrOS4gOatpe+8muiOt+WPluW9k+WJjea4uOaIj+mYtuautQ0KICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZShib2FyZCk7DQogIC8vIOWwhua4uOaIj+mYtuautei9rOaNouS4uuadkOaWmeWAvOiuoeeul+aJgOmcgOeahOagvOW8jw0KICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCg0KICAvLyDkvb/nlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE6K+E5Lyw5L+h5oGv77yI5YyF5ouscGllY2VzSW5mb+WSjGJvYXJkSW5mb++8iQ0KICBjb25zdCByb290RXZhbFJlc3VsdCA9IGV2YWx1YXRlQm9hcmQoYm9hcmQsIGZhbHNlLCB0dXJuLCAwLCB0dXJuLCBnYW1lU3RhZ2UpOw0KICBjb25zdCByb290UGllY2VzSW5mbyA9IHJvb3RFdmFsUmVzdWx0LnBpZWNlc0luZm87DQogIGNvbnN0IHJvb3RCb2FyZEluZm8gPSByb290RXZhbFJlc3VsdC5ib2FyZEluZm87DQoNCiAgLy8g5pS26ZuG5omA5pyJ5qC56IqC54K56LWw5rOV77yM6L+H5ruk5o6J5Lya6YCB5ZCD55qE6LWw5rOVDQogIGxldCByb290TW92ZXMgPSBbXTsNCiAgDQogIC8vIOaUtumbhuagueiKgueCuei1sOazle+8jOS9v+eUqOmihOiuoeeul+eahGJvYXJkSW5mb+WSjHBpZWNlc0luZm8NCiAgLy9jb25zb2xlLmxvZyhg5byA5aeL5pS26ZuG5qC56IqC54K56LWw5rOV77yM5b2T5YmN546p5a62OiAke3R1cm59YCk7DQogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHIsIGMgfSk7DQogICAgICAgIC8vY29uc29sZS5sb2coYOaji+WtkCgke3J9LCR7Y30pICR7cGllY2UudHlwZX0g5pyJICR7dmFsaWREZXN0aW5hdGlvbnMubGVuZ3RofSDkuKrmnInmlYjnp7vliqhgKTsNCiAgICAgICAgdmFsaWREZXN0aW5hdGlvbnMuZm9yRWFjaCh0byA9PiB7DQogICAgICAgICAgLy8g5qOA5p+l55uu5qCH5L2N572u5piv5ZCm6KKr57qv5pWM5pa55o6n5Yi277yM5Lyg6YCS6aKE6K6h566X55qEYm9hcmRJbmZv5ZKMcGllY2VzSW5mbw0KICAgICAgICAgIGNvbnN0IGlzQWNjZXB0YWJsZSA9IGlzUG9zaXRpb25BY2NlcHRhYmxlKGJvYXJkLCB7IHIsIGMgfSwgdG8sIHR1cm4sIHJvb3RCb2FyZEluZm8sIHJvb3RQaWVjZXNJbmZvLCBwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAvL2NvbnNvbGUubG9nKGDnp7vliqggKCR7cn0sJHtjfSkgLT4gKCR7dG8ucn0sJHt0by5jfSkg5piv5ZCm5a6J5YWoOiAke2lzQWNjZXB0YWJsZX1gKTsNCiAgICAgICAgICBpZiAoaXNBY2NlcHRhYmxlKSB7DQogICAgICAgICAgICByb290TW92ZXMucHVzaCh7IGZyb206IHtyLGN9LCB0bywgc2NvcmU6IDAgfSk7DQogICAgICAgICAgICAvL2NvbnNvbGUubG9nKGDmt7vliqDlronlhajnp7vliqg6ICgke3J9LCR7Y30pIC0+ICgke3RvLnJ9LCR7dG8uY30pYCk7DQogICAgICAgICAgfQ0KICAgICAgICB9KTsNCiAgICAgIH0NCiAgICB9DQogIH0NCiAgLy9jb25zb2xlLmxvZyhg5qC56IqC54K56LWw5rOV5pS26ZuG5a6M5oiQ77yM5YWx5pS26ZuG5YiwICR7cm9vdE1vdmVzLmxlbmd0aH0g5Liq5a6J5YWo56e75YqoYCk7DQoNCiAgLy8g5a+55qC56IqC54K5552A5rOV6L+b6KGM5o6S5bqP77yM5Lyg6YCSZ2FtZVN0YWdl5ZKMYm9hcmRJbmZv6YG/5YWN6YeN5aSN6K6h566XDQogIHJvb3RNb3ZlcyA9IHNvcnRNb3Zlcyhyb290TW92ZXMsIGJvYXJkLCB0dXJuLCByb290UGllY2VzSW5mbywgZ2FtZVN0YWdlLCByb290Qm9hcmRJbmZvKTsNCiAgICANCiAgbGV0IGRlcHRoID0gbWF4RGVwdGg7ICANCiAgLy8g5qOA5p+l5pe26Ze06ZmQ5Yi2DQogIGlmIChlbmFibGVUaW1lTGltaXQgJiYgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA+IHRpbWVMaW1pdCkgew0KICAgIGNvbnNvbGUubG9nKGBJdGVyYXRpdmUgRGVlcGVuaW5nIHN0b3BwZWQgYXQgZGVwdGggJHtkZXB0aC0xfSBkdWUgdG8gdGltZSBsaW1pdGApOw0KICB9DQogIGNvbnNvbGUubG9nKGBTdGFydGluZyBkZXB0aCAke2RlcHRofSBzZWFyY2ggfCB0dXJuOiAke3R1cm59LCBtYXhEZXB0aDogJHttYXhEZXB0aH0sIHRpbWVMaW1pdDogJHt0aW1lTGltaXR9bXMsIGVuYWJsZVRpbWVMaW1pdDogJHtlbmFibGVUaW1lTGltaXR9YCk7DQogIA0KICANCiAgLy8g5a+55q+P5Liq5qC56IqC54K56LWw5rOV6L+b6KGMYWxwaGEtYmV0YeaQnOe0og0KICBmb3IgKGNvbnN0IGl0ZW0gb2Ygcm9vdE1vdmVzKSB7DQogICAgY29uc3QgbmV4dEJvYXJkID0gYm9hcmQubWFwKHJvdyA9PiBbLi4ucm93XSk7DQogICAgbmV4dEJvYXJkW2l0ZW0udG8ucl1baXRlbS50by5jXSA9IG5leHRCb2FyZFtpdGVtLmZyb20ucl1baXRlbS5mcm9tLmNdOw0KICAgIG5leHRCb2FyZFtpdGVtLmZyb20ucl1baXRlbS5mcm9tLmNdID0gbnVsbDsNCiAgICANCiAgICAvLyDmo4Dmn6XlvZPliY3lsYDpnaLmmK/lkKbkuLrmjYnlrZDlsYDpnaLkuJTlt7Lph43lpI005qyh5Lul5LiKDQogICAgY29uc3QgbmV4dEhhc2ggPSB6b2JyaXN0SGFzaGVyLmhhc2gobmV4dEJvYXJkKTsNCiAgICAvLyDorqHnrpfkuIvkuIDkuKrooYzmo4vnjqnlrrbvvIzln7rkuo7lvZPliY10dXJuDQogICAgY29uc3QgbmV4dFR1cm4gPSB0dXJuID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICANCiAgICAvLyDmraPnoa7nmoRtaW5pbWF46YC76L6R77yaDQogICAgLy8gMS4g5pCc57Si5Y+R6LW35pa55pivdHVybu+8jEFJ5Li6dHVybuWvu+aJvuacgOS8mOi1sOazlQ0KICAgIC8vIDIuIHR1cm7otbDlrozkuIDmraXlkI7vvIzova7liLDlr7nmiYsobmV4dFR1cm4p6LWw5qOLDQogICAgLy8gMy4gbWF4aW1pemluZ+WPguaVsO+8muW9k+WJjeeOqeWutuaYr+WQpuaYr+aQnOe0ouWPkei1t+aWuQ0KICAgIC8vICAgIC0g5aaC5p6c5piv77yMbWF4aW1pemluZyA9IHRydWXvvIjmnIDlpKfljJboh6rlt7HnmoTliIbmlbDvvIkNCiAgICAvLyAgICAtIOWmguaenOWQpu+8jG1heGltaXppbmcgPSBmYWxzZe+8iOacgOWwj+WMluWvueaJi+eahOWIhuaVsO+8iQ0KICAgIC8vIDQuIOS8oOmAknR1cm7kvZzkuLpzZWFyY2hJbml0aWF0b3LvvIznoa7kv53or4TkvLDlp4vnu4jku450dXJu6KeS5bqm6K6h566XDQogICAgDQogICAgY29uc3QgbWF4aW1pemluZyA9IGZhbHNlOw0KICAgIGNvbnN0IGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YShuZXh0Qm9hcmQsIGRlcHRoIC0gMSwgLUluZmluaXR5LCBJbmZpbml0eSwgbWF4aW1pemluZywgbmV4dFR1cm4sIGRlcHRoLCB0dXJuLCBnYW1lU3RhZ2UpOw0KICAgIGNvbnN0IHNjb3JlID0gYWxwaGFCZXRhUmVzdWx0LnZhbHVlOw0KICAgIGl0ZW0uc2NvcmUgPSBzY29yZTsNCiAgICBpdGVtLm1vdmVTZXF1ZW5jZSA9IFt7IGZyb206IGl0ZW0uZnJvbSwgdG86IGl0ZW0udG8gfSwgLi4uYWxwaGFCZXRhUmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogIH0NCiAgICANCiAgICAvLyDmjInliIbmlbDmjpLluo8gLSDnlLHkuo5zY29yZeW3sue7j+aYr+WHgOiDnOWIhu+8iOW9k+WJjeeOqeWuti3lr7nmiYvvvInvvIzmiYDku6Xlj4zmlrnpg73lupTpgInmi6nliIbmlbDmnIDlpKfnmoTotbDms5UNCiAgICByb290TW92ZXMuc29ydCgoYSwgYikgPT4gew0KICAgICAgICBjb25zdCBzY29yZURpZmYgPSBiLnNjb3JlIC0gYS5zY29yZTsNCiAgICAgICAgaWYgKE1hdGguYWJzKHNjb3JlRGlmZikgPCAxZS02KSB7DQogICAgICAgICAgICAvLyDliIbmlbDnm7jlkIzvvIzmoLnmja7og5zotJ/mg4XlhrXmr5TovoPluo/liJfplb/luqYNCiAgICAgICAgICAgIC8vIOiDnOWIqeWIhuaVsOS4uuato++8jOWksei0peWIhuaVsOS4uui0nw0KICAgICAgICAgICAgaWYgKGEuc2NvcmUgPiAwKSB7DQogICAgICAgICAgICAgICAgLy8g6YO95piv6IOc5Yip77yM6YCJ5oup5bqP5YiX5pu055+t55qEDQogICAgICAgICAgICAgICAgcmV0dXJuIChhLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApIC0gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCk7DQogICAgICAgICAgICB9IGVsc2UgaWYgKGEuc2NvcmUgPCAwKSB7DQogICAgICAgICAgICAgICAgLy8g6YO95piv5aSx6LSl77yM6YCJ5oup5bqP5YiX5pu06ZW/55qEDQogICAgICAgICAgICAgICAgcmV0dXJuIChiLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApIC0gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIHJldHVybiAwOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBzY29yZURpZmY7DQogICAgfSk7DQogICAgDQogICAgLy8g5pu05paw5pyA5LyY6LWw5rOVDQogICAgaWYgKHJvb3RNb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICBiZXN0TW92ZSA9IHJvb3RNb3Zlc1swXTsgLy8gcm9vdE1vdmVz5YWD57Sg55u05o6l5pivbW92ZeWvueixoe+8jOayoeaciS5tb3Zl5bGe5oCnDQogICAgICBzZWNvbmRCZXN0TW92ZSA9IHJvb3RNb3Zlcy5sZW5ndGggPiAxID8gcm9vdE1vdmVzWzFdIDogbnVsbDsNCiAgICB9DQogIA0KICAvLyDojrflj5blubbmiZPljbDnva7mjaLooajnu5/orqHkv6Hmga8NCiAgY29uc3QgdHRTdGF0cyA9IHRyYW5zcG9zaXRpb25UYWJsZS5nZXRTdGF0cygpOw0KDQogIC8qDQogIGNvbnNvbGUubG9nKCdcbue9ruaNouihqOS9v+eUqOe7n+iuoeS/oeaBrzonKTsNCiAgY29uc29sZS5sb2coYCAgIOiuv+mXruaAu+aVsDogJHt0dFN0YXRzLnRvdGFsQWNjZXNzZXN9YCk7DQogIGNvbnNvbGUubG9nKGAgICDlkb3kuK3mrKHmlbA6ICR7dHRTdGF0cy5oaXRzfSAoJHt0dFN0YXRzLmhpdFJhdGV9JSlgKTsNCiAgY29uc29sZS5sb2coYCAgIC0gRXhhY3Tlkb3kuK06ICR7dHRTdGF0cy5leGFjdEhpdHN9YCk7DQogIGNvbnNvbGUubG9nKGAgICAtIExvd2VyYm91bmTlkb3kuK06ICR7dHRTdGF0cy5sb3dlcmJvdW5kSGl0c31gKTsNCiAgY29uc29sZS5sb2coYCAgIC0gVXBwZXJib3VuZOWRveS4rTogJHt0dFN0YXRzLnVwcGVyYm91bmRIaXRzfWApOw0KICBjb25zb2xlLmxvZyhgICAg5pyq5ZG95Lit5qyh5pWwOiAke3R0U3RhdHMubWlzc2VzfWApOw0KICBjb25zb2xlLmxvZyhgICAg5a2Y5YKo5qyh5pWwOiAke3R0U3RhdHMuc3RvcmVzfWApOw0KICBjb25zb2xlLmxvZyhgICAgTFJV6amx6YCQ5qyh5pWwOiAke3R0U3RhdHMubHJ1RXZpY3Rpb25zfWApOw0KICBjb25zb2xlLmxvZyhgICAg6KGo5aGr5YWF546HOiAke3R0U3RhdHMuY3VycmVudFNpemV9LyR7dHRTdGF0cy5tYXhTaXplfSAoJHt0dFN0YXRzLmZpbGxQZXJjZW50YWdlfSUpYCk7DQogICovDQogIC8vIOaJvuWHuuacgOS8mOedgOazleW6j+WIl+WSjOasoeS8mOedgOazleW6j+WIlw0KICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOw0KICBsZXQgc2Vjb25kTW92ZVNlcXVlbmNlID0gW107DQogIGlmIChyb290TW92ZXMubGVuZ3RoID4gMCkgew0KICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSByb290TW92ZXNbMF0ubW92ZVNlcXVlbmNlIHx8IFtdOw0KICB9DQogIGlmIChyb290TW92ZXMubGVuZ3RoID4gMSkgew0KICAgIHNlY29uZE1vdmVTZXF1ZW5jZSA9IHJvb3RNb3Zlc1sxXS5tb3ZlU2VxdWVuY2UgfHwgW107DQogIH0NCiAgDQogIHJldHVybiB7IGJlc3RNb3ZlLCBzZWNvbmRCZXN0TW92ZSwgcm9vdE1vdmVzLCBzZWFyY2hUaW1lOiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lLCB0dFN0YXRzLCBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UsIHNlY29uZE1vdmVTZXF1ZW5jZSB9Ow0KfTsNCg0KLy8g5L+u5aSN77yaYWxwaGFCZXRh5Ye95pWw6ZyA6KaB5LiA5Liq6aKd5aSW55qE5Y+C5pWw5p2l5qCH6K+G5pCc57Si5Y+R6LW35pa577yM56Gu5L+d6K+E5Lyw5aeL57uI5LuO5Y+R6LW35pa56KeS5bqm6K6h566XDQpjb25zdCBhbHBoYUJldGEgPSAoYiwgZCwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsIHNlYXJjaERlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gY3VycmVudFBsYXllciwgZ2FtZVN0YWdlID0gJ21pZCcpID0+IHsNCiAgICAvLyBtYXhpbWl6aW5n6KGo56S65b2T5YmN546p5a625piv5ZCm5q2j5Zyo5pyA5aSn5YyW6Ieq5bex55qE5YiG5pWwDQogICAgLy8gY3VycmVudFBsYXllcuihqOekuuW9k+WJjeihjOaji+eOqeWutueahOminOiJsg0KICAgIC8vIHNlYXJjaEluaXRpYXRvcuihqOekuuaQnOe0ouWPkei1t+aWue+8jOivhOS8sOWAvOWni+e7iOS7juWPkei1t+aWueinkuW6puiuoeeulw0KDQogICAgLy8g5oCn6IO957uf6K6hDQogICAgcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzKys7DQogICAgaWYgKCFwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSkgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0gPSAwOw0KICAgIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKys7DQoNCiAgICBsZXQgcGllY2VzSW5mbywgYm9hcmRJbmZvLCBldmFsUmVzdWx0Ow0KDQogICAgLy8g5Y+26IqC54K577ya6LCD55So5a6M5pW055qEZXZhbHVhdGVCb2FyZA0KICAgIGlmIChkID09PSAwKSB7DQogICAgICAgIGV2YWxSZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGIsIGZhbHNlLCBzZWFyY2hJbml0aWF0b3IsIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSk7DQogICAgICAgIHBpZWNlc0luZm8gPSBldmFsUmVzdWx0LnBpZWNlc0luZm87DQogICAgICAgIGJvYXJkSW5mbyA9IGV2YWxSZXN1bHQuYm9hcmRJbmZvOw0KDQogICAgICAgIC8vIOWPtuiKgueCueivhOS8sO+8muWni+e7iOS7juaQnOe0ouWPkei1t+aWueinkuW6puiuoeeul+ivhOS8sOWAvA0KICAgICAgICBjb25zdCBldmFsUGxheWVyID0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCBvcHBvbmVudCA9IGV2YWxQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICAvLyDorqHnrpflh4Dog5zliIbvvJrlj5HotbfmlrnnmoTmgLvliIblh4/ljrvlr7nmlrnnmoTmgLvliIYNCiAgICAgICAgY29uc3QgbmV0U2NvcmUgPSBldmFsUmVzdWx0W2V2YWxQbGF5ZXJdLnRvdGFsIC0gZXZhbFJlc3VsdFtvcHBvbmVudF0udG90YWw7DQogICAgICAgIHJldHVybiB7IHZhbHVlOiBuZXRTY29yZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgIH0NCg0KICAgIC8vIOmdnuWPtuiKgueCue+8muS9v+eUqOi9u+mHj+e6p+eahHByZXBhcmVTZWFyY2hJbmZvDQogICAgY29uc3Qgc2VhcmNoSW5mbyA9IHByZXBhcmVTZWFyY2hJbmZvKGIsIGN1cnJlbnRQbGF5ZXIsIGdhbWVTdGFnZSk7DQogICAgcGllY2VzSW5mbyA9IHNlYXJjaEluZm8ucGllY2VzSW5mbzsNCiAgICBib2FyZEluZm8gPSBzZWFyY2hJbmZvLmJvYXJkSW5mbzsNCiAgICANCiAgICAvLyDmo4Dmn6XmuLjmiI/nirbmgIHvvIzkvb/nlKhib2FyZEluZm/kuK3nmoTpooTorqHnrpfnu5PmnpwNCiAgICBpZiAoYm9hcmRJbmZvLmdhbWVTdGF0ZSAmJiBib2FyZEluZm8uZ2FtZVN0YXRlLnN0YXR1cyAhPT0gJ3BsYXlpbmcnKSB7DQogICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGJvYXJkSW5mby5nYW1lU3RhdGU7DQogICAgICAgIC8vIOa4uOaIj+e7k+adn++8jOS7juaQnOe0ouWPkei1t+aWueinkuW6puivhOS8sA0KICAgICAgICBpZiAoZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ2NoZWNrbWF0ZScgfHwgZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ3N0YWxlbWF0ZScpIHsNCiAgICAgICAgICAgIC8vIOWmguaenOaQnOe0ouWPkei1t+aWueaYr+iOt+iDnOiAhe+8jOi/lOWbnuato+WIhu+8m+WQpuWImei/lOWbnui0n+WIhg0KICAgICAgICAgICAgY29uc3QgaXNJbml0aWF0b3JXaW5uZXIgPSBnYW1lU3RhdGUud2lubmVyID09PSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7DQogICAgICAgICAgICBjb25zdCBzdGVwc0Zyb21Sb290ID0gc2VhcmNoRGVwdGggLSBkOyAvLyDku47moLnoioLngrnliLDlvZPliY3oioLngrnnmoTmraXmlbANCiAgICAgICAgICAgIGNvbnN0IGFkanVzdGVkU2NvcmUgPSBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogc3RlcHNGcm9tUm9vdCk7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogYWRqdXN0ZWRTY29yZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICB9DQogICAgICAgIHJldHVybiB7IHZhbHVlOiAwLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KICAgIC8qDQogICAgLy8g5bCd6K+V5LuO572u5o2i6KGo5Lit6I635Y+W57yT5a2Y55qE57uT5p6cDQogICAgY29uc3QgaGFzaCA9IHpvYnJpc3RIYXNoZXIuaGFzaChiKTsNCiAgICBjb25zdCB0dEVudHJ5ID0gdHJhbnNwb3NpdGlvblRhYmxlLnJldHJpZXZlKGhhc2gpOw0KICAgIGlmICh0dEVudHJ5ICYmIHR0RW50cnkuZGVwdGggPj0gZCkgew0KICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnZXhhY3QnKSB7DQogICAgICAgICAgICByZXR1cm4gdHRFbnRyeS52YWx1ZTsNCiAgICAgICAgfSBlbHNlIGlmICh0dEVudHJ5LmZsYWcgPT09ICdsb3dlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlID49IGJldGEpIHsNCiAgICAgICAgICAgIHJldHVybiBiZXRhOw0KICAgICAgICB9IGVsc2UgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ3VwcGVyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgIHJldHVybiBhbHBoYTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICAqLw0KICAgDQoNCg0KDQogICAgaWYgKGQgPT09IDApIHsNCiAgICAgICAgLy8g5Y+26IqC54K56K+E5Lyw77ya5aeL57uI5LuO5pCc57Si5Y+R6LW35pa56KeS5bqm6K6h566X6K+E5Lyw5YC8DQogICAgICAgIGNvbnN0IGV2YWxQbGF5ZXIgPSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgIGNvbnN0IG9wcG9uZW50ID0gZXZhbFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIC8vIOiuoeeul+WHgOiDnOWIhu+8muWPkei1t+aWueeahOaAu+WIhuWHj+WOu+WvueaWueeahOaAu+WIhg0KICAgICAgICBjb25zdCBuZXRTY29yZSA9IGV2YWxSZXN1bHRbZXZhbFBsYXllcl0udG90YWwgLSBldmFsUmVzdWx0W29wcG9uZW50XS50b3RhbDsNCiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IG5ldFNjb3JlLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KDQogICAgLy8g6Z2e5Y+26IqC54K577yM5L2/55So5bey6I635Y+W55qEcGllY2VzSW5mb+WSjGJvYXJkSW5mbw0KICAgIGNvbnN0IGFiUGllY2VzSW5mbyA9IHBpZWNlc0luZm87DQogICAgY29uc3QgYWJCb2FyZEluZm8gPSBib2FyZEluZm87DQoNCiAgICAvLyDkvJjljJbvvJrlj6rnlJ/miJDlvZPliY3njqnlrrbnmoTmo4vlrZDnmoTotbDms5XvvIzpgb/lhY3kuI3lv4XopoHnmoTpgY3ljoYNCiAgICBsZXQgbW92ZXMgPSBbXTsNCiAgICAvLyDlvZPliY3njqnlrrbpopzoibLkuI5jdXJyZW50UGxheWVy5L+d5oyB5LiA6Ie0DQogICAgY29uc3QgY3VycmVudFBsYXllckNvbG9yID0gY3VycmVudFBsYXllcjsNCiAgICANCiAgICAvLyDpooTlhYjojrflj5bmiYDmnInlvZPliY3njqnlrrbnmoTmo4vlrZDkvY3nva7vvIzpgb/lhY3pgY3ljobmlbTkuKrmo4vnm5gNCiAgICBjb25zdCBwbGF5ZXJQaWVjZXMgPSBbXTsNCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgaWYgKGJbcl1bY10/LmNvbG9yID09PSBjdXJyZW50UGxheWVyQ29sb3IpIHsNCiAgICAgICAgICBwbGF5ZXJQaWVjZXMucHVzaCh7IHIsIGMsIHBpZWNlOiBiW3JdW2NdIH0pOw0KICAgICAgICB9DQogICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIOWPqumBjeWOhuW9k+WJjeeOqeWutueahOaji+WtkO+8jOeUn+aIkOi1sOazle+8jOi/h+a7pOaOieS8mumAgeWQg+eahOi1sOazlQ0KICAgIGZvciAoY29uc3QgeyByLCBjLCBwaWVjZSB9IG9mIHBsYXllclBpZWNlcykgew0KICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGIsIHsgciwgYyB9KTsNCiAgICAgIHZhbGlkRGVzdGluYXRpb25zLmZvckVhY2godG8gPT4gew0KICAgICAgICAgLy8g5qOA5p+l55uu5qCH5L2N572u5piv5ZCm6KKr57qv5pWM5pa55o6n5Yi277yM5Lyg6YCS6aKE6K6h566X55qEYm9hcmRJbmZv5ZKMcGllY2VzSW5mbw0KICAgICAgICAgaWYgKGlzUG9zaXRpb25BY2NlcHRhYmxlKGIsIHsgciwgYyB9LCB0bywgY3VycmVudFBsYXllckNvbG9yLCBhYkJvYXJkSW5mbywgYWJQaWVjZXNJbmZvLCBwaWVjZSwgZ2FtZVN0YWdlKSkgew0KICAgICAgICAgICBtb3Zlcy5wdXNoKHsgZnJvbToge3IsY30sIHRvLCBzY29yZTogMCB9KTsNCiAgICAgICAgIH0NCiAgICAgIH0pOw0KICAgIH0NCiAgICANCiAgICAvLyDlpITnkIbnqbptb3Zlc+aVsOe7hO+8jOmBv+WFjei/lOWbnkluZmluaXR5DQogICAgaWYgKG1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAvLyDkvb/nlKhib2FyZEluZm/kuK3nmoTpooTorqHnrpdnYW1lU3RhdGUNCiAgICAgICAgY29uc3QgZ2FtZVN0YXRlID0gYWJCb2FyZEluZm8uZ2FtZVN0YXRlOw0KICAgICAgICBpZiAoZ2FtZVN0YXRlICYmIChnYW1lU3RhdGUuc3RhdHVzID09PSAnY2hlY2ttYXRlJyB8fCBnYW1lU3RhdGUuc3RhdHVzID09PSAnc3RhbGVtYXRlJykpIHsNCiAgICAgICAgICAgIC8vIOWmguaenOaQnOe0ouWPkei1t+aWueaYr+iOt+iDnOiAhe+8jOi/lOWbnuato+WIhu+8m+WQpuWImei/lOWbnui0n+WIhg0KICAgICAgICAgICAgY29uc3QgaXNJbml0aWF0b3JXaW5uZXIgPSBnYW1lU3RhdGUud2lubmVyID09PSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7DQogICAgICAgICAgICBjb25zdCBzdGVwc0Zyb21Sb290ID0gc2VhcmNoRGVwdGggLSBkOyAvLyDku47moLnoioLngrnliLDlvZPliY3oioLngrnnmoTmraXmlbANCiAgICAgICAgICAgIGNvbnN0IGFkanVzdGVkU2NvcmUgPSBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogc3RlcHNGcm9tUm9vdCk7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogYWRqdXN0ZWRTY29yZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICB9DQogICAgICAgIHJldHVybiB7IHZhbHVlOiAwLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KDQogICAgLy8g57uf6K6h55Sf5oiQ55qE6LWw5rOV5pWwDQogICAgaWYgKCFwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0pIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSA9IDA7DQogICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdICs9IG1vdmVzLmxlbmd0aDsNCg0KICAgIC8vIOiuoeeul+WogeiDgeS/oeaBr+eUqOS6juaOkuW6j++8iOWPquacieaOkuW6j+mcgOimgei/meS6m+S/oeaBr++8iQ0KICAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlcyhiLCBhYlBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBhYkJvYXJkSW5mbyk7DQogICAgDQogICAgLy8g5a+5552A5rOV6L+b6KGM5o6S5bqP77yM5Lyg6YCSZ2FtZVN0YWdl5ZKMYm9hcmRJbmZv6YG/5YWN6YeN5aSN6K6h566XDQogICAgbW92ZXMgPSBzb3J0TW92ZXMobW92ZXMsIGIsIGN1cnJlbnRQbGF5ZXJDb2xvciwgYWJQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGFiQm9hcmRJbmZvKTsNCiAgICANCiAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgbGV0IG1heEV2YWwgPSAtSW5maW5pdHk7DQogICAgICBsZXQgYmVzdE1vdmUgPSBudWxsOw0KICAgICAgbGV0IGJlc3RNb3ZlU2VxdWVuY2UgPSBbXTsNCiAgICAgIGZvciAoY29uc3QgbW92ZSBvZiBtb3Zlcykgew0KICAgICAgICBjb25zdCBuZXh0Qm9hcmQgPSBiLm1hcChyb3cgPT4gWy4uLnJvd10pOw0KICAgICAgICBuZXh0Qm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdID0gbmV4dEJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107DQogICAgICAgIG5leHRCb2FyZFttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdID0gbnVsbDsNCiAgICAgICAgLy8g5LiL5LiA5Liq6KGM5qOL55qE546p5a625piv5b2T5YmN546p5a6255qE5a+55omLDQogICAgICAgIGNvbnN0IG5leHRQbGF5ZXIgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgLy8g6YCS5b2S6LCD55So5pe25L+d5oyBc2VhcmNoSW5pdGlhdG9y5LiN5Y+Y77yM56Gu5L+d6K+E5Lyw5aeL57uI5LuO5Y+R6LW35pa56KeS5bqm6K6h566XDQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCByZXN1bHQgPSBhbHBoYUJldGEobmV4dEJvYXJkLCBkIC0gMSwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLCBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpOw0KICAgICAgICBpZiAocmVzdWx0LnZhbHVlID4gbWF4RXZhbCkgew0KICAgICAgICAgIG1heEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOw0KICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgIH0NCiAgICAgICAgYWxwaGEgPSBNYXRoLm1heChhbHBoYSwgcmVzdWx0LnZhbHVlKTsNCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgIC8vIOe7n+iuoeWJquaenQ0KICAgICAgICAgICAgaWYgKCFwZXJmU3RhdHMuY3V0b2Zmc1tkXSkgcGVyZlN0YXRzLmN1dG9mZnNbZF0gPSAwOw0KICAgICAgICAgICAgcGVyZlN0YXRzLmN1dG9mZnNbZF0rKzsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICB9DQogICAgICAvKg0KICAgICAgLy8g5a2Y5YKo5Yiw572u5o2i6KGoDQogICAgICBjb25zdCBoYXNoID0gem9icmlzdEhhc2hlci5oYXNoKGIpOw0KICAgICAgbGV0IGZsYWc7DQogICAgICBpZiAobWF4RXZhbCA8PSBhbHBoYSkgew0KICAgICAgICBmbGFnID0gJ3VwcGVyYm91bmQnOw0KICAgICAgfSBlbHNlIGlmIChtYXhFdmFsID49IGJldGEpIHsNCiAgICAgICAgZmxhZyA9ICdsb3dlcmJvdW5kJzsNCiAgICAgIH0gZWxzZSB7DQogICAgICAgIGZsYWcgPSAnZXhhY3QnOw0KICAgICAgfQ0KICAgICAgdHJhbnNwb3NpdGlvblRhYmxlLnN0b3JlKGhhc2gsIGQsIG1heEV2YWwsIGZsYWcsIGJlc3RNb3ZlKTsNCiAgICAgICovDQogICAgICByZXR1cm4geyB2YWx1ZTogbWF4RXZhbCwgbW92ZVNlcXVlbmNlOiBiZXN0TW92ZVNlcXVlbmNlIH07DQogICAgfSBlbHNlIHsNCiAgICAgIGxldCBtaW5FdmFsID0gSW5maW5pdHk7DQogICAgICBsZXQgYmVzdE1vdmUgPSBudWxsOw0KICAgICAgbGV0IGJlc3RNb3ZlU2VxdWVuY2UgPSBbXTsNCiAgICAgIGZvciAoY29uc3QgbW92ZSBvZiBtb3Zlcykgew0KICAgICAgICBjb25zdCBuZXh0Qm9hcmQgPSBiLm1hcChyb3cgPT4gWy4uLnJvd10pOw0KICAgICAgICBuZXh0Qm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdID0gbmV4dEJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107DQogICAgICAgIG5leHRCb2FyZFttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdID0gbnVsbDsNCiAgICAgICAgLy8g5LiL5LiA5Liq6KGM5qOL55qE546p5a625piv5b2T5YmN546p5a6255qE5a+55omLDQogICAgICAgIGNvbnN0IG5leHRQbGF5ZXIgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgLy8g6YCS5b2S6LCD55So5pe25L+d5oyBc2VhcmNoSW5pdGlhdG9y5LiN5Y+Y77yM56Gu5L+d6K+E5Lyw5aeL57uI5LuO5Y+R6LW35pa56KeS5bqm6K6h566XDQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCByZXN1bHQgPSBhbHBoYUJldGEobmV4dEJvYXJkLCBkIC0gMSwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLCBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpOw0KICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgbWluRXZhbCkgew0KICAgICAgICAgIG1pbkV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOw0KICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgIH0NCiAgICAgICAgYmV0YSA9IE1hdGgubWluKGJldGEsIHJlc3VsdC52YWx1ZSk7DQogICAgICAgIGlmIChiZXRhIDw9IGFscGhhKSB7DQogICAgICAgICAgICAvLyDnu5/orqHliarmnp0NCiAgICAgICAgICAgIGlmICghcGVyZlN0YXRzLmN1dG9mZnNbZF0pIHBlcmZTdGF0cy5jdXRvZmZzW2RdID0gMDsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5jdXRvZmZzW2RdKys7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgICAgLyoNCiAgICAgIC8vIOWtmOWCqOWIsOe9ruaNouihqA0KICAgICAgY29uc3QgaGFzaCA9IHpvYnJpc3RIYXNoZXIuaGFzaChiKTsNCiAgICAgIGxldCBmbGFnOw0KICAgICAgaWYgKG1pbkV2YWwgPD0gYWxwaGEpIHsNCiAgICAgICAgZmxhZyA9ICd1cHBlcmJvdW5kJzsNCiAgICAgIH0gZWxzZSBpZiAobWluRXZhbCA+PSBiZXRhKSB7DQogICAgICAgIGZsYWcgPSAnbG93ZXJib3VuZCc7DQogICAgICB9IGVsc2Ugew0KICAgICAgICBmbGFnID0gJ2V4YWN0JzsNCiAgICAgIH0NCiAgICAgIHRyYW5zcG9zaXRpb25UYWJsZS5zdG9yZShoYXNoLCBkLCBtaW5FdmFsLCBmbGFnLCBiZXN0TW92ZSk7DQogICAgICAqLw0KICAgICAgcmV0dXJuIHsgdmFsdWU6IG1pbkV2YWwsIG1vdmVTZXF1ZW5jZTogYmVzdE1vdmVTZXF1ZW5jZSB9Ow0KICAgIH0NCn07DQoNCmNvbnN0IGdldEJlc3RNb3ZlID0gKGJvYXJkLCB0dXJuLCBkZXB0aCA9IDQsIHJhbmRvbW5lc3MgPSAwLCBwbHkgPSAwLCBlbmFibGVUaW1lTGltaXQgPSBmYWxzZSkgPT4gew0KICBsZXQgYmVzdE1vdmUgPSBudWxsOw0KICBsZXQgc2Vjb25kQmVzdE1vdmUgPSBudWxsOw0KICBsZXQgcm9vdE1vdmVzID0gW107DQogIGxldCBiZXN0TW92ZVNlcXVlbmNlID0gW107DQoNCiAgLy8gRmlyc3QgdHJ5IHRvIGdldCBtb3ZlIGZyb20gb3BlbmluZyBib29rDQogIGNvbnN0IGJvb2tNb3ZlID0gb3BlbmluZ0Jvb2suZ2V0Qm9va01vdmUoYm9hcmQsIHBseSk7DQogIA0KICBpZiAoYm9va01vdmUpIHsNCiAgICAvLyBDaGVjayBpZiBib29rTW92ZSBpcyB2YWxpZCBmb3IgY3VycmVudCBib2FyZA0KICAgIGlmIChib29rTW92ZS5mcm9tICYmIGJvb2tNb3ZlLnRvICYmIA0KICAgICAgICB0eXBlb2YgYm9va01vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICB0eXBlb2YgYm9va01vdmUudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJvb2tNb3ZlLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICANCiAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYm9hcmRbYm9va01vdmUuZnJvbS5yXVtib29rTW92ZS5mcm9tLmNdOw0KICAgICAgDQogICAgICBpZiAobW92aW5nUGllY2UgJiYgbW92aW5nUGllY2UuY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgLy8gVmVyaWZ5IG1vdmUgaXMgdmFsaWQNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCBib29rTW92ZS5mcm9tKTsNCiAgICAgICAgY29uc3QgaXNWYWxpZCA9IHZhbGlkRGVzdGluYXRpb25zLnNvbWUoZGVzdCA9PiBkZXN0LnIgPT09IGJvb2tNb3ZlLnRvLnIgJiYgZGVzdC5jID09PSBib29rTW92ZS50by5jKTsNCiAgICAgICAgDQogICAgICAgIGlmIChpc1ZhbGlkKSB7DQogICAgICAgICAgcmV0dXJuIHsgYmVzdE1vdmU6IGJvb2tNb3ZlLCBzZWNvbmRCZXN0TW92ZTogbnVsbCwgbW92ZVNlcXVlbmNlOiBbXSwgc2Vjb25kTW92ZVNlcXVlbmNlOiBbXSwgYmVzdE1vdmVTY29yZTogMCwgc2Vjb25kQmVzdE1vdmVTY29yZTogMCwgYWxsTW92ZXNXaXRoU2NvcmVzOiBbXSB9Ow0KICAgICAgICB9DQogICAgICB9DQogICAgfQ0KICB9DQoNCiAgLy8g5L2/55So6L+t5Luj5Yqg5rex5pCc57Si6I635Y+W5pyA5LyY6LWw5rOVDQogIC8vY29uc29sZS5sb2coYOW8gOWni+i/reS7o+WKoOa3seaQnOe0ou+8jOa3seW6pjogJHtkZXB0aH1gKTsNCiAgY29uc3QgeyBiZXN0TW92ZTogaWRCZXN0TW92ZSwgc2Vjb25kQmVzdE1vdmU6IGlkU2Vjb25kQmVzdE1vdmUsIHJvb3RNb3ZlczogaWRSb290TW92ZXMsIHNlYXJjaFRpbWUsIG1vdmVTZXF1ZW5jZTogaWRNb3ZlU2VxdWVuY2UsIHNlY29uZE1vdmVTZXF1ZW5jZTogaWRTZWNvbmRNb3ZlU2VxdWVuY2UgfSA9IGl0ZXJhdGl2ZURlZXBlbmluZyhib2FyZCwgdHVybiwgZGVwdGgsIDUwMDAsIGVuYWJsZVRpbWVMaW1pdCk7DQogIA0KICAvLyDliJ3lp4vljJZyb290TW92ZXMNCiAgcm9vdE1vdmVzID0gaWRSb290TW92ZXM7DQogIC8vY29uc29sZS5sb2coYOi/reS7o+WKoOa3seaQnOe0ouWujOaIkO+8jOi/lOWbnueahGJlc3RNb3ZlOiAke0pTT04uc3RyaW5naWZ5KGlkQmVzdE1vdmUpfSwgc2Vjb25kQmVzdE1vdmU6ICR7SlNPTi5zdHJpbmdpZnkoaWRTZWNvbmRCZXN0TW92ZSl9LCByb290TW92ZXPmlbDph486ICR7cm9vdE1vdmVzLmxlbmd0aH1gKTsNCg0KICAvLyDku45yb290TW92ZXPkuK3ojrflj5bmnIDkvJjotbDms5XlkozmrKHkvJjotbDms5UNCiAgYmVzdE1vdmUgPSBpZEJlc3RNb3ZlOw0KICBzZWNvbmRCZXN0TW92ZSA9IGlkU2Vjb25kQmVzdE1vdmU7DQogIGJlc3RNb3ZlU2VxdWVuY2UgPSBpZE1vdmVTZXF1ZW5jZTsNCiAgc2Vjb25kTW92ZVNlcXVlbmNlID0gaWRTZWNvbmRNb3ZlU2VxdWVuY2U7DQoNCiAgLy8g6I635Y+W5pyA5LyY5ZKM5qyh5LyY552A5rOV55qE5YeA6IOc5YiGDQogIGxldCBiZXN0TW92ZVNjb3JlID0gMDsNCiAgbGV0IHNlY29uZEJlc3RNb3ZlU2NvcmUgPSAwOw0KICBpZiAocm9vdE1vdmVzLmxlbmd0aCA+IDApIHsNCiAgICBiZXN0TW92ZVNjb3JlID0gcm9vdE1vdmVzWzBdLnNjb3JlOw0KICB9DQogIGlmIChyb290TW92ZXMubGVuZ3RoID4gMSkgew0KICAgIHNlY29uZEJlc3RNb3ZlU2NvcmUgPSByb290TW92ZXNbMV0uc2NvcmU7DQogIH0NCiAgDQogIC8vIOi/lOWbnuaJgOacieedgOazleeahOWIhuaVsOS/oeaBr++8iOeUqOS6jkFuYWx5c2lz5Yqf6IO977yJDQogIGNvbnN0IGFsbE1vdmVzV2l0aFNjb3JlcyA9IHJvb3RNb3Zlcy5tYXAobW92ZUluZm8gPT4gKHsNCiAgICAvLyDmj5Dlj5Ztb3ZlSW5mb+S4reeahG1vdmXlsZ7mgKcNCiAgICBtb3ZlOiB7DQogICAgICBmcm9tOiBtb3ZlSW5mby5mcm9tLA0KICAgICAgdG86IG1vdmVJbmZvLnRvDQogICAgfSwNCiAgICBzY29yZTogbW92ZUluZm8uc2NvcmUsDQogICAgbW92ZVNlcXVlbmNlOiBtb3ZlSW5mby5tb3ZlU2VxdWVuY2UgfHwgW10NCiAgfSkpOw0KICANCiAgcmV0dXJuIHsgYmVzdE1vdmUsIHNlY29uZEJlc3RNb3ZlLCBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UsIHNlY29uZE1vdmVTZXF1ZW5jZSwgYmVzdE1vdmVTY29yZSwgc2Vjb25kQmVzdE1vdmVTY29yZSwgYWxsTW92ZXNXaXRoU2NvcmVzIH07DQp9Ow0KDQovLyAtLS0gV09SS0VSIExJU1RFTkVSICjnu5/kuIDmtojmga/lpITnkIYpIC0tLQ0K';
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
                    enableTimeLimit: enableTimeLimit
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

    const executeMove = async (move: Move, moveTurn?: Color) => {
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
            return; // 不是当前回合的棋子，不执行移动
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
                return; // 不执行这步棋，也不更新历史记录
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
        setCheckAlert(false);
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
    };

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
            //console.log('handlePieceSelect: isMyTurn:', isMyTurn);
            
            // 只有当前回合的棋子才显示有效移动
            if (isMyTurn) {
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
        
        // 检查移动是否在有效移动列表中
        const isValidMove = validMoves.some(move => 
            move.r === to.r && move.c === to.c
        );
        //console.log('handleMove: validMoves:', validMoves, 'isValidMove:', isValidMove);
        
        if (isValidMove) {
            //console.log('handleMove: valid move, executing');
            // 手动走棋时强制设置isThinking为false，确保移动能够执行
            setIsThinking(false);
            await executeMove({ from: selectedPos, to }, turn);
        } else {
            console.log('handleMove: invalid move, not executing');
        }
    };



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
        setBlackIsAuto(false);
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
                setCheckAlert(isCheckState);
                
                // 如果是将军状态，播放将军音效
                if (isCheckState) {
                    playCheckSound();
                }
            } else {
                // 非Replay模式，执行完整的游戏状态检查
                const state = await workerCheckGameState(currentBoard, currentTurn);
                if (state.status !== 'playing') {
                    // 设置待定的游戏结束状态
                    setPendingGameOver(state);
                    
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
                        enableTimeLimit: enableTimeLimit
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
                        enableTimeLimit: enableTimeLimit
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
        setBlackIsAuto(false);
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

    return (
        <div className="min-h-screen bg-stone-900 flex flex-col items-center justify-center p-4 font-sans text-stone-200 relative overflow-hidden select-none">
            <audio ref={sfxRef} src={CLICK_SOUND_URI} />
            
            {/* 新增的各种音效 */}
            <audio ref={moveSoundRef} src={MOVE_SOUND} />
            <audio ref={captureSoundRef} src={CAPTURE_SOUND} />
            <audio ref={checkSoundRef} src={CHECK_SOUND} />
            <audio ref={gameOverSoundRef} src={GAME_OVER_SOUND} />
            <audio ref={victorySoundRef} src={VICTORY_SOUND} />

            {/* 游戏模式选择按钮 - 位于棋盘正上方 */}
            <div className="w-full mb-3 max-w-[500px] mx-auto">
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

                <div className="relative order-1 lg:order-2">
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
                                    <button onClick={handleRestart} className="px-6 py-3 bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-500 text-white rounded-full font-bold text-lg shadow-lg">Play Again</button>
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
                                    disabled={isThinking} 
                                    style={getButtonStyle()}
                                    className="px-3 py-4 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95"
                                >
                                    <ArrowPathIcon className="w-4 h-4" />
                                    <span className="text-xs">Restart</span>
                                </button>
                                <button 
                                    onClick={() => {
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
                                    disabled={boardHistory.length < 1 || (!!gameOver && !pendingGameOver) || isThinking} 
                                    style={getButtonStyle()}
                                    className="px-3 py-4 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95"
                                >
                                    <UndoIcon className="w-6 h-6" />
                                    <span className="text-xs">Undo</span>
                                </button>
                                <button 
                                    onClick={handleSwitchSide} 
                                    disabled={!!gameOver || isThinking} 
                                    style={getButtonStyle()}
                                    className="px-3 py-4 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95"
                                >
                                    <ArrowPathIcon className="w-4 h-4" />
                                    <span className="text-xs">Switch</span>
                                </button>
                                
                                {/* 第3排：Red Manual/Auto, Black Manual/Auto */}
                                <button 
                                    onClick={() => setRedIsAuto(prev => !prev)} 
                                    disabled={!!gameOver || isThinking} 
                                    style={getButtonStyle(!!gameOver || isThinking)}
                                    className={`px-3 py-4 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 ${
                                        redIsAuto ? 'bg-amber-600/30 border-amber-500 ring-2 ring-amber-500/30' : ''
                                    }`}
                                >
                                    <LightBulbIcon className="w-6 h-6" />
                                    <span className="text-xs text-stone-300">R: {redIsAuto ? "Auto" : "Manual"}</span>
                                </button>
                                <button 
                                    onClick={() => setBlackIsAuto(prev => !prev)}
                                    disabled={!!gameOver || isThinking}
                                    style={getButtonStyle(!!gameOver || isThinking)}
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
                                                        enableTimeLimit: true
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

