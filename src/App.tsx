
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovDQoNCi8vIOaji+ebmOW4uOmHj+WumuS5iQ0KY29uc3QgUk9XUyA9IDEwOw0KY29uc3QgQ09MUyA9IDk7DQoNCi8vIOaji+WtkOexu+Wei+WumuS5iQ0KY29uc3QgUElFQ0VfVFlQRVMgPSB7DQogICAgR0VORVJBTDogJ2dlbmVyYWwnLA0KICAgIENIQVJJT1Q6ICdjaGFyaW90JywNCiAgICBDQU5OT046ICdjYW5ub24nLA0KICAgIEhPUlNFOiAnaG9yc2UnLA0KICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLA0KICAgIEFEVklTT1I6ICdhZHZpc29yJywNCiAgICBTT0xESUVSOiAnc29sZGllcicNCn07DQoNCi8vIOadkOaWmeWAvOadg+mHjemFjee9rg0KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGdlbmVyYWw6IDEwMDAwLCAgLy8g5bCGL+W4hQ0KICAgIGNoYXJpb3Q6IDkwMCwgICAgIC8vIOi9pg0KICAgIGNhbm5vbjogew0KICAgICAgICBlYXJseTogNDUwLCAgICAvLyDlvIDlsYDpmLbmrrUNCiAgICAgICAgbWlkOiA0MDAsICAgICAgLy8g5Lit5bGA6Zi25q61DQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQ0KICAgIH0sICAgICAgICAgICAgICAgIC8vIOeCrg0KICAgIGhvcnNlOiB7DQogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDQ1MCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsDQogICAgZWxlcGhhbnQ6IDIwMCwgICAgLy8g6LGhL+ebuA0KICAgIGFkdmlzb3I6IDIwMCwgICAgIC8vIOWjqy/ku5UNCiAgICBzb2xkaWVyOiB7DQogICAgICAgIGVhcmx5OiAxMDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDIwMCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSAgICAgICAgICAgICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIOaji+WtkOS7t+WAvOadg+mHjemFjee9rg0KbGV0IFZBTFVFX1dFSUdIVFMgPSB7DQogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQ0KICAgIC8vcG9zaXRpb246IDAuMiwgICAvLyDkvY3nva7lgLzmnYPph40NCiAgICAvL3RocmVhdDogMC4xNSwgICAgLy8g5aiB6IOB5YC85p2D6YeNDQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQ0KICAgIC8vc2FmZXR5OiAwLjEsICAgICAvLyDlronlhajlgLzmnYPph40NCiAgICAvL21vYmlsaXR5OiAwLjA1ICAgLy8g5py65Yqo5YC85p2D6YeNDQoNCiAgICBtYXRlcmlhbDogMSwgICAgLy8g5p2Q5paZ5YC85p2D6YeNDQogICAgcG9zaXRpb246IDEsICAgIC8vIOS9jee9ruWAvOadg+mHjQ0KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQ0KICAgIHRhY3RpYzogMSwgICAgICAvLyDmiJjmnK/lgLzmnYPph40NCiAgICBzYWZldHk6IDEsICAgICAgLy8g5a6J5YWo5YC85p2D6YeNDQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQ0KfTsNCg0KLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XDQpjb25zdCBFVkFMVUFUSU9OX1BBUkFNRVRFUlMgPSB7DQogICAgLy8g5py65Yqo5YC85Y+C5pWwDQogICAgbW9iaWxpdHk6IHsNCiAgICAgICAgYmFzZU1vdmVWYWx1ZTogMSwgICAgICAvLyDln7rnoYDnp7vliqjku7flgLwNCiAgICB9LA0KICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQ0KICAgIGNoZWNrOiB7DQogICAgICAgIGJvbnVzOiA4MA0KICAgIH0sDQogICAgLy8g5biu5Yqp5YWz57O75Y+C5pWwDQogICAgYXNzaXN0OiB7DQogICAgICAgIC8vY2Fubm9uU2NyZWVuVmFsdWU6IDQwICAvLyDngq7mnrbku7flgLwNCiAgICAgICAgY2Fubm9uU2NyZWVuVmFsdWU6IDAgIC8vIOeCruaetuS7t+WAvA0KICAgIH0sDQogICAgLy8g6Zi75oyh5YWz57O75Y+C5pWwDQogICAgYmxvY2s6IHsNCiAgICAgICAgLy9lbmVteUNoYXJpb3RCbG9ja1ZhbHVlOiAyMCwgICAgIC8vIOmYu+aMoeWvueaWuei9puS7t+WAvA0KICAgICAgICAvL2VuZW15SG9yc2VCbG9ja1ZhbHVlOiAxNSwgICAgICAgLy8g5Yir5a+55pa56ams6IW/5Lu35YC8DQogICAgICAgIC8vZW5lbXlFbGVwaGFudEJsb2NrVmFsdWU6IDEwLCAgICAvLyDloLXloZ7lr7nmlrnosaHnnLzku7flgLwNCiAgICAgICAgLy9hbGx5Q2hhcmlvdEJsb2NrUGVuYWx0eTogMjAsICAgIC8vIOmYu+aMoeW3seaWuei9puaDqee9mg0KICAgICAgICAvL2FsbHlIb3JzZUJsb2NrUGVuYWx0eTogMTUsICAgICAgLy8g5Yir5bex5pa56ams6IW/5oOp572aDQogICAgICAgIC8vYWxseUVsZXBoYW50QmxvY2tQZW5hbHR5OiAxMCAgICAvLyDloLXloZ7lt7HmlrnosaHnnLzmg6nnvZoNCg0KICAgICAgICBlbmVteUNoYXJpb3RCbG9ja1ZhbHVlOiAwLCAgICAgLy8g6Zi75oyh5a+55pa56L2m5Lu35YC8DQogICAgICAgIGVuZW15SG9yc2VCbG9ja1ZhbHVlOiAwLCAgICAgICAvLyDliKvlr7nmlrnpqazohb/ku7flgLwNCiAgICAgICAgZW5lbXlFbGVwaGFudEJsb2NrVmFsdWU6IDAsICAgIC8vIOWgteWhnuWvueaWueixoeecvOS7t+WAvA0KICAgICAgICBhbGx5Q2hhcmlvdEJsb2NrUGVuYWx0eTogMCwgICAgLy8g6Zi75oyh5bex5pa56L2m5oOp572aDQogICAgICAgIGFsbHlIb3JzZUJsb2NrUGVuYWx0eTogMCwgICAgICAvLyDliKvlt7Hmlrnpqazohb/mg6nnvZoNCiAgICAgICAgYWxseUVsZXBoYW50QmxvY2tQZW5hbHR5OiAwICAgIC8vIOWgteWhnuW3seaWueixoeecvOaDqee9mg0KICAgIH0NCn07DQoNCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rg0KY29uc3QgUE9TSVRJT05fVEFCTEVTID0gew0KICAgIC8vIOWFtS/ljZLkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBzb2xkaWVyOiBbDQogICAgICAgIFswLCA1LCAxMCwgMTUsIDIwLCAxNSwgMTAsIDUsIDBdLA0KICAgICAgICBbNSwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgY2hhcmlvdDogWw0KICAgICAgICBbNSwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDEwLCA1LCAxNSwgMCwgMTUsIDUsIDEwLCAxMF0sDQogICAgICAgIFswLCAxMCwgNSwgNSwgNSwgNSwgMTAsIDUsIDBdDQogICAgXSwNCiAgICAvLyDpqazkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBob3JzZTogWw0KICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgICAgICAgWzAsIDUsIDI1LCAxMCwgMTAsIDEwLCAyNSwgNSwgMF0sDQogICAgICAgIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sDQogICAgICAgIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMjUsIDIwLCAwLCAyMCwgMjUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgICAgICAgWzUsIDAsIDUsIDUsIDAsIDUsIDUsIDAsIDVdLA0KICAgICAgICBbMCwgMCwgMCwgNSwgLTIwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDngq7kvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBjYW5ub246IFsNCiAgICAgICAgWzEwLCAyMCwgMTUsIDEwLCAwLCAxMCwgMTUsIDIwLCAxMF0sDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLA0KICAgICAgICBbNSwgNSwgMTUsIDUsIDI1LCA1LCAxNSwgNSwgNV0sDQogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLA0KICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogICAgICAgIFsxMCwgMTAsIDE1LCAyMCwgMzAsIDIwLCAxNSwgMTAsIDEwXSwgDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBlbGVwaGFudDogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g5aOr5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgYWR2aXNvcjogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCA1LCAwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDEwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0NCiAgICBdDQp9Ow0KDQovLyDojrflj5bmo4vlrZDnmoTmnZDmlpnlgLwNCmNvbnN0IGdldE1hdGVyaWFsVmFsdWUgPSAocGllY2UsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOw0KICAgIA0KICAgIC8vIOmSiOWvueacieWIhumYtuauteadkOaWmeWAvOeahOWFteenje+8iOWFteOAgeeCruOAgemprO+8ieiwg+aVtOadkOaWmeWAvA0KICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7DQogICAgICAgIHZhbHVlID0gdmFsdWVbZ2FtZVN0YWdlXSB8fCB2YWx1ZS5taWQ7DQogICAgfQ0KICAgIA0KICAgIHJldHVybiB2YWx1ZTsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOS9jee9ruWAvA0KY29uc3QgZ2V0UG9zaXRpb25WYWx1ZSA9IChwaWVjZSwgciwgYykgPT4gew0KICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOw0KICAgIGlmICghdGFibGUpIHJldHVybiAwOw0KICAgIA0KICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqA0KICAgIGNvbnN0IHJvd0lkeCA9IHBpZWNlLmNvbG9yID09PSAncmVkJyA/ICg5LSByKSA6IHI7DQogICAgcmV0dXJuIHRhYmxlW3Jvd0lkeF1bY10gfHwgMDsNCn07DQoNCi8vIOS4u+ivhOS8sOWHveaVsCAtIOivpue7huivhOS8sOaji+ebmOWxgOWKvw0KY29uc3QgZXZhbHVhdGVCb2FyZCA9IChib2FyZCwgaXNSZXBsYXkgPSBmYWxzZSwgY3VycmVudFBsYXllciA9IG51bGwsIGRlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcpID0+IHsNCiAgICAvLyDnu5/orqENCiAgICBpZiAoY3VycmVudFBsYXllcikgew0KICAgICAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQogICAgfQ0KICAgIA0KICAgIC8vIOesrOS4gOatpe+8muiOt+WPluW9k+WJjea4uOaIj+mYtuautQ0KICAgIC8vY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoYm9hcmQpOw0KICAgIC8vIOWwhua4uOaIj+mYtuautei9rOaNouS4uuadkOaWmeWAvOiuoeeul+aJgOmcgOeahOagvOW8jw0KICAgIC8vY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQogICAgLy8g5bCG5ri45oiP6Zi25q616L2s5o2i5Li66L6T5Ye65qC85byPDQogICAgLy9jb25zdCBvdXRwdXRQaGFzZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgIGNvbnN0IG91dHB1dFBoYXNlID0gZ2FtZVN0YWdlOw0KDQogICAgLy8g56ys5LqM5q2l77ya6YGN5Y6G5LiA5qyh5qOL55uY77yM5pS26ZuG5omA5pyJ5qOL5a2Q5L+h5oGv5bm26K6h566X5Z+656GA5YiG5pWwDQogICAgbGV0IHBpZWNlc0luZm8gPSBbXTsNCiAgICBsZXQgcmVkTWF0ZXJpYWwgPSAwLCByZWRQb3NpdGlvbiA9IDA7DQogICAgbGV0IGJsYWNrTWF0ZXJpYWwgPSAwLCBibGFja1Bvc2l0aW9uID0gMDsNCiAgICANCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmlLbpm4bmo4vlrZDln7rmnKzkv6Hmga8NCiAgICAgICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25WYWx1ZSA9IGdldFBvc2l0aW9uVmFsdWUocGllY2UsIHIsIGMpOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCB7IHIsIGMgfSwgcGllY2UpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDnq4vljbPlpITnkIZtb3Zlc++8jOiuoeeul+acuuWKqOaAp++8iOWwhnByb2Nlc3NQaWVjZU1vdmVz6YC76L6R5YaF6IGU5q2k5aSE77yJDQogICAgICAgICAgICBjb25zdCB7IGJhc2VNb3ZlVmFsdWUgfSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eTsNCiAgICAgICAgICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsNCiAgICAgICAgICAgIGZvciAoY29uc3QgbW92ZSBvZiBtb3Zlcykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW21vdmUucl1bbW92ZS5jXTsNCiAgICAgICAgICAgICAgICBpZiAoIXRhcmdldCkgew0KICAgICAgICAgICAgICAgICAgICAvLyDnm67moIfkvY3nva7kuLrnqbrvvIzorqHnrpfmnLrliqjmgKcNCiAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g56uL5Y2z57Sv5Yqg5Z+656GA5YiG5pWw77yM6YG/5YWN5ZCO57ut5YaN5qyh6YGN5Y6GDQogICAgICAgICAgICBpZiAocGllY2UuY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICAgICAgcmVkTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgICAgICByZWRQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBibGFja01hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICAgICAgYmxhY2tQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICBwaWVjZXNJbmZvLnB1c2goew0KICAgICAgICAgICAgICAgIHBpZWNlLA0KICAgICAgICAgICAgICAgIHIsDQogICAgICAgICAgICAgICAgYywNCiAgICAgICAgICAgICAgICBtb3ZlcywNCiAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlLA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uVmFsdWUsDQogICAgICAgICAgICAgICAgLy8g5Yid5aeL5YyW5bm26K6+572u6K6h566X5aW955qE5py65Yqo5YC8DQogICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDAsDQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogbW9iaWxpdHlWYWx1ZSwNCiAgICAgICAgICAgICAgICAvLyDmt7vliqDlqIHog4HogIXlkozkv53miqTogIXmlbDnu4QNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLCAgICAvLyDlqIHog4HlvZPliY3mo4vlrZDnmoTmlYzmlrnmo4vlrZDliJfooagNCiAgICAgICAgICAgICAgICBwcm90ZWN0OiBbXSAgLy8g5L+d5oqk5b2T5YmN5qOL5a2Q55qE5bex5pa55qOL5a2Q5YiX6KGoDQogICAgICAgICAgICB9KTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDnrKzkuozmraXvvJrln7rkuo7mlLbpm4bnmoTmo4vlrZDkv6Hmga/orqHnrpflhbbku5blgLzvvIzkvKDpgJJnYW1lU3RhZ2Xpgb/lhY3ph43lpI3orqHnrpcNCiAgICAvLyDliJvlu7pib2FyZEluZm/lubbkvKDpgJLnu5ljYWxjdWxhdGVEZXJpdmVkVmFsdWVzDQogICAgY29uc3QgYm9hcmRJbmZvID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7DQogICAgY2FsY3VsYXRlRGVyaXZlZFZhbHVlcyhib2FyZCwgcGllY2VzSW5mbywgY3VycmVudFBsYXllciwgZGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBib2FyZEluZm8pOw0KICAgIA0KICAgIC8vIOesrOS4ieatpe+8muiuoeeul+aAu+WIhu+8iOWPquiuoeeul+WJqeS9meWIhuaVsO+8jOWfuuehgOWIhuaVsOW3suWcqOaji+ebmOmBjeWOhuaXtuiuoeeul++8iQ0KICAgIGxldCByZWRUaHJlYXQgPSAwLCByZWRUYWN0aWMgPSAwLCByZWRTYWZldHkgPSAwLCByZWRNb2JpbGl0eSA9IDA7DQogICAgbGV0IGJsYWNrVGhyZWF0ID0gMCwgYmxhY2tUYWN0aWMgPSAwLCBibGFja1NhZmV0eSA9IDAsIGJsYWNrTW9iaWxpdHkgPSAwOw0KICAgIA0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGNvbnN0IHsgcGllY2UsIHRocmVhdFZhbHVlLCB0YWN0aWNWYWx1ZSwgc2FmZXR5VmFsdWUsIG1vYmlsaXR5VmFsdWUgfSA9IGluZm87DQogICAgICAgIA0KICAgICAgICBpZiAocGllY2UuY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICByZWRUaHJlYXQgKz0gdGhyZWF0VmFsdWU7DQogICAgICAgICAgICByZWRUYWN0aWMgKz0gdGFjdGljVmFsdWU7DQogICAgICAgICAgICByZWRTYWZldHkgKz0gc2FmZXR5VmFsdWU7DQogICAgICAgICAgICByZWRNb2JpbGl0eSArPSBtb2JpbGl0eVZhbHVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgYmxhY2tUaHJlYXQgKz0gdGhyZWF0VmFsdWU7DQogICAgICAgICAgICBibGFja1RhY3RpYyArPSB0YWN0aWNWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrU2FmZXR5ICs9IHNhZmV0eVZhbHVlOw0KICAgICAgICAgICAgYmxhY2tNb2JpbGl0eSArPSBtb2JpbGl0eVZhbHVlOw0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIOiuoeeul+WxgOWKv+aAu+WIhg0KICAgIGNvbnN0IHJlZFRvdGFsID0gDQogICAgICAgIHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArDQogICAgICAgIHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArDQogICAgICAgIHJlZFRocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsNCiAgICAgICAgcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKw0KICAgICAgICByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArDQogICAgICAgIHJlZE1vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsgDQogICAgDQogICAgY29uc3QgYmxhY2tUb3RhbCA9IA0KICAgICAgICBibGFja01hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArDQogICAgICAgIGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsNCiAgICAgICAgYmxhY2tUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArDQogICAgICAgIGJsYWNrVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKw0KICAgICAgICBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsNCiAgICAgICAgYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7DQogICAgDQogICAgLy8g6L+U5Zue6K+m57uG6K+E5Lyw57uT5p6cDQogICAgcmV0dXJuIHsNCiAgICAgICAgcmVkOiB7DQogICAgICAgICAgICB0b3RhbDogcmVkVG90YWwsDQogICAgICAgICAgICBtYXRlcmlhbDogcmVkTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsLA0KICAgICAgICAgICAgcG9zaXRpb246IHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgIHRocmVhdDogcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICB0YWN0aWM6IHJlZFRhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljLA0KICAgICAgICAgICAgc2FmZXR5OiByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgIG1vYmlsaXR5OiByZWRNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksDQogICAgICAgICAgICBwaGFzZTogb3V0cHV0UGhhc2UsDQogICAgICAgICAgICB3ZWlnaHRzOiB7DQogICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAuNCwNCiAgICAgICAgICAgICAgICBwb3NpdGlvbjogMC4yLA0KICAgICAgICAgICAgICAgIHRhY3RpYzogMC4xLA0KICAgICAgICAgICAgICAgIHNhZmV0eTogMC4xLA0KICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLjA1LA0KICAgICAgICAgICAgICAgIHRocmVhdDogMC4xNQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9LA0KICAgICAgICBibGFjazogew0KICAgICAgICAgICAgdG90YWw6IGJsYWNrVG90YWwsDQogICAgICAgICAgICBtYXRlcmlhbDogYmxhY2tNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICBwb3NpdGlvbjogYmxhY2tQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sDQogICAgICAgICAgICB0aHJlYXQ6IGJsYWNrVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICB0YWN0aWM6IGJsYWNrVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMsDQogICAgICAgICAgICBzYWZldHk6IGJsYWNrU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHksDQogICAgICAgICAgICBtb2JpbGl0eTogYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksDQogICAgICAgICAgICBwaGFzZTogb3V0cHV0UGhhc2UsDQogICAgICAgICAgICB3ZWlnaHRzOiB7DQogICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAuNCwNCiAgICAgICAgICAgICAgICBwb3NpdGlvbjogMC4yLA0KICAgICAgICAgICAgICAgIHRhY3RpYzogMC4xLA0KICAgICAgICAgICAgICAgIHNhZmV0eTogMC4xLA0KICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLjA1LA0KICAgICAgICAgICAgICAgIHRocmVhdDogMC4xNQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9LA0KICAgICAgICBwaWVjZXNJbmZvOiBwaWVjZXNJbmZvLA0KICAgICAgICBnYW1lU3RhZ2U6IGdhbWVTdGFnZSwNCiAgICAgICAgYm9hcmRJbmZvOiBib2FyZEluZm8NCiAgICB9Ow0KfTsNCg0KLy8g6L276YeP57qn5pCc57Si5L+h5oGv5YeG5aSH5Ye95pWw77ya5Y+q6K6h566X5pCc57Si6ZyA6KaB55qE5Z+65pys5L+h5oGvDQovLyDkuI3orqHnrpflrozmlbTnmoTlqIHog4HlgLzlkozlronlhajlgLzvvIzlj6rorqHnrpfmo4vlrZDlhbPns7vlkozmuLjmiI/nirbmgIENCmNvbnN0IHByZXBhcmVTZWFyY2hJbmZvID0gKGJvYXJkLCBjdXJyZW50UGxheWVyLCBnYW1lU3RhZ2UpID0+IHsNCiAgICAvLyDnu5/orqENCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudFtjdXJyZW50UGxheWVyXSsrOw0KICAgIA0KICAgIC8vIOaUtumbhuaji+WtkOWfuuacrOS/oeaBrw0KICAgIGxldCBwaWVjZXNJbmZvID0gW107DQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAoIXBpZWNlKSBjb250aW51ZTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvblZhbHVlID0gZ2V0UG9zaXRpb25WYWx1ZShwaWVjZSwgciwgYyk7DQogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOiuoeeul+acuuWKqOaApw0KICAgICAgICAgICAgY29uc3QgeyBiYXNlTW92ZVZhbHVlIH0gPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHk7DQogICAgICAgICAgICBsZXQgbW9iaWxpdHlWYWx1ZSA9IDA7DQogICAgICAgICAgICBmb3IgKGNvbnN0IG1vdmUgb2YgbW92ZXMpIHsNCiAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFttb3ZlLnJdW21vdmUuY107DQogICAgICAgICAgICAgICAgaWYgKCF0YXJnZXQpIHsNCiAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgcGllY2VzSW5mby5wdXNoKHsNCiAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICByLCBjLCBtb3ZlcywNCiAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlLA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uVmFsdWUsDQogICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDAsDQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogbW9iaWxpdHlWYWx1ZSwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLA0KICAgICAgICAgICAgICAgIHByb3RlY3Q6IFtdDQogICAgICAgICAgICB9KTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDliJ3lp4vljJZib2FyZEluZm8NCiAgICBjb25zdCBib2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCiAgICANCiAgICAvLyDorqHnrpfmo4vlrZDlhbPns7sNCiAgICBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyhib2FyZCwgcGllY2VzSW5mbywgYm9hcmRJbmZvKTsNCiAgICANCiAgICAvLyDorqHnrpfmuLjmiI/nirbmgIENCiAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoaW5mby5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgaWYgKGdldFZhbGlkTW92ZXMoYm9hcmQsIHsgcjogaW5mby5yLCBjOiBpbmZvLmMgfSkubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICBsZXQgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdwbGF5aW5nJyB9Ow0KICAgIGlmICghaGFzTW92ZXMpIHsNCiAgICAgICAgY29uc3QgaW5DaGVjayA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZElzSW5DaGVjayA6IGJvYXJkSW5mby5ibGFja0lzSW5DaGVjazsNCiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgDQogICAgICAgIGlmIChpbkNoZWNrKSB7DQogICAgICAgICAgICBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIGJvYXJkSW5mby5nYW1lU3RhdGUgPSBnYW1lU3RhdGU7DQogICAgDQogICAgcmV0dXJuIHsgcGllY2VzSW5mbywgYm9hcmRJbmZvIH07DQp9Ow0KDQovLyDorqHnrpfooY3nlJ/lgLzvvJrlqIHog4HlgLzjgIHlronlhajlgLzjgIHmiJjmnK/lgLzjgIHmnLrliqjlgLwNCi8vIOS/ruaUue+8mua3u+WKoHNlYXJjaEluaXRpYXRvcuWPguaVsO+8jOS8oOmAkue7mWNhbGN1bGF0ZVRocmVhdFZhbHVlcw0KLy8g5re75YqgZ2FtZVN0YWdl5Y+C5pWw77yM6YG/5YWN5Zyo5b6q546v5Lit6YeN5aSN6LCD55SoZ2V0R2FtZVBoYXNlDQpjb25zdCBjYWxjdWxhdGVEZXJpdmVkVmFsdWVzID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyID0gbnVsbCwgZGVwdGggPSAwLCBzZWFyY2hJbml0aWF0b3IgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJywgYm9hcmRJbmZvID0gbnVsbCkgPT4gew0KICAgIC8vIOmHjee9ruaJgOacieihjeeUn+WAvO+8jOmZpOS6huacuuWKqOWAvO+8iOW3suWcqOaUtumbhuaji+WtkOS/oeaBr+aXtuiuoeeul++8iQ0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGluZm8udGhyZWF0VmFsdWUgPSAwOw0KICAgICAgICBpbmZvLnNhZmV0eVZhbHVlID0gMDsNCiAgICAgICAgaW5mby50YWN0aWNWYWx1ZSA9IDA7DQogICAgICAgIC8vIOS/neeVmeacuuWKqOWAvO+8jOWboOS4uuW3suWcqOaUtumbhuaji+WtkOS/oeaBr+aXtuiuoeeulw0KICAgIH0NCiAgICANCiAgICAvLyAxLiDorqHnrpfmo4vlrZDlhbPns7vvvIjlqIHog4HogIXjgIHooqvlqIHog4HogIXjgIHkv53miqTogIXjgIHooqvkv53miqTogIXvvIkNCiAgICBpZiAoIWJvYXJkSW5mbykgew0KICAgICAgICBib2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCiAgICB9DQogICAgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMoYm9hcmQsIHBpZWNlc0luZm8sIGJvYXJkSW5mbyk7DQogICAgDQogICAgLy8gMi4g6K6h566X5aiB6IOB5YC877yI5Z+65LqO5a6M5pW055qE5aiB6IOB5YWz57O777yJ77yM5Lyg6YCSZ2FtZVN0YWdl5ZKMYm9hcmRJbmZvDQogICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzKGJvYXJkLCBwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyLCBkZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGJvYXJkSW5mbyk7DQogICAgDQogICAgLy8gMy4g6K6h566X5oiY5pyv5YC855qE5YW25LuW6YOo5YiG77yI5biu5Yqp5YWz57O75ZKM6Zi75oyh5YWz57O777yJDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgLy9pbmZvLnRhY3RpY1ZhbHVlICs9IGNhbGN1bGF0ZUFzc2lzdFZhbHVlKHBpZWNlc0luZm8sIGluZm8pOw0KICAgICAgICAvL2luZm8udGFjdGljVmFsdWUgKz0gY2FsY3VsYXRlQmxvY2tWYWx1ZShib2FyZCwgcGllY2VzSW5mbywgaW5mbyk7DQogICAgfQ0KICAgIA0KICAgIC8vIDQuIOacgOWQjuiuoeeul+WuieWFqOWAvO+8jOS8oOmAkmJvYXJkSW5mb+S9nOS4uuWPguaVsA0KICAgIGNhbGN1bGF0ZVNhZmV0eVZhbHVlcyhwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgIA0KICAgIC8vIDUuIOiuoeeul+a4uOaIj+eKtuaAgeW5tuS/neWtmOWIsGJvYXJkSW5mbw0KICAgIGlmIChjdXJyZW50UGxheWVyKSB7DQogICAgICAgIC8vIOajgOafpeW9k+WJjeeOqeWutuaYr+WQpuacieWQiOazlei1sOazlQ0KICAgICAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsNCiAgICAgICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5qOL5a2Q55qE5pyJ5pWI6LWw5rOVDQogICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHI6IGluZm8uciwgYzogaW5mby5jIH0pOw0KICAgICAgICAgICAgICAgIGlmIChtb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDliKTmlq3muLjmiI/nirbmgIENCiAgICAgICAgbGV0IGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAncGxheWluZycgfTsNCiAgICAgICAgaWYgKCFoYXNNb3Zlcykgew0KICAgICAgICAgICAgLy8g5rKh5pyJ5ZCI5rOV6LWw5rOV77yM5qOA5p+l5piv5ZCm6KKr5bCG5YabDQogICAgICAgICAgICBjb25zdCBpbkNoZWNrID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkSXNJbkNoZWNrIDogYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrOw0KICAgICAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKGluQ2hlY2spIHsNCiAgICAgICAgICAgICAgICBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIOS/neWtmOa4uOaIj+eKtuaAgeWIsGJvYXJkSW5mbw0KICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0gZ2FtZVN0YXRlOw0KICAgIH0NCn07DQoNCi8vIOiuoeeul+aji+WtkOWFs+ezu++8iOWogeiDgeiAheOAgeiiq+WogeiDgeiAheOAgeS/neaKpOiAheOAgeiiq+S/neaKpOiAhe+8iQ0KLy8g5ZCM5pe26K6h566XYm9hcmRJbmZv77ya5Li65qOL55uY5q+P5Liq5L2N572u55m76K6w5o6n5Yi26ICFDQpjb25zdCBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyA9IChib2FyZCwgcGllY2VzSW5mbywgYm9hcmRJbmZvKSA9PiB7DQogICAgLy8g5Yid5aeL5YyW5qOL5a2Q5YWz57O75pWw57uEDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaW5mby50aHJlYXQgPSBbXTsgICAgICAgICAgIC8vIOajgOafpei/meS4quaji+WtkOWPr+S7peWogeiDgeWTquS6m+aji+WtkA0KICAgICAgICBpbmZvLnRocmVhdGVuZWRCeSA9IFtdOyAgICAgLy8g5qOA5p+l6L+Z5Liq5qOL5a2Q6KKr5ZOq5Lqb5qOL5a2Q5aiB6IOBDQogICAgICAgIGluZm8uZ3VhcmQgPSBbXTsgICAgICAgLy8g5qOA5p+l6L+Z5Liq5qOL5a2Q5Y+v5Lul5L+d5oqk5ZOq5Lqb5qOL5a2QDQogICAgICAgIGluZm8uZ3VhcmRlZEJ5ID0gW107ICAgICAgLy8g5qOA5p+l6L+Z5Liq5qOL5a2Q6KKr5ZOq5Lqb5qOL5a2Q5L+d5oqkDQogICAgICAgIGluZm8uY29udHJvbCA9IFtdOyAgICAgIC8vIOajgOafpei/meS4quaji+WtkOWPr+S7peaOp+WItueahOWTquS6m+S9jee9rg0KICAgIH0NCiAgICANCiAgICAvLyDlpoLmnpxib2FyZEluZm/kuLrnqbrvvIzliJnliJ3lp4vljJYNCiAgICBpZiAoIWJvYXJkSW5mbykgew0KICAgICAgICBib2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCiAgICB9DQogICAgDQogICAgLy8g5aSE55CG5q+P5Liq5qOL5a2Q55qE5aiB6IOB5ZKM5L+d5oqk5YWz57O7DQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgLy8g6I635Y+W5qOL5a2Q55qE5aiB6IOB55uu5qCH5ZKM5L+d5oqk55uu5qCHDQogICAgICAgIGNvbnN0IHsgdGhyZWF0LCBndWFyZCB9ID0gZ2V0UGllY2VUYXJnZXRzKGJvYXJkLCB7IHI6IGluZm8uciwgYzogaW5mby5jIH0sIGluZm8ucGllY2UpOw0KICAgICAgICANCiAgICAgICAgLy8g5aSE55CG5aiB6IOB55uu5qCH77yM5ZCM5pe26K6w5b2V5Y+M5ZCR5aiB6IOB5YWz57O7DQogICAgICAgIGZvciAoY29uc3QgdGhyZWF0UG9zIG9mIHRocmVhdCkgew0KICAgICAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gdGhyZWF0UG9zLnIgJiYgcC5jID09PSB0aHJlYXRQb3MuYyk7DQogICAgICAgICAgICBpZiAodGFyZ2V0SW5mbykgew0KICAgICAgICAgICAgICAgIC8vIOiusOW9leWogeiDgeWFs+ezu++8mmluZm/lqIHog4F0YXJnZXRJbmZvDQogICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAvLyDlkIzml7borrDlvZXlj43lkJHlhbPns7vvvJp0YXJnZXRJbmZv6KKraW5mb+WogeiDgQ0KICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIOWkhOeQhuS/neaKpOebruagh++8jOWQjOaXtuiusOW9leWPjOWQkeS/neaKpOWFs+ezuw0KICAgICAgICBmb3IgKGNvbnN0IGd1YXJkUG9zIG9mIGd1YXJkKSB7DQogICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSBndWFyZFBvcy5yICYmIHAuYyA9PT0gZ3VhcmRQb3MuYyk7DQogICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICAgICAgLy8g6K6w5b2V5L+d5oqk5YWz57O777yaaW5mb+S/neaKpHRhcmdldEluZm8NCiAgICAgICAgICAgICAgICBpbmZvLmd1YXJkLnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgLy8g5ZCM5pe26K6w5b2V5Y+N5ZCR5YWz57O777yadGFyZ2V0SW5mb+iiq2luZm/kv53miqQNCiAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLmd1YXJkZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDorqHnrpflubborrDlvZXmo4vlrZDnmoTmjqfliLbngrkNCiAgICAgICAgY29uc3QgY29udHJvbCA9IGdldFBpZWNlQ29udHJvbChib2FyZCwgeyByOiBpbmZvLnIsIGM6IGluZm8uYyB9LCBpbmZvLnBpZWNlKTsNCiAgICAgICAgaW5mby5jb250cm9sID0gY29udHJvbDsNCiAgICAgICAgDQogICAgICAgIC8vIOabtOaWsGJvYXJkSW5mb++8muWwhuW9k+WJjeaji+WtkOeahOWujOaVtOS/oeaBr+a3u+WKoOWIsOWFtuaOp+WItueCueeahOaOp+WItuiAheWIl+ihqOS4rQ0KICAgICAgICBjb250cm9sLmZvckVhY2gocG9zID0+IHsNCiAgICAgICAgICAgIC8vIOWtmOWCqOWujOaVtOeahOaOp+WItuiAheS/oeaBr++8muS9jee9ruOAgeminOiJsuWSjOaji+WtkOexu+Weiw0KICAgICAgICAgICAgYm9hcmRJbmZvW3Bvcy5yXVtwb3MuY10ucHVzaCh7DQogICAgICAgICAgICAgICAgcjogaW5mby5yLA0KICAgICAgICAgICAgICAgIGM6IGluZm8uYywNCiAgICAgICAgICAgICAgICBjb2xvcjogaW5mby5waWVjZS5jb2xvciwNCiAgICAgICAgICAgICAgICB0eXBlOiBpbmZvLnBpZWNlLnR5cGUNCiAgICAgICAgICAgIH0pOw0KICAgICAgICB9KTsNCiAgICB9DQogICAgDQogICAgLy8g6aKE6K6h566X5bCG5Yab54q25oCBDQogICAgbGV0IHJlZElzSW5DaGVjayA9IGZhbHNlOw0KICAgIGxldCBibGFja0lzSW5DaGVjayA9IGZhbHNlOw0KICAgIA0KICAgIC8vIOafpeaJvuWwhi/luIXkvY3nva4NCiAgICBsZXQgcmVkR2VuZXJhbEluZm8gPSBudWxsOw0KICAgIGxldCBibGFja0dlbmVyYWxJbmZvID0gbnVsbDsNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoaW5mby5waWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgIHJlZEdlbmVyYWxJbmZvID0gaW5mbzsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgYmxhY2tHZW5lcmFsSW5mbyA9IGluZm87DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g5qOA5p+l57qi5bCG5piv5ZCm6KKr5bCG5YabDQogICAgaWYgKHJlZEdlbmVyYWxJbmZvKSB7DQogICAgICAgIC8vIOajgOafpeaVjOaWueaji+WtkOaYr+WQpuebtOaOpeWogeiDgee6ouWwhg0KICAgICAgICBmb3IgKGNvbnN0IHRocmVhdGVuZXIgb2YgcmVkR2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7DQogICAgICAgICAgICBpZiAodGhyZWF0ZW5lci5waWVjZS5jb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgIHJlZElzSW5DaGVjayA9IHRydWU7DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g5qOA5p+l6buR5bCG5piv5ZCm6KKr5bCG5YabDQogICAgaWYgKGJsYWNrR2VuZXJhbEluZm8pIHsNCiAgICAgICAgLy8g5qOA5p+l5pWM5pa55qOL5a2Q5piv5ZCm55u05o6l5aiB6IOB6buR5bCGDQogICAgICAgIGZvciAoY29uc3QgdGhyZWF0ZW5lciBvZiBibGFja0dlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgew0KICAgICAgICAgICAgaWYgKHRocmVhdGVuZXIucGllY2UuY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIOajgOafpemjnuWwhuaDheWGtQ0KICAgIGlmIChyZWRHZW5lcmFsSW5mbyAmJiBibGFja0dlbmVyYWxJbmZvKSB7DQogICAgICAgIC8vIOWwhi/luIXmmK/lkKblnKjlkIzkuIDliJcNCiAgICAgICAgaWYgKHJlZEdlbmVyYWxJbmZvLmMgPT09IGJsYWNrR2VuZXJhbEluZm8uYykgew0KICAgICAgICAgICAgLy8g5qOA5p+l5Lit6Ze05piv5ZCm5pyJ5YW25LuW5qOL5a2QDQogICAgICAgICAgICBsZXQgaGFzUGllY2VCZXR3ZWVuID0gZmFsc2U7DQogICAgICAgICAgICBjb25zdCBzdGFydFIgPSBNYXRoLm1pbihyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpICsgMTsNCiAgICAgICAgICAgIGNvbnN0IGVuZFIgPSBNYXRoLm1heChyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpIC0gMTsNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSBzdGFydFI7IHIgPD0gZW5kUjsgcisrKSB7DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW3JdW3JlZEdlbmVyYWxJbmZvLmNdKSB7DQogICAgICAgICAgICAgICAgICAgIGhhc1BpZWNlQmV0d2VlbiA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFoYXNQaWVjZUJldHdlZW4pIHsNCiAgICAgICAgICAgICAgICAvLyDpo57lsIbmg4XlhrXvvIznuqLmlrnlkozpu5Hmlrnpg73ooqvlsIblhpsNCiAgICAgICAgICAgICAgICByZWRJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICAgICAgICAgIGJsYWNrSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDlsIblsIblhpvnirbmgIHlrZjlgqjliLBib2FyZEluZm/kuK0NCiAgICBib2FyZEluZm8ucmVkSXNJbkNoZWNrID0gcmVkSXNJbkNoZWNrOw0KICAgIGJvYXJkSW5mby5ibGFja0lzSW5DaGVjayA9IGJsYWNrSXNJbkNoZWNrOw0KICAgIA0KICAgIC8vIOWwhuWwhuWGm+eKtuaAgeS5n+WtmOWCqOWIsOavj+S4quaji+WtkOS/oeaBr+S4re+8jOS+m+WQjue7rUFJ5pCc57Si5L2/55SoDQogICAgcGllY2VzSW5mby5mb3JFYWNoKGluZm8gPT4gew0KICAgICAgICBpbmZvLmJvYXJkSW5mbyA9IGJvYXJkSW5mbzsNCiAgICAgICAgLy8g5a2Y5YKo5bCG5Yab54q25oCB5YiwcGllY2VzSW5mb+S4re+8jOaWueS+v+iuv+mXrg0KICAgICAgICBpbmZvLnJlZElzSW5DaGVjayA9IHJlZElzSW5DaGVjazsNCiAgICAgICAgaW5mby5ibGFja0lzSW5DaGVjayA9IGJsYWNrSXNJbkNoZWNrOw0KICAgIH0pOw0KfTsNCg0KLy8g552A5rOV5o6S5bqP5Ye95pWw77ya5qC55o2u5LyY5YWI57qn5o6S5bqP552A5rOVDQovLyDooqvlsIbml7bvvJrlkIPlsIblrZAgPiDlj43lsIYgPiDlhbblroPlkIPlrZAgPiDotbDlsIbpgIPpgLggPiDlnqvlsIYv5YW25L2ZDQovLyDmnKrooqvlsIbml7bvvJoNCi8vIDEuIOS8mOWFiOWkhOeQhuaIkeaWueaXoOS/neaKpOeahOiiq+WNleWQkeWogeiDgeeahOaji+WtkOaJp+ihjOmAg+i3keedgOazle+8jOWmguacieWkmuS4quaji+WtkOaMieadkOaWmeWAvOS7jumrmOWIsOS9juaOkuW6jw0KLy8gMi4g5YW25qyh5aSE55CG5oiR5pa55Y2V5ZCR5aiB6IOB5a+55pa55peg5L+d5oqk5qOL5a2Q55qE5qOL5a2Q5omn6KGM5ZCD5a2Q552A5rOV77yM5aaC5pyJ5aSa5Liq5qOL5a2Q5oyJ5qOL5a2Q5p2Q5paZ5YC85LuO6auY5Yiw5L2O5o6S5bqPDQovLyAzLiDmnIDlkI7lpITnkIbkuI3mtonlj4rlkIPlkozooqvlkIPnmoTnnYDms5XvvIzopoHmsYLpgb/lhY3np7vliqjliLDooqvlkIPnmoTkvY3nva4NCmNvbnN0IHNvcnRNb3ZlcyA9IChtb3ZlcywgYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIHBpZWNlc0luZm8sIGdhbWVTdGFnZSA9ICdtaWQnLCBib2FyZEluZm8gPSBudWxsKSA9PiB7DQogICAgLy8g5L2/55So5Lyg5YWl55qEZ2FtZVN0YWdl5Y+C5pWw77yM6YG/5YWN6YeN5aSN6LCD55SoZ2V0R2FtZVBoYXNlDQogICAgDQogICAgLy8g55So6aKE6K6h566X55qE6KKr5bCG54q25oCB77yI5LiN6IO955SoIGJvYXJkSW5mby5jaGVja3PvvJrpgqPmmK/igJzosIHlnKjlsIblhpvigJ3vvIzkuI3mmK/igJzosIHooqvlsIbigJ3vvIkNCiAgICBjb25zdCBjdXJyZW50SXNJbkNoZWNrID0gYm9hcmRJbmZvDQogICAgICAgID8gKChjdXJyZW50UGxheWVyID09PSAncmVkJyAmJiBib2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fA0KICAgICAgICAgICAoY3VycmVudFBsYXllciA9PT0gJ2JsYWNrJyAmJiBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2spKQ0KICAgICAgICA6IGlzQ2hlY2soYm9hcmQsIGN1cnJlbnRQbGF5ZXIpOw0KDQogICAgLy8g6KKr5bCG5pe25pS26ZuG5q2j5Zyo5bCG5Yab55qE5pWM5pa55qOL5a2Q5L2N572u77yM55So5LqO5LyY5YWI5ZCD5bCG5a2QDQogICAgbGV0IGNoZWNrZXJLZXlzID0gbnVsbDsNCiAgICBpZiAoY3VycmVudElzSW5DaGVjayAmJiBwaWVjZXNJbmZvICYmIHBpZWNlc0luZm8ubGVuZ3RoID4gMCkgew0KICAgICAgICBjb25zdCBnZW5lcmFsSW5mbyA9IHBpZWNlc0luZm8uZmluZCgNCiAgICAgICAgICAgIHAgPT4gcC5waWVjZSAmJiBwLnBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBwLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyDQogICAgICAgICk7DQogICAgICAgIGlmIChnZW5lcmFsSW5mbyAmJiBnZW5lcmFsSW5mby50aHJlYXRlbmVkQnkpIHsNCiAgICAgICAgICAgIGNoZWNrZXJLZXlzID0gbmV3IFNldCgNCiAgICAgICAgICAgICAgICBnZW5lcmFsSW5mby50aHJlYXRlbmVkQnkNCiAgICAgICAgICAgICAgICAgICAgLmZpbHRlcih0ID0+IHQucGllY2UgJiYgdC5waWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikNCiAgICAgICAgICAgICAgICAgICAgLm1hcCh0ID0+IGAke3Qucn0sJHt0LmN9YCkNCiAgICAgICAgICAgICk7DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g5Li65q+P5Liq552A5rOV6K6h566X5LyY5YWI57qn5YiG5pWw5bm25L+d5a2Y5Y6f5aeL57Si5byVDQogICAgbW92ZXMuZm9yRWFjaCgobW92ZSwgaW5kZXgpID0+IHsNCiAgICAgICAgY29uc3QgeyBmcm9tLCB0byB9ID0gbW92ZTsNCiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtmcm9tLnJdW2Zyb20uY107DQogICAgICAgIGNvbnN0IHBpZWNlVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOw0KDQogICAgICAgIGNvbnN0IHRhcmdldFBpZWNlID0gYm9hcmRbdG8ucl1bdG8uY107DQogICAgICAgIGNvbnN0IHRhcmdldFBpZWNlVmFsdWUgPSB0YXJnZXRQaWVjZSA/IGdldE1hdGVyaWFsVmFsdWUodGFyZ2V0UGllY2UsIGdhbWVTdGFnZSkgOiAwOw0KICAgICAgICANCiAgICAgICAgbGV0IHByaW9yaXR5ID0gNDsNCiAgICAgICAgbGV0IHNjb3JlID0gMDsNCiAgICAgICAgDQogICAgICAgIC8vIOiiq+Wwhu+8muWQiOazleedgOazleWdh+W3suino+mZpOWwhuWGm++8jOaMieW6lOWwhuaJi+auteaOkuW6jw0KICAgICAgICBpZiAoY3VycmVudElzSW5DaGVjaykgew0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZXNDaGVja2VyID0gdGFyZ2V0UGllY2UgJiYgY2hlY2tlcktleXMgJiYgY2hlY2tlcktleXMuaGFzKGAke3RvLnJ9LCR7dG8uY31gKTsNCiAgICAgICAgICAgIGlmIChjYXB0dXJlc0NoZWNrZXIpIHsNCiAgICAgICAgICAgICAgICAvLyDlkIPmjonmraPlnKjlsIblhpvnmoTmo4vlrZDvvIzmnIDpq5jkvJjlhYgNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDA7DQogICAgICAgICAgICAgICAgc2NvcmUgPSAxMDAwMCArIHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnN0IG5leHRCb2FyZCA9IGJvYXJkLm1hcChyb3cgPT4gWy4uLnJvd10pOw0KICAgICAgICAgICAgICAgIG5leHRCb2FyZFt0by5yXVt0by5jXSA9IG5leHRCb2FyZFtmcm9tLnJdW2Zyb20uY107DQogICAgICAgICAgICAgICAgbmV4dEJvYXJkW2Zyb20ucl1bZnJvbS5jXSA9IG51bGw7DQogICAgICAgICAgICAgICAgY29uc3QgZW5lbXlDb2xvciA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICAgICAgICAgIGlmIChpc0NoZWNrKG5leHRCb2FyZCwgZW5lbXlDb2xvcikpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g6Kej5bCG5ZCM5pe25Y+N5bCGDQogICAgICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMTsNCiAgICAgICAgICAgICAgICAgICAgc2NvcmUgPSA1MDAwICsgdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWFtuWug+WQg+WtkO+8iOWQq+mDqOWIhuWeq+WwhuWQg+WtkO+8iQ0KICAgICAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDI7DQogICAgICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgICAgICAvLyDotbDlsIbpgIPpgLgNCiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgICAgICAgICBzY29yZSA9IHBpZWNlVmFsdWU7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5Z6r5bCG562J5YW25L2Z5bqU5bCG552A5rOVDQogICAgICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gNDsNCiAgICAgICAgICAgICAgICAgICAgc2NvcmUgPSAwOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIC8vIOajgOafpemAg+i3keedgOazle+8iOaIkeaWueiiq+aNieeahOaji+WtkOenu+WKqO+8iQ0KICAgICAgICAgICAgaWYgKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgY29uc3QgaXNUaHJlYXRlbmVkUGllY2UgPSBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5zb21lKHAgPT4gcC5yID09PSBmcm9tLnIgJiYgcC5jID09PSBmcm9tLmMpOw0KICAgICAgICAgICAgICAgIGlmIChpc1RocmVhdGVuZWRQaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAvLyDpgIPot5HnnYDms5XvvIzkvJjlhYjnuqfnrKzkuozpq5gNCiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAxOw0KICAgICAgICAgICAgICAgICAgICAvLyDpgIPot5HliIbmlbDvvJrmiJHmlrnmo4vlrZDnmoTmnZDmlpnlgLwNCiAgICAgICAgICAgICAgICAgICAgc2NvcmUgPSBwaWVjZVZhbHVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAvLyDmo4Dmn6XmmK/lkKbmjYnlkIPnnYDms5XvvIjmiJHmlrnlj6/lkIPnmoTmo4vlrZDvvIkNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgaXNDYW5DYXB0dXJlID0gYm9hcmRJbmZvLmNhbkNhcHR1cmUgJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUuc29tZShwID0+IHAuciA9PT0gdG8uciAmJiBwLmMgPT09IHRvLmMpOw0KICAgICAgICAgICAgICAgICAgICBpZiAoaXNDYW5DYXB0dXJlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyDmjYnlkIPnnYDms5XvvIzkvJjlhYjnuqfnrKzkuInpq5gNCiAgICAgICAgICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMjsNCiAgICAgICAgICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOaZrumAmuWQg+WtkOedgOazlQ0KICAgICAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDpnZ7lkIPlrZDnnYDms5UNCiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSA0Ow0KICAgICAgICAgICAgICAgICAgICBzY29yZSA9IDA7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgLy8g5qOA5p+l5o2J5ZCD552A5rOV77yI5oiR5pa55Y+v5ZCD55qE5qOL5a2Q77yJDQogICAgICAgICAgICBlbHNlIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUgJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgIGNvbnN0IGlzQ2FuQ2FwdHVyZSA9IGJvYXJkSW5mby5jYW5DYXB0dXJlLnNvbWUocCA9PiBwLnIgPT09IHRvLnIgJiYgcC5jID09PSB0by5jKTsNCiAgICAgICAgICAgICAgICBpZiAoaXNDYW5DYXB0dXJlKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOaNieWQg+edgOazle+8jOS8mOWFiOe6p+esrOS4iemrmA0KICAgICAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDI7DQogICAgICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5pmu6YCa5ZCD5a2Q552A5rOVDQogICAgICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g6Z2e5ZCD5a2Q552A5rOVDQogICAgICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gNDsNCiAgICAgICAgICAgICAgICAgICAgc2NvcmUgPSAwOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIC8vIOayoeaciWJvYXJkSW5mb+aXtueahGZhbGxiYWNr6YC76L6RDQogICAgICAgICAgICBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgIC8vIOaZrumAmuWQg+WtkOedgOazlQ0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDpnZ7lkIPlrZDnnYDms5UNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDQ7DQogICAgICAgICAgICAgICAgc2NvcmUgPSAwOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDkv53lrZjkvJjlhYjnuqfjgIHliIbmlbDlkozljp/lp4vntKLlvJUNCiAgICAgICAgbW92ZS5wcmlvcml0eSA9IHByaW9yaXR5Ow0KICAgICAgICBtb3ZlLnNvcnRTY29yZSA9IHNjb3JlOw0KICAgICAgICBtb3ZlLm9yaWdpbmFsSW5kZXggPSBpbmRleDsNCiAgICB9KTsNCiAgICANCiAgICAvLyDmoLnmja7kvJjlhYjnuqfjgIHliIbmlbDlkozljp/lp4vntKLlvJXmjpLluo/nnYDms5UNCiAgICBtb3Zlcy5zb3J0KChhLCBiKSA9PiB7DQogICAgICAgIC8vIOmmluWFiOaMieS8mOWFiOe6p+aOkuW6j++8jOS8mOWFiOe6pzAgPiAxID4gMiA+IDMgPiA0DQogICAgICAgIGlmIChhLnByaW9yaXR5ICE9PSBiLnByaW9yaXR5KSB7DQogICAgICAgICAgICByZXR1cm4gYS5wcmlvcml0eSAtIGIucHJpb3JpdHk7DQogICAgICAgIH0NCiAgICAgICAgLy8g5LyY5YWI57qn55u45ZCM5pe277yM5oyJ5YiG5pWw5LuO6auY5Yiw5L2O5o6S5bqPDQogICAgICAgIGlmIChhLnNvcnRTY29yZSAhPT0gYi5zb3J0U2NvcmUpIHsNCiAgICAgICAgICAgIHJldHVybiBiLnNvcnRTY29yZSAtIGEuc29ydFNjb3JlOw0KICAgICAgICB9DQogICAgICAgIC8vIOS8mOWFiOe6p+WSjOWIhuaVsOmDveebuOWQjOaXtu+8jOaMieWOn+Wni+e0ouW8leaOkuW6j++8jOS/neaMgeeos+Wumg0KICAgICAgICByZXR1cm4gYS5vcmlnaW5hbEluZGV4IC0gYi5vcmlnaW5hbEluZGV4Ow0KICAgIH0pOw0KICAgIA0KICAgIHJldHVybiBtb3ZlczsNCn07DQoNCi8vIOWkhOeQhuWNleS4quaji+WtkOeahOaJgOaciW1vdmVz77yM6K6h566X5py65Yqo5oCn44CB5aiB6IOB5ZKM5L+d5oqkDQpjb25zdCBwcm9jZXNzUGllY2VNb3ZlcyA9IChib2FyZCwgcGllY2VzSW5mbywgaW5mbykgPT4gew0KICAgIGNvbnN0IHsgcGllY2UsIG1vdmVzIH0gPSBpbmZvOw0KICAgIGNvbnN0IHsgYmFzZU1vdmVWYWx1ZSB9ID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5Ow0KICAgIA0KICAgIC8vIDEuIOiuoeeul+acuuWKqOaAp++8muepuuS9jee9rueahOenu+WKqOaVsOmHjw0KICAgIGZvciAoY29uc3QgbW92ZSBvZiBtb3Zlcykgew0KICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFttb3ZlLnJdW21vdmUuY107DQogICAgICAgIGlmICghdGFyZ2V0KSB7DQogICAgICAgICAgICAvLyDnm67moIfkvY3nva7kuLrnqbrvvIzorqHnrpfmnLrliqjmgKcNCiAgICAgICAgICAgIGluZm8ubW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KLy8g5qOA5p+l55uu5qCH5L2N572u5piv5ZCm5Y+v5o6l5Y+X77yI6YG/5YWN5piO5pi+6YCB5ZCDL+S6j+aNou+8iQ0KLy8g5LyY5YyW54mI77ya5o6l5Y+X6aKE6K6h566X55qEYm9hcmRJbmZv5ZKMcGllY2VzSW5mb++8jOmBv+WFjemHjeWkjeiuoeeulw0KY29uc3QgaXNQb3NpdGlvbkFjY2VwdGFibGUgPSAoYm9hcmQsIGZyb20sIHRvLCBjdXJyZW50UGxheWVyLCBib2FyZEluZm8gPSBudWxsLCBwaWVjZXNJbmZvID0gbnVsbCwgdHJ5TW92ZVBpZWNlID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcpID0+IHsNCiAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IHRyeU1vdmVQaWVjZSB8fCBib2FyZFtmcm9tLnJdW2Zyb20uY107DQogICAgY29uc3QgdGFyZ2V0UGllY2UgPSBib2FyZFt0by5yXVt0by5jXTsNCiAgICBjb25zdCBpc0NhcHR1cmUgPSB0YXJnZXRQaWVjZSAmJiB0YXJnZXRQaWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcjsNCg0KICAgIC8vIOaUtumbhuaJgOacieaji+WtkOS/oeaBr++8jOWPquWcqOayoeacieaPkOS+m+aXtuiuoeeulw0KICAgIGxldCBsb2NhbFBpZWNlc0luZm8gPSBwaWVjZXNJbmZvOw0KICAgIGlmICghbG9jYWxQaWVjZXNJbmZvKSB7DQogICAgICAgIGxvY2FsUGllY2VzSW5mbyA9IFtdOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBtb3ZlcyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIHsgciwgYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgbG9jYWxQaWVjZXNJbmZvLnB1c2goew0KICAgICAgICAgICAgICAgICAgICAgICAgcGllY2UsDQogICAgICAgICAgICAgICAgICAgICAgICByLCBjLCBtb3ZlcywNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogW10sDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnk6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eVZhbHVlOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDANCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g6K6h566X5qOL5a2Q5YWz57O75ZKM5o6n5Yi25L+h5oGv77yM5Y+q5Zyo5rKh5pyJ5o+Q5L6b5pe26K6h566XDQogICAgbGV0IGxvY2FsQm9hcmRJbmZvID0gYm9hcmRJbmZvOw0KICAgIGlmICghbG9jYWxCb2FyZEluZm8pIHsNCiAgICAgICAgbG9jYWxCb2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCiAgICAgICAgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMoYm9hcmQsIGxvY2FsUGllY2VzSW5mbywgbG9jYWxCb2FyZEluZm8pOw0KICAgIH0NCg0KICAgIGNvbnN0IGNvbnRyb2xsZXJzID0gbG9jYWxCb2FyZEluZm9bdG8ucl1bdG8uY10gfHwgW107DQogICAgbGV0IGhhc0FsbHlDb250cm9sbGVyID0gZmFsc2U7DQogICAgbGV0IGhhc0VuZW15Q29udHJvbGxlciA9IGZhbHNlOw0KDQogICAgZm9yIChjb25zdCBjb250cm9sbGVyIG9mIGNvbnRyb2xsZXJzKSB7DQogICAgICAgIC8vIOaOkumZpOato+WcqOenu+WKqOeahOaji+WtkOacrOi6q++8iOi1sOWQjuWug+S4jeWGjeS7juWOn+S9jeaOp+WItuebruagh++8iQ0KICAgICAgICBpZiAobW92aW5nUGllY2UgJiYgY29udHJvbGxlci5yID09PSBmcm9tLnIgJiYgY29udHJvbGxlci5jID09PSBmcm9tLmMpIHsNCiAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICB9DQogICAgICAgIGlmIChjb250cm9sbGVyLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICBoYXNBbGx5Q29udHJvbGxlciA9IHRydWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBoYXNFbmVteUNvbnRyb2xsZXIgPSB0cnVlOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgaWYgKGlzQ2FwdHVyZSkgew0KICAgICAgICAvLyDnmb3lkIPvvJrnm67moIfmnKrooqvmlYzmlrnkv53miqQNCiAgICAgICAgaWYgKCFoYXNFbmVteUNvbnRyb2xsZXIpIHsNCiAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgICAgIC8vIOeugOWNlSBTRUXvvJrlhYjlvpfnm67moIfliIbvvIzoi6XkvJrooqvlj43lkIPliJnlho3lpLHlt7Hmlrnmo4vlrZANCiAgICAgICAgY29uc3QgdGFyZ2V0VmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHRhcmdldFBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCBvdXJWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUobW92aW5nUGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgIGxldCBzZWUgPSB0YXJnZXRWYWx1ZSAtIG91clZhbHVlOw0KICAgICAgICAvLyDoi6XmnInlt7Hmlrnnu6fnu63kv53miqTvvIznspfnlaXorqTkuLrlj6/og73lho3lkIPlm57mnIDkvY7ku7flgLznmoTmlYzmlrnkv53miqTogIUNCiAgICAgICAgaWYgKGhhc0FsbHlDb250cm9sbGVyKSB7DQogICAgICAgICAgICBjb25zdCBlbmVteUd1YXJkVmFsdWVzID0gY29udHJvbGxlcnMNCiAgICAgICAgICAgICAgICAuZmlsdGVyKGMgPT4gYy5jb2xvciAhPT0gY3VycmVudFBsYXllciAmJiAhKGMuciA9PT0gZnJvbS5yICYmIGMuYyA9PT0gZnJvbS5jKSkNCiAgICAgICAgICAgICAgICAubWFwKGMgPT4gew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbYy5yXVtjLmNdOw0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gcCA/IGdldE1hdGVyaWFsVmFsdWUocCwgZ2FtZVN0YWdlKSA6IDA7DQogICAgICAgICAgICAgICAgfSkNCiAgICAgICAgICAgICAgICAuZmlsdGVyKHYgPT4gdiA+IDApDQogICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IGEgLSBiKTsNCiAgICAgICAgICAgIGlmIChlbmVteUd1YXJkVmFsdWVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICBzZWUgKz0gZW5lbXlHdWFyZFZhbHVlc1swXTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICAvLyDmmI7mmL7kuo/mjaLvvIjlpoLovabmjaLml6DmoLnlhbXkuJTkvJrooqvlj43lkIPvvInliJnov4fmu6TvvJvlubPmjaIv6LWa5o2i55WZ57uZ5pCc57SiDQogICAgICAgIHJldHVybiBzZWUgPj0gMDsNCiAgICB9DQoNCiAgICAvLyDpnZ7lkIPlrZDvvJrnm67moIfku4XooqvmlYzmlrnmjqfliLbliJnop4bkuLrpgIHlkIMNCiAgICBpZiAoY29udHJvbGxlcnMubGVuZ3RoID09PSAwKSB7DQogICAgICAgIHJldHVybiB0cnVlOw0KICAgIH0NCiAgICByZXR1cm4gIWhhc0VuZW15Q29udHJvbGxlciB8fCBoYXNBbGx5Q29udHJvbGxlcjsNCn07DQoNCi8vIOiuoeeul+WuieWFqOWAvA0KLy8g5Lmd5a6r5L2N572u5a6a5LmJ77yaW+i1t+Wni+ihjCwg57uT5p2f6KGMLCDotbflp4vliJcsIOe7k+adn+WIl10gLSDnp7vliLDlh73mlbDlpJbpg6jvvIzpgb/lhY3ph43lpI3liJvlu7oNCmNvbnN0IFBBTEFDRV9QT1NJVElPTlMgPSB7DQogICAgcmVkOiB7IHN0YXJ0Um93OiAwLCBlbmRSb3c6IDIsIHN0YXJ0Q29sOiAzLCBlbmRDb2w6IDUgfSwgLy8g57qi5pa55Lmd5a6r77yI5bCG55qE5L2N572u77yJDQogICAgYmxhY2s6IHsgc3RhcnRSb3c6IDcsIGVuZFJvdzogOSwgc3RhcnRDb2w6IDMsIGVuZENvbDogNSB9ICAvLyDpu5HmlrnkuZ3lrqvvvIjluIXnmoTkvY3nva7vvIkNCn07DQoNCi8vIOWNkuael+e6v+WumuS5iSAtIOenu+WIsOWHveaVsOWklumDqO+8jOmBv+WFjemHjeWkjeWIm+W7ug0KY29uc3QgTElORUxJTkVfUE9TSVRJT05TID0gew0KICAgIHJlZDogMywgIC8vIOe6ouaWueWNkuael+e6v++8iOm7keWFtemcgOimgei2hei/h+eahOe6v++8iQ0KICAgIGJsYWNrOiA2ICAvLyDpu5HmlrnljZLmnpfnur/vvIjnuqLlhbXpnIDopoHotoXov4fnmoTnur/vvIkNCn07DQoNCi8vIOS7jnBpZWNlc0luZm/nlJ/miJDkvY3nva7mjqfliLbmmKDlsITooagNCmNvbnN0IGJ1aWxkUG9zaXRpb25Db250cm9sTWFwID0gKHBpZWNlc0luZm8pID0+IHsNCiAgICBjb25zdCBwb3NpdGlvbkNvbnRyb2xNYXAgPSBuZXcgTWFwKCk7DQogICAgDQogICAgLy8g6YGN5Y6G5omA5pyJ5qOL5a2Q77yM6K6w5b2V5q+P5Liq5L2N572u55qE5o6n5Yi26ICFDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgLy8g5qOA5p+lY29udHJvbOWxnuaAp+aYr+WQpuWtmOWcqOS4lOS4uuaVsOe7hA0KICAgICAgICBpZiAoIWluZm8uY29udHJvbCB8fCAhQXJyYXkuaXNBcnJheShpbmZvLmNvbnRyb2wpKSB7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy8g6YGN5Y6G6K+l5qOL5a2Q55qE5omA5pyJ5o6n5Yi254K5DQogICAgICAgIGZvciAoY29uc3QgY29udHJvbFBvcyBvZiBpbmZvLmNvbnRyb2wpIHsNCiAgICAgICAgICAgIC8vIOajgOafpWNvbnRyb2xQb3PmmK/lkKbmnInmlYgNCiAgICAgICAgICAgIGlmICghY29udHJvbFBvcyB8fCB0eXBlb2YgY29udHJvbFBvcy5yICE9PSAnbnVtYmVyJyB8fCB0eXBlb2YgY29udHJvbFBvcy5jICE9PSAnbnVtYmVyJykgew0KICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtjb250cm9sUG9zLnJ9LCR7Y29udHJvbFBvcy5jfWA7DQogICAgICAgICAgICBpZiAoIXBvc2l0aW9uQ29udHJvbE1hcC5oYXMoa2V5KSkgew0KICAgICAgICAgICAgICAgIHBvc2l0aW9uQ29udHJvbE1hcC5zZXQoa2V5LCBbXSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICAvLyDorrDlvZXmjqfliLbogIXnmoTpopzoibLlkozmo4vlrZDnsbvlnosNCiAgICAgICAgICAgIHBvc2l0aW9uQ29udHJvbE1hcC5nZXQoa2V5KS5wdXNoKHsNCiAgICAgICAgICAgICAgICBjb2xvcjogaW5mby5waWVjZS5jb2xvciwNCiAgICAgICAgICAgICAgICB0eXBlOiBpbmZvLnBpZWNlLnR5cGUNCiAgICAgICAgICAgIH0pOw0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIHJldHVybiBwb3NpdGlvbkNvbnRyb2xNYXA7DQp9Ow0KDQovLyDorqHnrpflronlhajlgLwgLSDph43mnoTniYjvvJrln7rkuo5ib2FyZEluZm/nmoTmjqfliLblhbPns7sNCmNvbnN0IGNhbGN1bGF0ZVNhZmV0eVZhbHVlcyA9IChwaWVjZXNJbmZvLCBib2FyZEluZm8pID0+IHsNCiAgICAvLyAxLiDmib7liLDlsIblkozluIUNCiAgICBjb25zdCBnZW5lcmFsSW5mbyA9IFtdOw0KICAgIHBpZWNlc0luZm8uZm9yRWFjaChpbmZvID0+IHsNCiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgew0KICAgICAgICAgICAgZ2VuZXJhbEluZm8ucHVzaChpbmZvKTsNCiAgICAgICAgfQ0KICAgIH0pOw0KICAgIA0KICAgIGZvciAoY29uc3QgZ2VuZXJhbCBvZiBnZW5lcmFsSW5mbykgew0KICAgICAgICBjb25zdCBnZW5lcmFsQ29sb3IgPSBnZW5lcmFsLnBpZWNlLmNvbG9yOw0KICAgICAgICBjb25zdCBlbmVteUNvbG9yID0gZ2VuZXJhbENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgDQogICAgICAgIC8vIOajgOafpeWwhuW4heeahOaOp+WItueCueaYr+WQpuiiq+aVjOaWueaji+WtkOaOp+WItg0KICAgICAgICBmb3IgKGNvbnN0IGNvbnRyb2xQb3Mgb2YgZ2VuZXJhbC5jb250cm9sKSB7DQogICAgICAgICAgICAvLyDojrflj5bor6XmjqfliLbngrnnmoTmjqfliLbogIUNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gY29udHJvbFBvczsNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uQ29udHJvbGxlcnMgPSBib2FyZEluZm9bcl1bY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOajgOafpeaYr+WQpuacieaVjOaWueaji+WtkOaOp+WItuivpeS9jee9rg0KICAgICAgICAgICAgY29uc3QgaGFzRW5lbXlDb250cm9sID0gcG9zaXRpb25Db250cm9sbGVycy5zb21lKGNvbnRyb2xsZXIgPT4gDQogICAgICAgICAgICAgICAgY29udHJvbGxlci5jb2xvciA9PT0gZW5lbXlDb2xvcg0KICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5aaC5p6c5L2N572u5pyJ5pWM5pa55qOL5a2Q5o6n5Yi277yM5omjNTDnmoTlronlhajlgLwNCiAgICAgICAgICAgIGlmIChoYXNFbmVteUNvbnRyb2wpIHsNCiAgICAgICAgICAgICAgICBnZW5lcmFsLnNhZmV0eVZhbHVlIC09IDUwOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KDQovLyDorqHnrpflqIHog4HlgLzvvIjln7rkuo7lrozmlbTnmoTlqIHog4HlhbPns7vvvIkNCi8vIOS/ruaUue+8muWogeiDgeWAvOW6lOivpeS7juaQnOe0ouWPkei1t+aWueeahOinkuW6puiuoeeul++8jOiAjOS4jeaYr+S7juW9k+WJjeihjOaji+aWueinkuW6pg0KLy8g5re75YqgZ2FtZVN0YWdl5Y+C5pWw77yM6YG/5YWN5Zyo5b6q546v5Lit6YeN5aSN6LCD55SoZ2V0R2FtZVBoYXNlDQovLyDmt7vliqBib2FyZEluZm/lj4LmlbDvvIznlKjkuo7lrZjlgqjlqIHog4Hnsbvlnovkv6Hmga8NCmNvbnN0IGNhbGN1bGF0ZVRocmVhdFZhbHVlcyA9IChib2FyZCwgcGllY2VzSW5mbywgY3VycmVudFBsYXllciwgZGVwdGgsIHNlYXJjaEluaXRpYXRvciA9IG51bGwsIGdhbWVTdGFnZSA9ICdtaWQnLCBib2FyZEluZm8gPSBudWxsKSA9PiB7DQogICAgLy8g57uf6K6hDQogICAgaWYgKGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgcGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQogICAgfQ0KICAgIA0KICAgIC8vIOWIneWni+WMluWogeiDgeexu+Wei+e7n+iuoeS/oeaBrw0KICAgIGlmIChib2FyZEluZm8pIHsNCiAgICAgICAgYm9hcmRJbmZvLmNoZWNrcyA9IFtdOyAgICAgIC8vIOWwhuWGm+S/oeaBrw0KICAgICAgICBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyA9IFtdOyAgLy8g6KKr5o2J55qE5qOL5a2QDQogICAgICAgIGJvYXJkSW5mby5jYW5DYXB0dXJlID0gW107ICAvLyDlj6/lkIPnmoTmo4vlrZANCiAgICB9DQoNCiAgICBjb25zdCBjaGVja0JvbnVzID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmNoZWNrLmJvbnVzOw0KICAgIC8vIOWQjOS4gOaXoOagueWtkOiiq+WkmuaWueWogeiDgeaXtuWPquiuoeS4gOasoeadkOaWmeWogeiDge+8jOmBv+WFjemHjeWkjeWKoOWIhg0KICAgIGNvbnN0IHNjb3JlZEhhbmdpbmdLZXlzID0gbmV3IFNldCgpOw0KICAgIGNvbnN0IGNoZWNrZWRHZW5lcmFscyA9IG5ldyBTZXQoKTsNCiAgICANCiAgICAvLyDpgY3ljobmiYDmnInmo4vlrZDvvIzorqHnrpflqIHog4HlhbPns7sNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBjb25zdCB7IHBpZWNlIH0gPSBpbmZvOw0KICAgICAgICANCiAgICAgICAgLy8g5qOA5p+l5b2T5YmN5qOL5a2Q5piv5ZCm5aiB6IOB5YW25LuW5qOL5a2QDQogICAgICAgIGZvciAoY29uc3QgdGhyZWF0ZW5lZFBpZWNlIG9mIGluZm8udGhyZWF0KSB7DQogICAgICAgICAgICBjb25zdCBpc0F0dGFja2VyQ3VycmVudFBsYXllciA9IHBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDlsIblhpvvvJrlj6rnu5nlsI/pop3lhYjmiYvliIbvvIznu53kuI3mjInlsIYv5biF5p2Q5paZ5YC85YGaIFNFRe+8iOWQpuWImeS8muS4uuWwhuS4jeaDnOmAgeatu++8iQ0KICAgICAgICAgICAgY29uc3QgaXNDaGVjayA9IHRocmVhdGVuZWRQaWVjZS5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5HRU5FUkFMOw0KICAgICAgICAgICAgaWYgKGlzQ2hlY2spIHsNCiAgICAgICAgICAgICAgICBpZiAoYm9hcmRJbmZvKSB7DQogICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jaGVja3MucHVzaCh7DQogICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tlcjogaW5mbywNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldDogdGhyZWF0ZW5lZFBpZWNlLA0KICAgICAgICAgICAgICAgICAgICAgICAgaXNDaGVjazogdHJ1ZQ0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgLy8g5ZCM5LiA5bCGL+W4heiiq+WkmuaWueWwhuWGm+aXtu+8jOWFiOaJi+WIhuWPquWKoOS4gOasoQ0KICAgICAgICAgICAgICAgIGNvbnN0IGdlbmVyYWxLZXkgPSBgJHt0aHJlYXRlbmVkUGllY2Uucn0sJHt0aHJlYXRlbmVkUGllY2UuY31gOw0KICAgICAgICAgICAgICAgIGlmICghY2hlY2tlZEdlbmVyYWxzLmhhcyhnZW5lcmFsS2V5KSkgew0KICAgICAgICAgICAgICAgICAgICBjaGVja2VkR2VuZXJhbHMuYWRkKGdlbmVyYWxLZXkpOw0KICAgICAgICAgICAgICAgICAgICBpbmZvLnRocmVhdFZhbHVlICs9IGNoZWNrQm9udXM7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCB0YXJnZXRWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUodGhyZWF0ZW5lZFBpZWNlLnBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgY29uc3QgaGFzR3VhcmQgPSB0aHJlYXRlbmVkUGllY2UuZ3VhcmRlZEJ5ICYmIHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnkubGVuZ3RoID4gMDsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gU0VF77ya5LuF55So5LqO5Yik5pat5Lqk5o2i5piv5ZCm5a+55pS75Ye75pa55pyJ5Yip77yb5aiB6IOB5YiG5Y+q5Yqg5Zyo5pS75Ye75pa577yM6YG/5YWN5YeA5YiG5Y+M6K6hDQogICAgICAgICAgICBsZXQgc3NlU2NvcmUgPSAwOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoaGFzR3VhcmQpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBhdHRhY2tlcnMgPSB0aHJlYXRlbmVkUGllY2UudGhyZWF0ZW5lZEJ5DQogICAgICAgICAgICAgICAgICAgIC5tYXAoYXR0YWNrZXIgPT4gKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC4uLmF0dGFja2VyLA0KICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGdldE1hdGVyaWFsVmFsdWUoYXR0YWNrZXIucGllY2UsIGdhbWVTdGFnZSkNCiAgICAgICAgICAgICAgICAgICAgfSkpDQogICAgICAgICAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBhLnZhbHVlIC0gYi52YWx1ZSk7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgY29uc3QgZ3VhcmRzID0gdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeQ0KICAgICAgICAgICAgICAgICAgICAubWFwKGd1YXJkID0+ICh7DQogICAgICAgICAgICAgICAgICAgICAgICAuLi5ndWFyZCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlOiBnZXRNYXRlcmlhbFZhbHVlKGd1YXJkLnBpZWNlLCBnYW1lU3RhZ2UpDQogICAgICAgICAgICAgICAgICAgIH0pKQ0KICAgICAgICAgICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gYS52YWx1ZSAtIGIudmFsdWUpOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGxldCBleGNoYW5nZVNjb3JlID0gMDsNCiAgICAgICAgICAgICAgICBsZXQgYXR0YWNrZXJJbmRleCA9IDA7DQogICAgICAgICAgICAgICAgbGV0IGd1YXJkSW5kZXggPSAwOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIHdoaWxlIChhdHRhY2tlckluZGV4IDwgYXR0YWNrZXJzLmxlbmd0aCAmJiBndWFyZEluZGV4IDwgZ3VhcmRzLmxlbmd0aCkgew0KICAgICAgICAgICAgICAgICAgICBpZiAoZ3VhcmRJbmRleCA9PT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSB0YXJnZXRWYWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBleGNoYW5nZVNjb3JlIC09IGF0dGFja2Vyc1thdHRhY2tlckluZGV4XS52YWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGF0dGFja2VySW5kZXggKyAxIDwgYXR0YWNrZXJzLmxlbmd0aCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSBndWFyZHNbZ3VhcmRJbmRleF0udmFsdWU7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgYXR0YWNrZXJJbmRleCsrOw0KICAgICAgICAgICAgICAgICAgICBndWFyZEluZGV4Kys7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIHNzZVNjb3JlID0gZXhjaGFuZ2VTY29yZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgc3NlU2NvcmUgPSB0YXJnZXRWYWx1ZTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8g5Y+q5oqK5a+55pS75Ye75pa55pyJ5Yip55qE5aiB6IOB6K6h5YWlIHRocmVhdFZhbHVl77yI5Y2V5ZCR6K6h5YWl77yM5LiN5YGaIHNhZmV0eSDlr7nnp7DmiaPliIbvvIkNCiAgICAgICAgICAgIGlmICghaGFzR3VhcmQpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBoYW5nS2V5ID0gYCR7dGhyZWF0ZW5lZFBpZWNlLnJ9LCR7dGhyZWF0ZW5lZFBpZWNlLmN9YDsNCiAgICAgICAgICAgICAgICBpZiAoIXNjb3JlZEhhbmdpbmdLZXlzLmhhcyhoYW5nS2V5KSkgew0KICAgICAgICAgICAgICAgICAgICBzY29yZWRIYW5naW5nS2V5cy5hZGQoaGFuZ0tleSk7DQogICAgICAgICAgICAgICAgICAgIGluZm8udGhyZWF0VmFsdWUgKz0gdGFyZ2V0VmFsdWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGlmIChib2FyZEluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzQXR0YWNrZXJDdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWJvYXJkSW5mby5jYW5DYXB0dXJlLmluY2x1ZGVzKGluZm8pKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICghYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMuaW5jbHVkZXModGhyZWF0ZW5lZFBpZWNlKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMucHVzaCh0aHJlYXRlbmVkUGllY2UpOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIGlmIChzc2VTY29yZSA+IDApIHsNCiAgICAgICAgICAgICAgICAvLyDmnInmoLnlrZDkvYbkuqTmjaLku43otZrvvJrmipjljYrorqHlhaXvvJvlkIzkuIDnm67moIflj6rnlLHku7flgLzmnIDkvY7nmoTmlLvlh7vogIXorqHliIbkuIDmrKENCiAgICAgICAgICAgICAgICBjb25zdCBoYW5nS2V5ID0gYGc6JHt0aHJlYXRlbmVkUGllY2Uucn0sJHt0aHJlYXRlbmVkUGllY2UuY31gOw0KICAgICAgICAgICAgICAgIGlmICghc2NvcmVkSGFuZ2luZ0tleXMuaGFzKGhhbmdLZXkpKSB7DQogICAgICAgICAgICAgICAgICAgIHNjb3JlZEhhbmdpbmdLZXlzLmFkZChoYW5nS2V5KTsNCiAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXRWYWx1ZSArPSBzc2VTY29yZSAqIDAuNTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICAvLyBzc2VTY29yZSA8PSAw77ya5LqP5o2iL+W5s+aNou+8jOS4jeiusOWogeiDgeWIhg0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KLy8g5biu5Yqp5YWz57O75oiY5pyv5YC86K6h566XDQpjb25zdCBjYWxjdWxhdGVBc3Npc3RWYWx1ZSA9IChwaWVjZXNJbmZvLCBpbmZvKSA9PiB7DQogICAgY29uc3QgeyBwaWVjZSwgciwgYyB9ID0gaW5mbzsNCiAgICBsZXQgYXNzaXN0VmFsdWUgPSAwOw0KICAgIA0KICAgIC8vIDEuIOajgOafpeaYr+WQpuS4uuW3seaWueeCrueahOeCruaetu+8iOWKoOWIhu+8iQ0KICAgIGZvciAoY29uc3QgYWxseUluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoYWxseUluZm8ucGllY2UuY29sb3IgPT09IHBpZWNlLmNvbG9yICYmIGFsbHlJbmZvICE9PSBpbmZvICYmIGFsbHlJbmZvLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkNBTk5PTikgew0KICAgICAgICAgICAgLy8g5qOA5p+l54Ku5ZKM5b2T5YmN5qOL5a2Q5piv5ZCm5Zyo5ZCM5LiA55u057q/5LiKDQogICAgICAgICAgICBpZiAoYWxseUluZm8uciA9PT0gciB8fCBhbGx5SW5mby5jID09PSBjKSB7DQogICAgICAgICAgICAgICAgLy8g5qOA5p+l54Ku5ZKM5b2T5YmN5qOL5a2Q5LmL6Ze05piv5ZCm5rKh5pyJ5YW25LuW5qOL5a2QDQogICAgICAgICAgICAgICAgbGV0IGhhc1NjcmVlbiA9IHRydWU7DQogICAgICAgICAgICAgICAgaWYgKGFsbHlJbmZvLnIgPT09IHIpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA6KGMDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oYWxseUluZm8uYywgYykgKyAxOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heChhbGx5SW5mby5jLCBjKSAtIDE7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGNvbCA9IHN0YXJ0OyBjb2wgPD0gZW5kOyBjb2wrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmV0d2VlblBpZWNlID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSByICYmIHAuYyA9PT0gY29sKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiZXR3ZWVuUGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYXNTY3JlZW4gPSBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOWIlw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKGFsbHlJbmZvLnIsIHIpICsgMTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoYWxseUluZm8uciwgcikgLSAxOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCByb3cgPSBzdGFydDsgcm93IDw9IGVuZDsgcm93KyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJldHdlZW5QaWVjZSA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gcm93ICYmIHAuYyA9PT0gYyk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYmV0d2VlblBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFzU2NyZWVuID0gZmFsc2U7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGhhc1NjcmVlbikgew0KICAgICAgICAgICAgICAgICAgICBhc3Npc3RWYWx1ZSArPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuYXNzaXN0LmNhbm5vblNjcmVlblZhbHVlOyAvLyDkuLrlt7Hmlrnngq7mj5Dkvpvngq7mnrbvvIzlop7liqDmiJjmnK/lgLwNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8gMi4g5qOA5p+l5piv5ZCm5Li65pWM5pa554Ku55qE54Ku5p6277yI5omj5YiG77yJDQogICAgZm9yIChjb25zdCBlbmVteUluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoZW5lbXlJbmZvLnBpZWNlLmNvbG9yICE9PSBwaWVjZS5jb2xvciAmJiBlbmVteUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuQ0FOTk9OKSB7DQogICAgICAgICAgICAvLyDmo4Dmn6XmlYzmlrnngq7lkozlvZPliY3mo4vlrZDmmK/lkKblnKjlkIzkuIDnm7Tnur/kuIoNCiAgICAgICAgICAgIGlmIChlbmVteUluZm8uciA9PT0gciB8fCBlbmVteUluZm8uYyA9PT0gYykgew0KICAgICAgICAgICAgICAgIC8vIOajgOafpeaVjOaWueeCruWSjOW9k+WJjeaji+WtkOS5i+mXtOaYr+WQpuayoeacieWFtuS7luaji+WtkA0KICAgICAgICAgICAgICAgIGxldCBpc0VuZW15U2NyZWVuID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICBpZiAoZW5lbXlJbmZvLnIgPT09IHIpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA6KGMDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oZW5lbXlJbmZvLmMsIGMpICsgMTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoZW5lbXlJbmZvLmMsIGMpIC0gMTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgY29sID0gc3RhcnQ7IGNvbCA8PSBlbmQ7IGNvbCsrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiZXR3ZWVuUGllY2UgPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHIgJiYgcC5jID09PSBjb2wpOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJldHdlZW5QaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzRW5lbXlTY3JlZW4gPSBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOWIlw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKGVuZW15SW5mby5yLCByKSArIDE7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KGVuZW15SW5mby5yLCByKSAtIDE7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IHJvdyA9IHN0YXJ0OyByb3cgPD0gZW5kOyByb3crKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmV0d2VlblBpZWNlID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSByb3cgJiYgcC5jID09PSBjKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiZXR3ZWVuUGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0VuZW15U2NyZWVuID0gZmFsc2U7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGlzRW5lbXlTY3JlZW4pIHsNCiAgICAgICAgICAgICAgICAgICAgYXNzaXN0VmFsdWUgLT0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmFzc2lzdC5jYW5ub25TY3JlZW5WYWx1ZTsgLy8g5Li65pWM5pa554Ku5o+Q5L6b54Ku5p6277yM5YeP5bCR5oiY5pyv5YC877yI5omj5YiG77yJDQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIHJldHVybiBhc3Npc3RWYWx1ZTsNCn07DQoNCi8vIOmYu+aMoeWFs+ezu+aImOacr+WAvOiuoeeulw0KY29uc3QgY2FsY3VsYXRlQmxvY2tWYWx1ZSA9IChib2FyZCwgcGllY2VzSW5mbywgaW5mbykgPT4gew0KICAgIGNvbnN0IHsgcGllY2UsIHIsIGMgfSA9IGluZm87DQogICAgbGV0IGJsb2NrVmFsdWUgPSAwOw0KICAgIGNvbnN0IGVuZW15Q29sb3IgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgDQogICAgLy8gMS4g6Zi75oyh5pWM5Lq6DQogICAgLy8gMS4xIOajgOafpeaYr+WQpumYu+aMoeWvueaWuei9pueahOmBk+i3rw0KICAgIGZvciAoY29uc3QgZW5lbXlJbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGVuZW15SW5mby5waWVjZS5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBlbmVteUluZm8ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuQ0hBUklPVCkgew0KICAgICAgICAgICAgLy8g5qOA5p+l6L2m5ZKM5b2T5YmN5qOL5a2Q5piv5ZCm5Zyo5ZCM5LiA55u057q/5LiKDQogICAgICAgICAgICBpZiAoZW5lbXlJbmZvLnIgPT09IHIgfHwgZW5lbXlJbmZvLmMgPT09IGMpIHsNCiAgICAgICAgICAgICAgICAvLyDmo4Dmn6XkuKTogIXkuYvpl7TmmK/lkKbmsqHmnInlhbblroPmo4vlrZANCiAgICAgICAgICAgICAgICBsZXQgaXNCbG9ja2luZyA9IHRydWU7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGVuZW15SW5mby5yID09PSByKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOihjA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKGVuZW15SW5mby5jLCBjKSArIDE7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KGVuZW15SW5mby5jLCBjKSAtIDE7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGNvbCA9IHN0YXJ0OyBjb2wgPD0gZW5kOyBjb2wrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmV0d2VlblBpZWNlID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSByICYmIHAuYyA9PT0gY29sKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChiZXR3ZWVuUGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0Jsb2NraW5nID0gZmFsc2U7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDliJcNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbihlbmVteUluZm8uciwgcikgKyAxOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heChlbmVteUluZm8uciwgcikgLSAxOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCByb3cgPSBzdGFydDsgcm93IDw9IGVuZDsgcm93KyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJldHdlZW5QaWVjZSA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gcm93ICYmIHAuYyA9PT0gYyk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYmV0d2VlblBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNCbG9ja2luZyA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChpc0Jsb2NraW5nKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOajgOafpeaYr+WQpumYu+aMoeS6hui9pueahOenu+WKqA0KICAgICAgICAgICAgICAgICAgICBibG9ja1ZhbHVlICs9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5ibG9jay5lbmVteUNoYXJpb3RCbG9ja1ZhbHVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyAxLjIg5qOA5p+l5piv5ZCm5Yir5a+55pa56ams55qE6ams6IW/DQogICAgZm9yIChjb25zdCBlbmVteUluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoZW5lbXlJbmZvLnBpZWNlLmNvbG9yID09PSBlbmVteUNvbG9yICYmIGVuZW15SW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5IT1JTRSkgew0KICAgICAgICAgICAgY29uc3QgaG9yc2VSID0gZW5lbXlJbmZvLnI7DQogICAgICAgICAgICBjb25zdCBob3JzZUMgPSBlbmVteUluZm8uYzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g6ams6IW/5L2N572u77ya6ams55qE5ZGo5Zu0OOS4quaWueWQkeeahOiFv+eahOS9jee9rg0KICAgICAgICAgICAgY29uc3QgbGVnUG9zaXRpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgcjogaG9yc2VSICsgMSwgYzogaG9yc2VDIH0sIC8vIOS4i+aWueiFvw0KICAgICAgICAgICAgICAgIHsgcjogaG9yc2VSIC0gMSwgYzogaG9yc2VDIH0sIC8vIOS4iuaWueiFvw0KICAgICAgICAgICAgICAgIHsgcjogaG9yc2VSLCBjOiBob3JzZUMgKyAxIH0sIC8vIOWPs+aWueiFvw0KICAgICAgICAgICAgICAgIHsgcjogaG9yc2VSLCBjOiBob3JzZUMgLSAxIH0gIC8vIOW3puaWueiFvw0KICAgICAgICAgICAgXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5qOA5p+l5b2T5YmN5qOL5a2Q5piv5ZCm5Zyo6ams6IW/5L2N572uDQogICAgICAgICAgICBmb3IgKGNvbnN0IGxlZ1BvcyBvZiBsZWdQb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBpZiAobGVnUG9zLnIgPT09IHIgJiYgbGVnUG9zLmMgPT09IGMpIHsNCiAgICAgICAgICAgICAgICAgICAgYmxvY2tWYWx1ZSArPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuYmxvY2suZW5lbXlIb3JzZUJsb2NrVmFsdWU7IC8vIOWIq+mprOiFv++8jOWinuWKoOaImOacr+WAvA0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyAxLjMg5qOA5p+l5piv5ZCm5aC15aGe5a+55pa56LGh55qE6LGh55y8DQogICAgZm9yIChjb25zdCBlbmVteUluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoZW5lbXlJbmZvLnBpZWNlLmNvbG9yID09PSBlbmVteUNvbG9yICYmIGVuZW15SW5mby5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5FTEVQSEFOVCkgew0KICAgICAgICAgICAgY29uc3QgZWxlcGhhbnRSID0gZW5lbXlJbmZvLnI7DQogICAgICAgICAgICBjb25zdCBlbGVwaGFudEMgPSBlbmVteUluZm8uYzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g6LGh55y85L2N572u77ya6LGh55qE5ZGo5Zu0NOS4quaWueWQkeeahOixoeecvOS9jee9rg0KICAgICAgICAgICAgY29uc3QgZXllUG9zaXRpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgcjogZWxlcGhhbnRSICsgMSwgYzogZWxlcGhhbnRDICsgMSB9LCAvLyDlj7PkuIvosaHnnLwNCiAgICAgICAgICAgICAgICB7IHI6IGVsZXBoYW50UiArIDEsIGM6IGVsZXBoYW50QyAtIDEgfSwgLy8g5bem5LiL6LGh55y8DQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgLSAxLCBjOiBlbGVwaGFudEMgKyAxIH0sIC8vIOWPs+S4iuixoeecvA0KICAgICAgICAgICAgICAgIHsgcjogZWxlcGhhbnRSIC0gMSwgYzogZWxlcGhhbnRDIC0gMSB9ICAvLyDlt6bkuIrosaHnnLwNCiAgICAgICAgICAgIF07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOajgOafpeW9k+WJjeaji+WtkOaYr+WQpuWcqOixoeecvOS9jee9rg0KICAgICAgICAgICAgZm9yIChjb25zdCBleWVQb3Mgb2YgZXllUG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgaWYgKGV5ZVBvcy5yID09PSByICYmIGV5ZVBvcy5jID09PSBjKSB7DQogICAgICAgICAgICAgICAgICAgIGJsb2NrVmFsdWUgKz0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmJsb2NrLmVuZW15RWxlcGhhbnRCbG9ja1ZhbHVlOyAvLyDloLXloZ7osaHnnLzvvIzlop7liqDmiJjmnK/lgLwNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8gMi4g6Zi75oyh5bex5pa577yI5omj5YiG77yJDQogICAgLy8gMi4xIOajgOafpeaYr+WQpumYu+aMoeW3seaWuei9pueahOmBk+i3rw0KICAgIGZvciAoY29uc3QgYWxseUluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoYWxseUluZm8ucGllY2UuY29sb3IgPT09IHBpZWNlLmNvbG9yICYmIGFsbHlJbmZvICE9PSBpbmZvICYmIGFsbHlJbmZvLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkNIQVJJT1QpIHsNCiAgICAgICAgICAgIC8vIOajgOafpei9puWSjOW9k+WJjeaji+WtkOaYr+WQpuWcqOWQjOS4gOebtOe6v+S4ig0KICAgICAgICAgICAgaWYgKGFsbHlJbmZvLnIgPT09IHIgfHwgYWxseUluZm8uYyA9PT0gYykgew0KICAgICAgICAgICAgICAgIC8vIOajgOafpeS4pOiAheS5i+mXtOaYr+WQpuayoeacieWFtuWug+aji+WtkA0KICAgICAgICAgICAgICAgIGxldCBpc0Jsb2NraW5nID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoYWxseUluZm8uciA9PT0gcikgew0KICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDooYwNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbihhbGx5SW5mby5jLCBjKSArIDE7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KGFsbHlJbmZvLmMsIGMpIC0gMTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgY29sID0gc3RhcnQ7IGNvbCA8PSBlbmQ7IGNvbCsrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiZXR3ZWVuUGllY2UgPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHIgJiYgcC5jID09PSBjb2wpOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJldHdlZW5QaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQmxvY2tpbmcgPSBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWQjOS4gOWIlw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKGFsbHlJbmZvLnIsIHIpICsgMTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoYWxseUluZm8uciwgcikgLSAxOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCByb3cgPSBzdGFydDsgcm93IDw9IGVuZDsgcm93KyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJldHdlZW5QaWVjZSA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gcm93ICYmIHAuYyA9PT0gYyk7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoYmV0d2VlblBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNCbG9ja2luZyA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChpc0Jsb2NraW5nKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOmYu+aMoeW3seaWuei9pumBk+i3r++8jOaJo+WIhg0KICAgICAgICAgICAgICAgICAgICBibG9ja1ZhbHVlIC09IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5ibG9jay5hbGx5Q2hhcmlvdEJsb2NrUGVuYWx0eTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8gMi4yIOajgOafpeaYr+WQpuWIq+W3seaWuemprOeahOmprOiFvw0KICAgIGZvciAoY29uc3QgYWxseUluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoYWxseUluZm8ucGllY2UuY29sb3IgPT09IHBpZWNlLmNvbG9yICYmIGFsbHlJbmZvICE9PSBpbmZvICYmIGFsbHlJbmZvLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkhPUlNFKSB7DQogICAgICAgICAgICBjb25zdCBob3JzZVIgPSBhbGx5SW5mby5yOw0KICAgICAgICAgICAgY29uc3QgaG9yc2VDID0gYWxseUluZm8uYzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g6ams6IW/5L2N572u77ya6ams55qE5ZGo5Zu0OOS4quaWueWQkeeahOiFv+eahOS9jee9rg0KICAgICAgICAgICAgY29uc3QgbGVnUG9zaXRpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgcjogaG9yc2VSICsgMSwgYzogaG9yc2VDIH0sIC8vIOS4i+aWueiFvw0KICAgICAgICAgICAgICAgIHsgcjogaG9yc2VSIC0gMSwgYzogaG9yc2VDIH0sIC8vIOS4iuaWueiFvw0KICAgICAgICAgICAgICAgIHsgcjogaG9yc2VSLCBjOiBob3JzZUMgKyAxIH0sIC8vIOWPs+aWueiFvw0KICAgICAgICAgICAgICAgIHsgcjogaG9yc2VSLCBjOiBob3JzZUMgLSAxIH0gIC8vIOW3puaWueiFvw0KICAgICAgICAgICAgXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5qOA5p+l5b2T5YmN5qOL5a2Q5piv5ZCm5Zyo6ams6IW/5L2N572uDQogICAgICAgICAgICBmb3IgKGNvbnN0IGxlZ1BvcyBvZiBsZWdQb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBpZiAobGVnUG9zLnIgPT09IHIgJiYgbGVnUG9zLmMgPT09IGMpIHsNCiAgICAgICAgICAgICAgICAgICAgYmxvY2tWYWx1ZSAtPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuYmxvY2suYWxseUhvcnNlQmxvY2tQZW5hbHR5OyAvLyDliKvlt7Hmlrnpqazohb/vvIzmiaPliIYNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8gMi4zIOajgOafpeaYr+WQpuWgteWhnuW3seaWueixoeeahOixoeecvA0KICAgIGZvciAoY29uc3QgYWxseUluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoYWxseUluZm8ucGllY2UuY29sb3IgPT09IHBpZWNlLmNvbG9yICYmIGFsbHlJbmZvICE9PSBpbmZvICYmIGFsbHlJbmZvLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkVMRVBIQU5UKSB7DQogICAgICAgICAgICBjb25zdCBlbGVwaGFudFIgPSBhbGx5SW5mby5yOw0KICAgICAgICAgICAgY29uc3QgZWxlcGhhbnRDID0gYWxseUluZm8uYzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g6LGh55y85L2N572u77ya6LGh55qE5ZGo5Zu0NOS4quaWueWQkeeahOixoeecvOS9jee9rg0KICAgICAgICAgICAgY29uc3QgZXllUG9zaXRpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgcjogZWxlcGhhbnRSICsgMSwgYzogZWxlcGhhbnRDICsgMSB9LCAvLyDlj7PkuIvosaHnnLwNCiAgICAgICAgICAgICAgICB7IHI6IGVsZXBoYW50UiArIDEsIGM6IGVsZXBoYW50QyAtIDEgfSwgLy8g5bem5LiL6LGh55y8DQogICAgICAgICAgICAgICAgeyByOiBlbGVwaGFudFIgLSAxLCBjOiBlbGVwaGFudEMgKyAxIH0sIC8vIOWPs+S4iuixoeecvA0KICAgICAgICAgICAgICAgIHsgcjogZWxlcGhhbnRSIC0gMSwgYzogZWxlcGhhbnRDIC0gMSB9ICAvLyDlt6bkuIrosaHnnLwNCiAgICAgICAgICAgIF07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOajgOafpeW9k+WJjeaji+WtkOaYr+WQpuWcqOixoeecvOS9jee9rg0KICAgICAgICAgICAgZm9yIChjb25zdCBleWVQb3Mgb2YgZXllUG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgaWYgKGV5ZVBvcy5yID09PSByICYmIGV5ZVBvcy5jID09PSBjKSB7DQogICAgICAgICAgICAgICAgICAgIGJsb2NrVmFsdWUgLT0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmJsb2NrLmFsbHlFbGVwaGFudEJsb2NrUGVuYWx0eTsgLy8g5aC15aGe5bex5pa56LGh55y877yM5omj5YiGDQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIHJldHVybiBibG9ja1ZhbHVlOw0KfTsNCg0KDQovLyAtLS0gVHlwZXMgKElubGluZWQgdG8gYXZvaWQgaW1wb3J0IGlzc3VlcyBpbiBXb3JrZXIpIC0tLQ0KLy8gLy8gdHlwZSBDb2xvciAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgJ3JlZCcgfCAnYmxhY2snOw0KLy8gLy8gdHlwZSBQaWVjZVR5cGUgLSBUeXBlU2NyaXB0IHR5cGUgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5ICdnZW5lcmFsJyB8ICdhZHZpc29yJyB8ICdlbGVwaGFudCcgfCAnaG9yc2UnIHwgJ2NoYXJpb3QnIHwgJ2Nhbm5vbicgfCAnc29sZGllcic7DQovLyAvLyBpbnRlcmZhY2UgUGllY2UgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkNCi8vIC8vIGludGVyZmFjZSBQb3NpdGlvbiAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gaW50ZXJmYWNlIE1vdmUgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkNCi8vIC8vIHR5cGUgQm9hcmQgLSBUeXBlU2NyaXB0IHR5cGUgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5IChQaWVjZSB8IG51bGwpW11bXTsNCg0KLy8gLS0tIE9wZW5pbmcgQm9vayBUeXBlcyAtLS0NCi8vIE9wZW5pbmcgQm9vayBFbnRyeSAtIHJlcHJlc2VudHMgcG9zc2libGUgbW92ZXMgZm9yIGEgcG9zaXRpb24NCi8vIGludGVyZmFjZSBCb29rRW50cnkgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkNCg0KLy8gSW5kaXZpZHVhbCBtb3ZlIGluIG9wZW5pbmcgYm9vayB3aXRoIG1ldGFkYXRhDQovLyBpbnRlcmZhY2UgQm9va01vdmUgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkNCg0KLy8gLS0tIFpvYnJpc3QgSGFzaGluZyBmb3IgT3BlbmluZyBCb29rIC0tLQ0KLy8gRWFjaCBwaWVjZSB0eXBlL2NvbG9yL3Bvc2l0aW9uIGdldHMgYSB1bmlxdWUgcmFuZG9tIDUzLWJpdCBpbnRlZ2VyDQovLyBVc2VzIHNlZWRlZCBSTkcgZm9yIGRldGVybWluaXN0aWMgaGFzaGluZw0KY2xhc3MgWm9icmlzdEhhc2hlciB7DQogICAgaGFzaFRhYmxlOyAgLy8gW3Jvd11bY29sXVtwaWVjZUluZGV4XQ0KICAgIHBpZWNlVG9JbmRleDsNCg0KICAgIGNvbnN0cnVjdG9yKCkgew0KICAgICAgICB0aGlzLnBpZWNlVG9JbmRleCA9IG5ldyBNYXAoWw0KICAgICAgICAgICAgWydyZWQtZ2VuZXJhbCcsIDBdLA0KICAgICAgICAgICAgWydyZWQtYWR2aXNvcicsIDFdLA0KICAgICAgICAgICAgWydyZWQtZWxlcGhhbnQnLCAyXSwNCiAgICAgICAgICAgIFsncmVkLWhvcnNlJywgM10sDQogICAgICAgICAgICBbJ3JlZC1jaGFyaW90JywgNF0sDQogICAgICAgICAgICBbJ3JlZC1jYW5ub24nLCA1XSwNCiAgICAgICAgICAgIFsncmVkLXNvbGRpZXInLCA2XSwNCiAgICAgICAgICAgIFsnYmxhY2stZ2VuZXJhbCcsIDddLA0KICAgICAgICAgICAgWydibGFjay1hZHZpc29yJywgOF0sDQogICAgICAgICAgICBbJ2JsYWNrLWVsZXBoYW50JywgOV0sDQogICAgICAgICAgICBbJ2JsYWNrLWhvcnNlJywgMTBdLA0KICAgICAgICAgICAgWydibGFjay1jaGFyaW90JywgMTFdLA0KICAgICAgICAgICAgWydibGFjay1jYW5ub24nLCAxMl0sDQogICAgICAgICAgICBbJ2JsYWNrLXNvbGRpZXInLCAxM10sDQogICAgICAgIF0pOw0KDQogICAgICAgIC8vIEluaXRpYWxpemUgcmFuZG9tIGhhc2ggdmFsdWVzIHVzaW5nIHNlZWRlZCBSTkcgKDUzLWJpdCBpbnRlZ2VycyB0byBhdm9pZCBwcmVjaXNpb24gaXNzdWVzKQ0KICAgICAgICB0aGlzLmhhc2hUYWJsZSA9IFtdOw0KICAgICAgICBjb25zdCBNQVhfU0FGRSA9IDB4MUZGRkZGRkZGRkZGRkY7IC8vIDJeNTMgLSAxDQogICAgICAgIA0KICAgICAgICAvLyBTaW1wbGUgc2VlZGVkIFJORyAoTENHIC0gTGluZWFyIENvbmdydWVudGlhbCBHZW5lcmF0b3IpDQogICAgICAgIGxldCBzZWVkID0gMTIzNDU2Nzg5OyAvLyBGaXhlZCBzZWVkIGZvciBkZXRlcm1pbmlzdGljIGhhc2hpbmcNCiAgICAgICAgY29uc3Qgc2VlZGVkUmFuZG9tID0gKCkgPT4gew0KICAgICAgICAgICAgc2VlZCA9IChzZWVkICogMTEwMzUxNTI0NSArIDEyMzQ1KSAmIDB4N2ZmZmZmZmY7DQogICAgICAgICAgICByZXR1cm4gc2VlZCAvIDB4N2ZmZmZmZmY7DQogICAgICAgIH07DQoNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICB0aGlzLmhhc2hUYWJsZVtyXSA9IFtdOw0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsNCiAgICAgICAgICAgICAgICB0aGlzLmhhc2hUYWJsZVtyXVtjXSA9IFtdOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IHAgPSAwOyBwIDwgMTQ7IHArKykgew0KICAgICAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBkZXRlcm1pbmlzdGljIDUzLWJpdCBpbnRlZ2VyDQogICAgICAgICAgICAgICAgICAgIHRoaXMuaGFzaFRhYmxlW3JdW2NdW3BdID0gTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDb21wdXRlIGhhc2ggZm9yIGEgYm9hcmQgcG9zaXRpb24NCiAgICAgKi8NCiAgICBoYXNoKGJvYXJkKSB7DQogICAgICAgIGxldCBoID0gMDsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke3BpZWNlLmNvbG9yfS0ke3BpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGllY2VJZHggPSB0aGlzLnBpZWNlVG9JbmRleC5nZXQoa2V5KTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGggXj0gdGhpcy5oYXNoVGFibGVbcl1bY11bcGllY2VJZHhdOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBoOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIE1pcnJvciBhIGJvYXJkIGhvcml6b250YWxseSAoZm9yIHN5bW1ldHJ5IGRldGVjdGlvbikNCiAgICAgKi8NCiAgICBtaXJyb3JCb2FyZChib2FyZCkgew0KICAgICAgICBjb25zdCBtaXJyb3JlZCA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpKTsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgIG1pcnJvcmVkW3JdWzggLSBjXSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBtaXJyb3JlZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBNaXJyb3IgYSBtb3ZlIGhvcml6b250YWxseQ0KICAgICAqLw0KICAgIG1pcnJvck1vdmUobW92ZSkgew0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogOCAtIG1vdmUuZnJvbS5jIH0sDQogICAgICAgICAgICB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IDggLSBtb3ZlLnRvLmMgfQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEluY3JlbWVudGFsbHkgdXBkYXRlIGhhc2ggYWZ0ZXIgYSBtb3ZlIChtdWNoIGZhc3RlciB0aGFuIHJlaGFzaGluZykNCiAgICAgKi8NCiAgICB1cGRhdGVIYXNoKGN1cnJlbnRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWRQaWVjZSApIHsNCiAgICAgICAgbGV0IG5ld0hhc2ggPSBjdXJyZW50SGFzaDsNCg0KICAgICAgICAvLyBSZW1vdmUgcGllY2UgZnJvbSBzb3VyY2UgcG9zaXRpb24NCiAgICAgICAgY29uc3QgbW92aW5nSWR4ID0gdGhpcy5waWVjZVRvSW5kZXguZ2V0KG1vdmluZ1BpZWNlKTsNCiAgICAgICAgaWYgKG1vdmluZ0lkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY11bbW92aW5nSWR4XTsNCiAgICAgICAgfQ0KDQogICAgICAgIC8vIFJlbW92ZSBjYXB0dXJlZCBwaWVjZSBpZiBhbnkNCiAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkSWR4ID0gdGhpcy5waWVjZVRvSW5kZXguZ2V0KGNhcHR1cmVkUGllY2UpOw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUudG8ucl1bbW92ZS50by5jXVtjYXB0dXJlZElkeF07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICAvLyBBZGQgcGllY2UgdG8gZGVzdGluYXRpb24NCiAgICAgICAgaWYgKG1vdmluZ0lkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUudG8ucl1bbW92ZS50by5jXVttb3ZpbmdJZHhdOw0KICAgICAgICB9DQoNCiAgICAgICAgcmV0dXJuIG5ld0hhc2g7DQogICAgfQ0KfQ0KDQovKioNCiAqIE9wZW5pbmcgQm9vayBNYW5hZ2VyDQogKi8NCmNsYXNzIE9wZW5pbmdCb29rIHsNCiAgICBib29rOyAgLy8gWm9icmlzdCBoYXNoIC0+IG1vdmVzDQogICAgaGFzaGVyOw0KICAgIGVuYWJsZWQ7DQogICAgbWF4UGx5OyAgLy8gTWF4aW11bSBwbHkgdG8gdXNlIG9wZW5pbmcgYm9vayAoZS5nLiwgMjApDQoNCiAgICBjb25zdHJ1Y3RvcihtYXhQbHkgPSAxMikgew0KICAgICAgICB0aGlzLmJvb2sgPSBuZXcgTWFwKCk7DQogICAgICAgIHRoaXMuaGFzaGVyID0gbmV3IFpvYnJpc3RIYXNoZXIoKTsNCiAgICAgICAgdGhpcy5lbmFibGVkID0gdHJ1ZTsNCiAgICAgICAgdGhpcy5tYXhQbHkgPSBtYXhQbHk7DQogICAgICAgIHRoaXMuaW5pdGlhbGl6ZUJvb2soKTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBJbml0aWFsaXplIHdpdGggY29tbW9uIENoaW5lc2UgQ2hlc3Mgb3BlbmluZ3MNCiAgICAgKi8NCiAgICBpbml0aWFsaXplQm9vaygpIHsNCiAgICAgICAgLy8gQWRkIGNsYXNzaWMgQ2hpbmVzZSBDaGVzcyBvcGVuaW5ncyBtYW51YWxseQ0KICAgICAgICANCiAgICAgICAgLyoNCiAgICAgICAgLy8gMS4g5Lit54Ku6L+H5rKz6L2m5a+55bGP6aOO6ams5bmz54Ku5a+56L2mIChDZW50cmFsIENhbm5vbiB2cyBTY3JlZW4gSG9yc2VzKQ0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lKFsNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA3LCBjOiA3IH0sIHRvOiB7IHI6IDcsIGM6IDQgfSB9LCAgLy8gMS4g54Ku5LqM5bmz5LqUDQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogNyB9LCB0bzogeyByOiAyLCBjOiA2IH0gfSwgIC8vIDEuLi4g6amsOOi/mzcNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA3IH0sIHRvOiB7IHI6IDcsIGM6IDYgfSB9LCAgLy8gMi4g6ams5LqM6L+b5LiJDQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogOCB9LCB0bzogeyByOiAwLCBjOiA3IH0gfSwgIC8vIDIuLi4g6L2mOeW5szggICAgICAgICAgIA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDggfSwgdG86IHsgcjogOSwgYzogNyB9IH0sICAvLyAzLiDovabkuIDlubPkuowNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAzLCBjOiA2IH0sIHRvOiB7IHI6IDQsIGM6IDYgfSB9LCAgLy8gMy4uLiDljZI36L+bMQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDcgfSwgdG86IHsgcjogMywgYzogNyB9IH0sICAvLyA0LiDovabkuozov5vlha0NCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiAxIH0sIHRvOiB7IHI6IDIsIGM6IDIgfSB9LCAgLy8gNC4uLiDpqawy6L+bMw0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDYsIGM6IDIgfSwgdG86IHsgcjogNSwgYzogMiB9IH0sICAvLyA1LiDlhbXkuIPov5vkuIANCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAyLCBjOiA3IH0sIHRvOiB7IHI6IDIsIGM6IDggfSB9LCAgLy8gNS4uLiDngq445bmzOQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDMsIGM6IDcgfSwgdG86IHsgcjogMywgYzogNiB9IH0sICAvLyA2LiDovabkuozlubPkuIkNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAyLCBjOiA4IH0sIHRvOiB7IHI6IDEsIGM6IDggfSB9LCAgLy8gNi4uLiDngq456YCAMSAgICAgICAgICANCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCg0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKFsNCiAgICAgICAgICAgICfngq7kuozlubPkupQnLCAn6amsOOi/mzcnLCAn6ams5LqM6L+b5LiJJywgJ+i9pjnlubM4JywgJ+i9puS4gOW5s+S6jCcsICfljZI36L+bMScsDQogICAgICAgICAgICAn6L2m5LqM6L+b5YWtJywgJ+mprDLov5szJywgJ+WFteS4g+i/m+S4gCcsICfngq445bmzOScsICfovabkuozlubPkuIknLCAn54KuOemAgDEnLA0KICAgICAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCg0KICAgICAgICAgICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKFsNCiAgICAgICAgICAgICfngq7kuozlubPkupQg6amsOOi/mzcg6ams5LqM6L+b5LiJIOi9pjnlubM4IOi9puS4gOW5s+S6jCDljZI36L+bMSDovabkuozov5vlha0g6amsMui/mzMg5YW15LiD6L+b5LiAIOeCrjjlubM5IOi9puS6jOW5s+S4iSDngq456YCAMScNCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCiAgICAgICAgKi8NCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBBZGQgYW4gb3BlbmluZyBsaW5lIHRvIHRoZSBib29rDQogICAgICogQHBhcmFtIG1vdmVzIEFycmF5IG9mIG1vdmVzIHJlcHJlc2VudGluZyBhbiBvcGVuaW5nIGxpbmUNCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCB3ZWlnaHRzIGZvciBlYWNoIG1vdmUgKGRlZmF1bHQgMTAwIGZvciBhbGwpDQogICAgICovDQogICAgYWRkT3BlbmluZ0xpbmUobW92ZXMsIHdlaWdodHMpIHsNCiAgICAgICAgLy8gU3RhcnQgd2l0aCBpbml0aWFsIGJvYXJkIHBvc2l0aW9uDQogICAgICAgIGNvbnN0IGJvYXJkID0gdGhpcy5jcmVhdGVJbml0aWFsQm9hcmQoKTsNCiAgICAgICAgbGV0IGN1cnJlbnRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChib2FyZCk7DQoNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtb3Zlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2ldOw0KICAgICAgICAgICAgY29uc3Qgd2VpZ2h0ID0gd2VpZ2h0cz8uW2ldID8/IDEwMDsNCg0KICAgICAgICAgICAgLy8gR2V0IG9yIGNyZWF0ZSBib29rIGVudHJ5IGZvciB0aGlzIHBvc2l0aW9uDQogICAgICAgICAgICBsZXQgZW50cnkgPSB0aGlzLmJvb2suZ2V0KGN1cnJlbnRIYXNoKTsNCiAgICAgICAgICAgIGlmICghZW50cnkpIHsNCiAgICAgICAgICAgICAgICBlbnRyeSA9IHsgbW92ZXM6IFtdIH07DQogICAgICAgICAgICAgICAgdGhpcy5ib29rLnNldChjdXJyZW50SGFzaCwgZW50cnkpOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBBZGQgbW92ZSBpZiBub3QgYWxyZWFkeSBwcmVzZW50DQogICAgICAgICAgICBjb25zdCBleGlzdGluZ01vdmUgPSBlbnRyeS5tb3Zlcy5maW5kKA0KICAgICAgICAgICAgICAgIG0gPT4gbS5mcm9tLnIgPT09IG1vdmUuZnJvbS5yICYmIG0uZnJvbS5jID09PSBtb3ZlLmZyb20uYyAmJg0KICAgICAgICAgICAgICAgICAgICAgbS50by5yID09PSBtb3ZlLnRvLnIgJiYgbS50by5jID09PSBtb3ZlLnRvLmMNCiAgICAgICAgICAgICk7DQoNCiAgICAgICAgICAgIGlmICghZXhpc3RpbmdNb3ZlKSB7DQogICAgICAgICAgICAgICAgZW50cnkubW92ZXMucHVzaCh7DQogICAgICAgICAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sDQogICAgICAgICAgICAgICAgICAgIHRvOiB7IHI6IG1vdmUudG8uciwgYzogbW92ZS50by5jIH0sDQogICAgICAgICAgICAgICAgICAgIHdlaWdodDogd2VpZ2h0DQogICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSB3ZWlnaHQgaWYgbW92ZSBhbHJlYWR5IGV4aXN0cyAodGFrZSBtYXhpbXVtKQ0KICAgICAgICAgICAgICAgIGV4aXN0aW5nTW92ZS53ZWlnaHQgPSBNYXRoLm1heChleGlzdGluZ01vdmUud2VpZ2h0LCB3ZWlnaHQpOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBNYWtlIHRoZSBtb3ZlIG9uIHRoZSBib2FyZA0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBib2FyZFttb3ZlLnRvLnJdW21vdmUudG8uY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghcGllY2UpIGJyZWFrOyAvLyBJbnZhbGlkIGxpbmUNCg0KICAgICAgICAgICAgY29uc3QgcGllY2VLZXkgPSBgJHtwaWVjZS5jb2xvcn0tJHtwaWVjZS50eXBlfWA7DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGNhcHR1cmVkID8gYCR7Y2FwdHVyZWQuY29sb3J9LSR7Y2FwdHVyZWQudHlwZX1gIDogdW5kZWZpbmVkOw0KDQogICAgICAgICAgICAvLyBVcGRhdGUgaGFzaCBpbmNyZW1lbnRhbGx5DQogICAgICAgICAgICBjdXJyZW50SGFzaCA9IHRoaXMuaGFzaGVyLnVwZGF0ZUhhc2goY3VycmVudEhhc2gsIG1vdmUsIHBpZWNlS2V5LCBjYXB0dXJlZEtleSk7DQoNCiAgICAgICAgICAgIC8vIEFwcGx5IG1vdmUNCiAgICAgICAgICAgIGJvYXJkW21vdmUudG8ucl1bbW92ZS50by5jXSA9IHBpZWNlOw0KICAgICAgICAgICAgYm9hcmRbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXSA9IG51bGw7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBHZXQgYmVzdCBtb3ZlIGZyb20gb3BlbmluZyBib29rIGZvciBjdXJyZW50IHBvc2l0aW9uDQogICAgICogQHBhcmFtIGJvYXJkIEN1cnJlbnQgYm9hcmQgc3RhdGUNCiAgICAgKiBAcGFyYW0gcGx5IEN1cnJlbnQgcGx5IG51bWJlciAoMCA9IHN0YXJ0IG9mIGdhbWUpDQogICAgICogQHJldHVybnMgTW92ZSBmcm9tIGJvb2ssIG9yIG51bGwgaWYgcG9zaXRpb24gbm90IGluIGJvb2sNCiAgICAgKi8NCiAgICBnZXRCb29rTW92ZShib2FyZCwgcGx5KXsNCiAgICAgICAgLy8gRG9uJ3QgdXNlIGJvb2sgaWYgZGlzYWJsZWQgb3IgcGFzdCBtYXggcGx5DQogICAgICAgIGlmICghdGhpcy5lbmFibGVkIHx8IHBseSA+PSB0aGlzLm1heFBseSkgew0KICAgICAgICAgICAgY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBkaXNhYmxlZCBvciBwYXN0IG1heCBwbHknLCB7IGVuYWJsZWQ6IHRoaXMuZW5hYmxlZCwgbWF4UGx5OiB0aGlzLm1heFBseSwgcGx5OiBwbHkgfSk7DQogICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy9jb25zb2xlLmxvZygnT3BlbmluZyBib29rIGdldEJvb2tNb3ZlIGNhbGxlZCcsIHsgcGx5IH0pOw0KICAgICAgICANCiAgICAgICAgLy8gVHJ5IHRvIGZpbmQgbW92ZSBmb3IgY3VycmVudCBwb3NpdGlvbg0KICAgICAgICBjb25zdCBoYXNoID0gdGhpcy5oYXNoZXIuaGFzaChib2FyZCk7DQogICAgICAgIC8vY29uc29sZS5sb2coJ0N1cnJlbnQgcG9zaXRpb24gaGFzaDonLCBoYXNoKTsNCiAgICAgICAgDQogICAgICAgIGxldCBlbnRyeSA9IHRoaXMuYm9vay5nZXQoaGFzaCk7DQogICAgICAgIC8vY29uc29sZS5sb2coJ0VudHJ5IGZvdW5kIGZvciBjdXJyZW50IGhhc2g6JywgZW50cnkgPyBlbnRyeS5tb3Zlcy5sZW5ndGggKyAnIG1vdmVzJyA6ICdudWxsJyk7DQogICAgICAgIGlmIChlbnRyeSAmJiBlbnRyeS5tb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnQWxsIHBvc3NpYmxlIGJvb2sgbW92ZXMgd2l0aCB3ZWlnaHRzOicsIEpTT04uc3RyaW5naWZ5KGVudHJ5Lm1vdmVzKSk7DQogICAgICAgICAgICAvLyBDYWxjdWxhdGUgdG90YWwgd2VpZ2h0DQogICAgICAgICAgICBjb25zdCB0b3RhbFdlaWdodCA9IGVudHJ5Lm1vdmVzLnJlZHVjZSgoc3VtLCBtb3ZlKSA9PiBzdW0gKyBtb3ZlLndlaWdodCwgMCk7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnVG90YWwgd2VpZ2h0OicsIHRvdGFsV2VpZ2h0KTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgbGV0IG1pcnJvcmVkTW92ZSA9IGZhbHNlOw0KDQogICAgICAgIC8vIElmIG5vdCBmb3VuZCwgdHJ5IG1pcnJvcmVkIHBvc2l0aW9uDQogICAgICAgIGlmICghZW50cnkgfHwgZW50cnkubW92ZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICBjb25zdCBtaXJyb3JlZEJvYXJkID0gdGhpcy5oYXNoZXIubWlycm9yQm9hcmQoYm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgbWlycm9yZWRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChtaXJyb3JlZEJvYXJkKTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdObyBlbnRyeSBmb3VuZCwgdHJ5aW5nIG1pcnJvcmVkIHBvc2l0aW9uOicsIG1pcnJvcmVkSGFzaCk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGVudHJ5ID0gdGhpcy5ib29rLmdldChtaXJyb3JlZEhhc2gpOw0KICAgICAgICAgICAgaWYgKGVudHJ5ICYmIGVudHJ5Lm1vdmVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdFbnRyeSBmb3VuZCBmb3IgbWlycm9yZWQgaGFzaDonLCBlbnRyeS5tb3Zlcy5sZW5ndGggKyAnIG1vdmVzJyk7DQogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnT3JpZ2luYWwgbWlycm9yIG1vdmVzOicsIEpTT04uc3RyaW5naWZ5KGVudHJ5Lm1vdmVzKSk7DQogICAgICAgICAgICAgICAgbWlycm9yZWRNb3ZlID0gdHJ1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnTm8gZW50cnkgZm91bmQgZm9yIG1pcnJvcmVkIGhhc2gnKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIGlmICghZW50cnkgfHwgZW50cnkubW92ZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgbW92ZSBub3QgZm91bmQgZm9yIGN1cnJlbnQgcG9zaXRpb24nKTsNCiAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICB9DQoNCiAgICAgICAgLy8gU2VsZWN0IG1vdmUgYmFzZWQgb24gd2VpZ2h0cw0KICAgICAgICBjb25zdCBzZWxlY3RlZE1vdmUgPSB0aGlzLnNlbGVjdFdlaWdodGVkTW92ZShlbnRyeS5tb3Zlcyk7DQogICAgICAgIGNvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgbW92ZSBzZWxlY3RlZDonLCBzZWxlY3RlZE1vdmUpOw0KICAgICAgICANCiAgICAgICAgLy8gSWYgd2UgdXNlZCBtaXJyb3JlZCBwb3NpdGlvbiwgbWlycm9yIHRoZSBtb3ZlIGJhY2sNCiAgICAgICAgaWYgKHNlbGVjdGVkTW92ZSAmJiBtaXJyb3JlZE1vdmUpIHsNCiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdTZWxlY3RlZCBtaXJyb3IgbW92ZSBiZWZvcmUgY29udmVyc2lvbjonLCBKU09OLnN0cmluZ2lmeShzZWxlY3RlZE1vdmUpKTsNCiAgICAgICAgICAgIGNvbnN0IG1pcnJvcmVkTW92ZUNvbnZlcnRlZCA9IHRoaXMuaGFzaGVyLm1pcnJvck1vdmUoc2VsZWN0ZWRNb3ZlKTsNCiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdDb252ZXJ0ZWQgbWlycm9yIG1vdmU6JywgSlNPTi5zdHJpbmdpZnkobWlycm9yZWRNb3ZlQ29udmVydGVkKSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBtaXJyb3JlZCBtb3ZlIGhhcyB2YWxpZCBzdHJ1Y3R1cmUNCiAgICAgICAgICAgIGlmIChtaXJyb3JlZE1vdmVDb252ZXJ0ZWQgJiYgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20gJiYgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50by5jID09PSAnbnVtYmVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQ7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdNaXJyb3JlZCBtb3ZlIGhhcyBpbnZhbGlkIHN0cnVjdHVyZSwgcmV0dXJuaW5nIG51bGwnKTsNCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmIChzZWxlY3RlZE1vdmUpIHsNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBzZWxlY3RlZCBtb3ZlIGhhcyB2YWxpZCBzdHJ1Y3R1cmUNCiAgICAgICAgICAgIGlmIChzZWxlY3RlZE1vdmUuZnJvbSAmJiBzZWxlY3RlZE1vdmUudG8gJiYNCiAgICAgICAgICAgICAgICB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLmZyb20uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIHNlbGVjdGVkTW92ZS5mcm9tLmMgPT09ICdudW1iZXInICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIHNlbGVjdGVkTW92ZS50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHNlbGVjdGVkTW92ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlbGVjdGVkIG1vdmUgaGFzIGludmFsaWQgc3RydWN0dXJlLCByZXR1cm5pbmcgbnVsbCcpOw0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICByZXR1cm4gbnVsbDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBTZWxlY3QgYSBtb3ZlIHJhbmRvbWx5IGJhc2VkIG9uIHdlaWdodHMNCiAgICAgKiBIaWdoZXIgd2VpZ2h0ID0gbW9yZSBsaWtlbHkgdG8gYmUgc2VsZWN0ZWQNCiAgICAgKi8NCiAgICBzZWxlY3RXZWlnaHRlZE1vdmUobW92ZXMpIHsNCiAgICAgICAgLy8gQ2FsY3VsYXRlIHRvdGFsIHdlaWdodA0KICAgICAgICBjb25zdCB0b3RhbFdlaWdodCA9IG1vdmVzLnJlZHVjZSgoc3VtLCBtb3ZlKSA9PiBzdW0gKyBtb3ZlLndlaWdodCwgMCk7DQoNCiAgICAgICAgLy8gR2VuZXJhdGUgcmFuZG9tIG51bWJlcg0KICAgICAgICBsZXQgcmFuZG9tID0gTWF0aC5yYW5kb20oKSAqIHRvdGFsV2VpZ2h0Ow0KDQogICAgICAgIC8vIFNlbGVjdCBtb3ZlDQogICAgICAgIGZvciAoY29uc3QgbW92ZSBvZiBtb3Zlcykgew0KICAgICAgICAgICAgcmFuZG9tIC09IG1vdmUud2VpZ2h0Ow0KICAgICAgICAgICAgaWYgKHJhbmRvbSA8PSAwKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogbW92ZS5mcm9tLmMgfSwgdG86IHsgcjogbW92ZS50by5yLCBjOiBtb3ZlLnRvLmMgfQ0KICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICAvLyBGYWxsYmFjayAoc2hvdWxkIG5ldmVyIHJlYWNoIGhlcmUpDQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmVzWzBdLmZyb20uciwgYzogbW92ZXNbMF0uZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmVzWzBdLnRvLnIsIGM6IG1vdmVzWzBdLnRvLmMgfQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEhlbHBlciB0byBjcmVhdGUgaW5pdGlhbCBib2FyZCAobmVlZGVkIGZvciBib29rIGluaXRpYWxpemF0aW9uKQ0KICAgICAqLw0KICAgIGNyZWF0ZUluaXRpYWxCb2FyZCgpIHsNCiAgICAgICAgY29uc3QgYm9hcmQgPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKSk7DQogICAgICAgIA0KICAgICAgICAvLyBSZWQgcGllY2VzIChib3R0b20gLSByPTAtMikNCiAgICAgICAgYm9hcmRbMF1bMF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzFdID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bMl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVszXSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bNF0gPSB7IHR5cGU6ICdnZW5lcmFsJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzVdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs2XSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzddID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bOF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzJdWzFdID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzJdWzddID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzBdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVsyXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bNF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzZdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVs4XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCg0KICAgICAgICAvLyBCbGFjayBwaWVjZXMgKHRvcCAtIHI9Ny05KQ0KICAgICAgICBib2FyZFs5XVswXSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVsxXSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bMl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzNdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzRdID0geyB0eXBlOiAnZ2VuZXJhbCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzVdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzZdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs3XSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bOF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbN11bMV0gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs3XVs3XSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzBdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzJdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzRdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzZdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzhdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQoNCiAgICAgICAgcmV0dXJuIGJvYXJkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEVuYWJsZSBvciBkaXNhYmxlIG9wZW5pbmcgYm9vaw0KICAgICAqLw0KICAgIHNldEVuYWJsZWQoZW5hYmxlZCkgew0KICAgICAgICB0aGlzLmVuYWJsZWQgPSBlbmFibGVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENoZWNrIGlmIG9wZW5pbmcgYm9vayBpcyBlbmFibGVkDQogICAgICovDQogICAgaXNFbmFibGVkKCkgew0KICAgICAgICByZXR1cm4gdGhpcy5lbmFibGVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEdldCBzdGF0aXN0aWNzIGFib3V0IHRoZSBvcGVuaW5nIGJvb2sNCiAgICAgKi8NCiAgICBnZXRTdGF0cygpIHsNCiAgICAgICAgbGV0IHRvdGFsTW92ZXMgPSAwOw0KICAgICAgICB0aGlzLmJvb2suZm9yRWFjaChlbnRyeSA9PiB7DQogICAgICAgICAgICB0b3RhbE1vdmVzICs9IGVudHJ5Lm1vdmVzLmxlbmd0aDsNCiAgICAgICAgfSk7DQoNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIHBvc2l0aW9uczogdGhpcy5ib29rLnNpemUsDQogICAgICAgICAgICB0b3RhbE1vdmVzDQogICAgICAgIH07DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQWRkIG9wZW5pbmcgbGluZSBmcm9tIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24NCiAgICAgKiBAcGFyYW0gbm90YXRpb24gQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uIChlLmcuLCBbJ+eCruS6jOW5s+S6lCcsICfpqaw46L+bNyddKQ0KICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIGFycmF5IG9mIHdlaWdodHMgZm9yIGVhY2ggbW92ZQ0KICAgICAqLw0KICAgIGFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKG5vdGF0aW9uLCB3ZWlnaHRzKSB7DQogICAgICAgIC8vIENvbnZlcnQgdHJhZGl0aW9uYWwgbm90YXRpb24gdG8gY29vcmRpbmF0ZSBmb3JtYXQNCiAgICAgICAgY29uc3QgbW92ZXMgPSB0aGlzLm5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvbik7DQogICAgICAgIC8vIEFkZCB0aGUgbW92ZXMgdG8gdGhlIG9wZW5pbmcgYm9vaw0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lKG1vdmVzLCB3ZWlnaHRzKTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBBZGQgb3BlbmluZyBsaW5lIGZyb20gc3RyaW5nIHdpdGggc3BhY2Utc2VwYXJhdGVkIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24NCiAgICAgKiBAcGFyYW0gbm90YXRpb25BcnJheSBBcnJheSBvZiBzdHJpbmdzLCBlYWNoIGNvbnRhaW5pbmcgc3BhY2Utc2VwYXJhdGVkIG1vdmVzIChlLmcuLCBbJ+eCruS6jOW5s+S6lCDpqaw46L+bNyDovabkuIDlubPkuownXSkNCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCBhcnJheSBvZiB3ZWlnaHRzIGZvciBlYWNoIG1vdmUNCiAgICAgKi8NCiAgICBhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcobm90YXRpb25BcnJheSwgd2VpZ2h0cykgew0KICAgICAgICAvLyBQcm9jZXNzIGVhY2ggc3RyaW5nIGluIHRoZSBhcnJheQ0KICAgICAgICBpZiAoIW5vdGF0aW9uQXJyYXkgfHwgIUFycmF5LmlzQXJyYXkobm90YXRpb25BcnJheSkgfHwgbm90YXRpb25BcnJheS5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgfQ0KICAgICAgICBub3RhdGlvbkFycmF5LmZvckVhY2gobm90YXRpb25TdHJpbmcgPT4gew0KICAgICAgICAgICAgLy8gU3BsaXQgdGhlIHN0cmluZyBieSBzcGFjZXMgdG8gZ2V0IGluZGl2aWR1YWwgbW92ZXMNCiAgICAgICAgICAgIGNvbnN0IG5vdGF0aW9uID0gbm90YXRpb25TdHJpbmcuc3BsaXQoJyAnKS5maWx0ZXIobW92ZSA9PiBtb3ZlLnRyaW0oKSAhPT0gJycpOw0KICAgICAgICAgICAgLy8gQ2FsbCBleGlzdGluZyBmdW5jdGlvbiB0byBhZGQgdGhlIGxpbmUNCiAgICAgICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tTm90YXRpb24obm90YXRpb24sIHdlaWdodHMpOw0KICAgICAgICB9KTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDb252ZXJ0IGNvb3JkaW5hdGUtYmFzZWQgbW92ZXMgdG8gdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbg0KICAgICAqIEBwYXJhbSBib2FyZEhpc3RvcnkgQXJyYXkgb2YgYm9hcmQgc3RhdGVzIHJlcHJlc2VudGluZyB0aGUgZ2FtZSBoaXN0b3J5DQogICAgICogQHBhcmFtIG1vdmVIaXN0b3J5IEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0DQogICAgICogQHJldHVybnMgQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uDQogICAgICovDQogICAgbW92ZXNUb05vdGF0aW9uKGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkpIHsNCiAgICAgICAgY29uc3Qgbm90YXRpb24gPSBbXTsNCiAgICAgICAgbGV0IGN1cnJlbnRDb2xvciA9ICdyZWQnOyAvLyBSZWQgbW92ZXMgZmlyc3QNCg0KICAgICAgICAvLyBUeXBlIHRvIHBpZWNlIGNoYXJhY3RlciBtYXBwaW5nDQogICAgICAgIGNvbnN0IHR5cGVUb1BpZWNlID0gew0KICAgICAgICAgICAgJ2dlbmVyYWwnOiB7ICdyZWQnOiAn5biFJywgJ2JsYWNrJzogJ+WwhicgfSwNCiAgICAgICAgICAgICdhZHZpc29yJzogeyAncmVkJzogJ+S7lScsICdibGFjayc6ICflo6snIH0sDQogICAgICAgICAgICAnZWxlcGhhbnQnOiB7ICdyZWQnOiAn55u4JywgJ2JsYWNrJzogJ+ixoScgfSwNCiAgICAgICAgICAgICdob3JzZSc6IHsgJ3JlZCc6ICfpqawnLCAnYmxhY2snOiAn6amsJyB9LA0KICAgICAgICAgICAgJ2NoYXJpb3QnOiB7ICdyZWQnOiAn6L2mJywgJ2JsYWNrJzogJ+i9picgfSwNCiAgICAgICAgICAgICdjYW5ub24nOiB7ICdyZWQnOiAn54KuJywgJ2JsYWNrJzogJ+eCricgfSwNCiAgICAgICAgICAgICdzb2xkaWVyJzogeyAncmVkJzogJ+WFtScsICdibGFjayc6ICfljZInIH0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDb2x1bW4gbWFwcGluZyAoY29vcmRpbmF0ZSAwLTggdG8gdHJhZGl0aW9uYWwg5LmdLeS4gCBmb3IgcmVkLCA5LTEgZm9yIGJsYWNrKQ0KICAgICAgICBjb25zdCBjb2xUb0NoaW5lc2UgPSBbJ+S5nScsICflhasnLCAn5LiDJywgJ+WFrScsICfkupQnLCAn5ZubJywgJ+S4iScsICfkuownLCAn5LiAJ107DQogICAgICAgIGNvbnN0IGNvbFRvQXJhYmljID0gWyc5JywgJzgnLCAnNycsICc2JywgJzUnLCAnNCcsICczJywgJzInLCAnMSddOw0KDQogICAgICAgIC8vIERpZ2l0IHRvIENoaW5lc2UgbnVtYmVyIG1hcHBpbmcgZm9yIHN0ZXBzDQogICAgICAgIGNvbnN0IGRpZ2l0VG9DaGluZXNlID0gWycnLCAn5LiAJywgJ+S6jCcsICfkuIknLCAn5ZubJywgJ+S6lCcsICflha0nLCAn5LiDJywgJ+WFqycsICfkuZ0nXTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY2hlY2sgaWYgdGhlcmUgYXJlIG11bHRpcGxlIHNhbWUtdHlwZSBwaWVjZXMgaW4gdGhlIHNhbWUgY29sdW1uDQogICAgICAgIGNvbnN0IGhhc1NhbWVUeXBlSW5Db2x1bW4gPSAoYm9hcmQsIHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgZXhjbHVkZVJvdykgPT4gew0KICAgICAgICAgICAgbGV0IGNvdW50ID0gMDsNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY29sXTsNCiAgICAgICAgICAgICAgICBpZiAociA9PT0gZXhjbHVkZVJvdykgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09IHBpZWNlVHlwZSAmJiBwaWVjZS5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgY291bnQrKzsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICByZXR1cm4gY291bnQgPiAwOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBkZXRlcm1pbmUgZnJvbnQvYmFjayBtYXJrZXINCiAgICAgICAgY29uc3QgZ2V0RnJvbnRCYWNrTWFya2VyID0gKGJvYXJkLCBwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGN1cnJlbnRSb3cpID0+IHsNCiAgICAgICAgICAgIGNvbnN0IHNhbWVUeXBlUGllY2VzID0gW107DQogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NvbF07DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09IHBpZWNlVHlwZSAmJiBwaWVjZS5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgc2FtZVR5cGVQaWVjZXMucHVzaChyKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAoc2FtZVR5cGVQaWVjZXMubGVuZ3RoIDw9IDEpIHJldHVybiAnJzsNCiAgICAgICAgICAgIGlmIChjb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIhyPTctOe+8ie+8jHLlgLzotorlpKfotorpnaDov5HmlYzmlrnvvIzmmK8i5YmNIg0KICAgICAgICAgICAgICAgIGNvbnN0IHNvcnRlZFJvd3MgPSBbLi4uc2FtZVR5cGVQaWVjZXNdLnNvcnQoKGEsIGIpID0+IGIgLSBhKTsgLy8gSGlnaGVyIHJvd3MgZmlyc3QgPSBjbG9zZXIgdG8gb3Bwb25lbnQNCiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkUm93c1swXSA9PT0gY3VycmVudFJvdyA/ICfliY0nIDogJ+WQjic7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8iHI9MC0y77yJ77yMcuWAvOi2iuWwj+i2iumdoOi/keaVjOaWue+8jOaYryLliY0iDQogICAgICAgICAgICAgICAgY29uc3Qgc29ydGVkUm93cyA9IFsuLi5zYW1lVHlwZVBpZWNlc10uc29ydCgoYSwgYikgPT4gYSAtIGIpOyAvLyBMb3dlciByb3dzIGZpcnN0ID0gY2xvc2VyIHRvIG9wcG9uZW50DQogICAgICAgICAgICAgICAgcmV0dXJuIHNvcnRlZFJvd3NbMF0gPT09IGN1cnJlbnRSb3cgPyAn5YmNJyA6ICflkI4nOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIFByb2Nlc3MgZWFjaCBtb3ZlDQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW92ZUhpc3RvcnkubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IG1vdmUgPSBtb3ZlSGlzdG9yeVtpXTsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkQmVmb3JlID0gYm9hcmRIaXN0b3J5W2ldOw0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZEJlZm9yZVttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoIXBpZWNlKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gcGllY2UgZm91bmQgYXQgZnJvbSBwb3NpdGlvbjonLCBtb3ZlLmZyb20pOw0KICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZS50eXBlOw0KICAgICAgICAgICAgY29uc3QgcGllY2VDaGFyID0gdHlwZVRvUGllY2VbcGllY2VUeXBlXVtwaWVjZS5jb2xvcl07DQogICAgICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUgYXJlIG11bHRpcGxlIHNhbWUtdHlwZSBwaWVjZXMgaW4gdGhlIHNhbWUgY29sdW1uDQogICAgICAgICAgICBjb25zdCBoYXNEdXBsaWNhdGUgPSBoYXNTYW1lVHlwZUluQ29sdW1uKGJvYXJkQmVmb3JlLCBwaWVjZVR5cGUsIHBpZWNlLmNvbG9yLCBtb3ZlLmZyb20uYywgbW92ZS5mcm9tLnIpOw0KICAgICAgICAgICAgLy8gR2V0IGZyb250L2JhY2sgbWFya2VyIGlmIG5lZWRlZA0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25NYXJrZXIgPSBoYXNEdXBsaWNhdGUgPyBnZXRGcm9udEJhY2tNYXJrZXIoYm9hcmRCZWZvcmUsIHBpZWNlVHlwZSwgcGllY2UuY29sb3IsIG1vdmUuZnJvbS5jLCBtb3ZlLmZyb20ucikgOiAnJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gRGV0ZXJtaW5lIG5vdGF0aW9uIGJhc2VkIG9uIHBpZWNlIHR5cGUgYW5kIG1vdmUgZGlyZWN0aW9uDQogICAgICAgICAgICBsZXQgbm90YXRpb25TdHI7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdob3JzZScgfHwgcGllY2VUeXBlID09PSAnYWR2aXNvcicgfHwgcGllY2VUeXBlID09PSAnZWxlcGhhbnQnKSB7DQogICAgICAgICAgICAgICAgLy8gRGlhZ29uYWwgbW92aW5nIHBpZWNlcyAtIG9ubHkgdXNlIOi/my/pgIAsIHJlY29yZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6L+b77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSBtb3ZlLnRvLnIgPiBtb3ZlLmZyb20uciA/ICfov5snIDogJ+mAgCc7DQogICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnku47lj7PlvoDlt6bmmK8xLTnvvIzpnIDopoHlj43ovazliJfmmKDlsIQNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8iHI9MO+8ie+8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/ov5vvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IG1vdmUudG8uciA8IG1vdmUuZnJvbS5yID8gJ+i/mycgOiAn6YCAJzsNCiAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcgfHwgcGllY2VUeXBlID09PSAnY2hhcmlvdCcgfHwgcGllY2VUeXBlID09PSAnY2Fubm9uJyB8fCBwaWVjZVR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIC8vIFN0cmFpZ2h0IG1vdmluZyBwaWVjZXMgLSDov5sv6YCAL+W5sw0KICAgICAgICAgICAgICAgIGlmIChtb3ZlLmZyb20uYyA9PT0gbW92ZS50by5jKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIG1vdmUgLSDov5sv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXBzID0gTWF0aC5hYnMobW92ZS50by5yIC0gbW92ZS5mcm9tLnIpOw0KICAgICAgICAgICAgICAgICAgICAvLyDov5vmmK/pnaDov5HmlYzmlrnnmoTmlrnlkJHvvIzpgIDmmK/ov5znprvmlYzmlrnnmoTmlrnlkJENCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+i/m++8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+i/m++8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gKGlzUmVkID8gbW92ZS50by5yID4gbW92ZS5mcm9tLnIgOiBtb3ZlLnRvLnIgPCBtb3ZlLmZyb20ucikgPyAn6L+bJyA6ICfpgIAnOw0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBzdGVwcyBpcyBhIHZhbGlkIG51bWJlciBiZXR3ZWVuIDEtOQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsaWRTdGVwcyA9IE1hdGgubWF4KDEsIE1hdGgubWluKDksIE1hdGgucm91bmQoc3RlcHMgfHwgMSkpKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7ZGlnaXRUb0NoaW5lc2VbdmFsaWRTdGVwc10gfHwgJyd9YDsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhA0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY107DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgc3RlcHMgaXMgYSB2YWxpZCBudW1iZXINCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkU3RlcHMgPSBNYXRoLnJvdW5kKHN0ZXBzIHx8IDEpOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt2YWxpZFN0ZXBzfWA7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIG1vdmUgLSDlubMNCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9DaGluZXNlW21vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH3lubMke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnku47lj7PlvoDlt6bmmK8xLTnvvIzpnIDopoHlj43ovazliJfmmKDlsIQNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfeW5syR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignVW5rbm93biBwaWVjZSB0eXBlOicsIHBpZWNlVHlwZSk7DQogICAgICAgICAgICAgICAgY29udGludWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIG5vdGF0aW9uLnB1c2gobm90YXRpb25TdHIpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBTd2l0Y2ggY29sb3IgZm9yIG5leHQgbW92ZQ0KICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgcmV0dXJuIG5vdGF0aW9uOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENvbnZlcnQgdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbiB0byBjb29yZGluYXRlIG1vdmVzDQogICAgICogQHBhcmFtIG5vdGF0aW9uIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbg0KICAgICAqIEByZXR1cm5zIEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0DQogICAgICovDQogICAgbm90YXRpb25Ub01vdmVzKG5vdGF0aW9uLCBpbml0aWFsQm9hcmQgPSBudWxsKSB7DQogICAgICAgIC8vIOehruS/nW5vdGF0aW9u5piv5pWw57uE5LiU5LiN5Li656m6DQogICAgICAgIGlmICghbm90YXRpb24gfHwgIUFycmF5LmlzQXJyYXkobm90YXRpb24pIHx8IG5vdGF0aW9uLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgcmV0dXJuIFtdOw0KICAgICAgICB9DQogICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgIGxldCBjdXJyZW50Q29sb3IgPSAncmVkJzsgLy8gUmVkIG1vdmVzIGZpcnN0DQoNCiAgICAgICAgLy8gUGllY2UgY2hhcmFjdGVyIHRvIHR5cGUgbWFwcGluZw0KICAgICAgICBjb25zdCBwaWVjZU1hcCA9IHsNCiAgICAgICAgICAgICflsIYnOiAnZ2VuZXJhbCcsICfluIUnOiAnZ2VuZXJhbCcsDQogICAgICAgICAgICAn5aOrJzogJ2Fkdmlzb3InLCAn5LuVJzogJ2Fkdmlzb3InLA0KICAgICAgICAgICAgJ+ixoSc6ICdlbGVwaGFudCcsICfnm7gnOiAnZWxlcGhhbnQnLA0KICAgICAgICAgICAgJ+mprCc6ICdob3JzZScsDQogICAgICAgICAgICAn6L2mJzogJ2NoYXJpb3QnLA0KICAgICAgICAgICAgJ+eCric6ICdjYW5ub24nLA0KICAgICAgICAgICAgJ+WNkic6ICdzb2xkaWVyJywgJ+WFtSc6ICdzb2xkaWVyJw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENvbHVtbiBtYXBwaW5nICh0cmFkaXRpb25hbCBub3RhdGlvbiB1c2VzIDEtOSBmcm9tIHJpZ2h0IHRvIGxlZnQpDQogICAgICAgIGNvbnN0IGNvbE1hcCA9IHsNCiAgICAgICAgICAgICfkuIAnOiA4LCAnMSc6IDgsDQogICAgICAgICAgICAn5LqMJzogNywgJzInOiA3LA0KICAgICAgICAgICAgJ+S4iSc6IDYsICczJzogNiwNCiAgICAgICAgICAgICflm5snOiA1LCAnNCc6IDUsDQogICAgICAgICAgICAn5LqUJzogNCwgJzUnOiA0LA0KICAgICAgICAgICAgJ+WFrSc6IDMsICc2JzogMywNCiAgICAgICAgICAgICfkuIMnOiAyLCAnNyc6IDIsDQogICAgICAgICAgICAn5YWrJzogMSwgJzgnOiAxLA0KICAgICAgICAgICAgJ+S5nSc6IDAsICc5JzogMA0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENoaW5lc2UgbnVtYmVyIHRvIGRpZ2l0IG1hcHBpbmcNCiAgICAgICAgY29uc3QgY2hpbmVzZU51bWJlck1hcCA9IHsNCiAgICAgICAgICAgICfkuIAnOiAxLCAnMSc6IDEsDQogICAgICAgICAgICAn5LqMJzogMiwgJzInOiAyLA0KICAgICAgICAgICAgJ+S4iSc6IDMsICczJzogMywNCiAgICAgICAgICAgICflm5snOiA0LCAnNCc6IDQsDQogICAgICAgICAgICAn5LqUJzogNSwgJzUnOiA1LA0KICAgICAgICAgICAgJ+WFrSc6IDYsICc2JzogNiwNCiAgICAgICAgICAgICfkuIMnOiA3LCAnNyc6IDcsDQogICAgICAgICAgICAn5YWrJzogOCwgJzgnOiA4LA0KICAgICAgICAgICAgJ+S5nSc6IDksICc5JzogOQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEluaXRpYWwgcG9zaXRpb25zIG9mIHBpZWNlcyAocmVkIGFuZCBibGFjaykNCiAgICAgICAgLy8g5L+u5aSN77ya5LiO5paw5Z2Q5qCH57O757uf5L+d5oyB5LiA6Ie077yM57qi5pa55Zyo5bqV6YOo77yIcj0wLTLvvInvvIzpu5HmlrnlnKjpobbpg6jvvIhyPTctOe+8iQ0KICAgICAgICBjb25zdCBkZWZhdWx0SW5pdGlhbFBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICdyZWQtZ2VuZXJhbCc6IHsgcjogMCwgYzogNCB9LA0KICAgICAgICAgICAgJ3JlZC1hZHZpc29yJzogW3sgcjogMCwgYzogMyB9LCB7IHI6IDAsIGM6IDUgfV0sDQogICAgICAgICAgICAncmVkLWVsZXBoYW50JzogW3sgcjogMCwgYzogMiB9LCB7IHI6IDAsIGM6IDYgfV0sDQogICAgICAgICAgICAncmVkLWhvcnNlJzogW3sgcjogMCwgYzogMSB9LCB7IHI6IDAsIGM6IDcgfV0sDQogICAgICAgICAgICAncmVkLWNoYXJpb3QnOiBbeyByOiAwLCBjOiAwIH0sIHsgcjogMCwgYzogOCB9XSwNCiAgICAgICAgICAgICdyZWQtY2Fubm9uJzogW3sgcjogMiwgYzogMSB9LCB7IHI6IDIsIGM6IDcgfV0sDQogICAgICAgICAgICAncmVkLXNvbGRpZXInOiBbeyByOiAzLCBjOiAwIH0sIHsgcjogMywgYzogMiB9LCB7IHI6IDMsIGM6IDQgfSwgeyByOiAzLCBjOiA2IH0sIHsgcjogMywgYzogOCB9XSwNCiAgICAgICAgICAgICdibGFjay1nZW5lcmFsJzogeyByOiA5LCBjOiA0IH0sDQogICAgICAgICAgICAnYmxhY2stYWR2aXNvcic6IFt7IHI6IDksIGM6IDMgfSwgeyByOiA5LCBjOiA1IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWVsZXBoYW50JzogW3sgcjogOSwgYzogMiB9LCB7IHI6IDksIGM6IDYgfV0sDQogICAgICAgICAgICAnYmxhY2staG9yc2UnOiBbeyByOiA5LCBjOiAxIH0sIHsgcjogOSwgYzogNyB9XSwNCiAgICAgICAgICAgICdibGFjay1jaGFyaW90JzogW3sgcjogOSwgYzogMCB9LCB7IHI6IDksIGM6IDggfV0sDQogICAgICAgICAgICAnYmxhY2stY2Fubm9uJzogW3sgcjogNywgYzogMSB9LCB7IHI6IDcsIGM6IDcgfV0sDQogICAgICAgICAgICAnYmxhY2stc29sZGllcic6IFt7IHI6IDYsIGM6IDAgfSwgeyByOiA2LCBjOiAyIH0sIHsgcjogNiwgYzogNCB9LCB7IHI6IDYsIGM6IDYgfSwgeyByOiA2LCBjOiA4IH1dDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gVHJhY2sgcGllY2UgcG9zaXRpb25zIGFzIG1vdmVzIGFyZSBtYWRlDQogICAgICAgIGxldCBwaWVjZVBvc2l0aW9ucyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoZGVmYXVsdEluaXRpYWxQb3NpdGlvbnMpKTsNCiAgICAgICAgDQogICAgICAgIC8vIElmIGluaXRpYWwgYm9hcmQgaXMgcHJvdmlkZWQsIGluaXRpYWxpemUgcGllY2UgcG9zaXRpb25zIGZyb20gaXQNCiAgICAgICAgaWYgKGluaXRpYWxCb2FyZCkgew0KICAgICAgICAgICAgLy8gUmVzZXQgcGllY2UgcG9zaXRpb25zIGJhc2VkIG9uIGluaXRpYWwgYm9hcmQNCiAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgICdyZWQtZ2VuZXJhbCc6IHsgcjogLTEsIGM6IC0xIH0sDQogICAgICAgICAgICAgICAgJ3JlZC1hZHZpc29yJzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1lbGVwaGFudCc6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtaG9yc2UnOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWNoYXJpb3QnOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWNhbm5vbic6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtc29sZGllcic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1nZW5lcmFsJzogeyByOiAtMSwgYzogLTEgfSwNCiAgICAgICAgICAgICAgICAnYmxhY2stYWR2aXNvcic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1lbGVwaGFudCc6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1ob3JzZSc6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1jaGFyaW90JzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWNhbm5vbic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1zb2xkaWVyJzogW10NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFBvcHVsYXRlIHBpZWNlIHBvc2l0aW9ucyBmcm9tIGluaXRpYWwgYm9hcmQNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gaW5pdGlhbEJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke3BpZWNlLmNvbG9yfS0ke3BpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1trZXldID0geyByLCBjIH07DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2tleV0ucHVzaCh7IHIsIGMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZmluZCBwaWVjZSBwb3NpdGlvbg0KICAgICAgICBjb25zdCBmaW5kUGllY2VQb3NpdGlvbiA9IChwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGRpcmVjdGlvbiwgYm9hcmQsIGZyb250QmFja01hcmtlciA9IG51bGwpID0+IHsNCiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbG9yfS0ke3BpZWNlVHlwZX1gOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNba2V5XTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcG9zaXRpb25zIGV4aXN0IGFuZCBhcmUgdmFsaWQNCiAgICAgICAgICAgIGlmICghcG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gcG9zaXRpb25zIGZvdW5kIGZvciBwaWVjZTonLCBrZXkpOw0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gcG9zaXRpb25zOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBGaW5kIHBpZWNlcyBvbiB0aGUgc3BlY2lmaWVkIGNvbHVtbg0KICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IHBvc2l0aW9ucy5maWx0ZXIocG9zID0+IHBvcy5jID09PSBjb2wpOw0KDQogICAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBjYW5kaWRhdGVzIGZvdW5kIGZvciBwaWVjZTonLCBrZXksICdvbiBjb2x1bW46JywgY29sKTsNCiAgICAgICAgICAgICAgICAvLyBBZGRpdGlvbmFsIGRlYnVnIGluZm8gZm9yIGNhbm5vbg0KICAgICAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdjYW5ub24nICYmIGNvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdERUJVRzogQ2FuZGlkYXRlcyBhZnRlciBmaWx0ZXI6JywgY2FuZGlkYXRlcyk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gY2FuZGlkYXRlc1swXTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gSWYgZnJvbnQvYmFjayBtYXJrZXIgaXMgcHJvdmlkZWQsIHVzZSBpdCB0byBkZXRlcm1pbmUgdGhlIHBpZWNlDQogICAgICAgICAgICBpZiAoZnJvbnRCYWNrTWFya2VyID09PSAn5YmNJykgew0KICAgICAgICAgICAgICAgIC8vIOWJjeeCru+8mumdoOi/keaVjOaWueeahOaji+WtkA0KICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8mnLlgLzovoPlpKfnmoTmm7TpnaDov5HmlYzmlrnvvIjliY3vvIkNCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJpy5YC86L6D5bCP55qE5pu06Z2g6L+R5pWM5pa577yI5YmN77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoZnJvbnRCYWNrTWFya2VyID09PSAn5ZCOJykgew0KICAgICAgICAgICAgICAgIC8vIOWQjueCru+8mumdoOi/keW3seaWueeahOaji+WtkA0KICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8mnLlgLzovoPlsI/nmoTmm7TpnaDov5Hlt7HmlrnvvIjlkI7vvIkNCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJpy5YC86L6D5aSn55qE5pu06Z2g6L+R5bex5pa577yI5ZCO77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gSWYgbXVsdGlwbGUgcGllY2VzIG9uIHRoZSBzYW1lIGNvbHVtbiBhbmQgbm8gbWFya2VyLCBkZXRlcm1pbmUgYmFzZWQgb24gZGlyZWN0aW9uDQogICAgICAgICAgICAvLyDlr7nkuo7lkIzkuIDliJfnmoTmo4vlrZDvvIzpgJrov4fmr5TovoNy5YC85p2l5Yy65YiGDQogICAgICAgICAgICBpZiAoZGlyZWN0aW9uID09PSAn6L+bJykgew0KICAgICAgICAgICAgICAgIC8vIOi/m+aYr+WQkeaVjOaWueaWueWQkeenu+WKqO+8jOaJgOS7pemAieaLqeabtOmdoOi/keW3seaWueeahOaji+WtkO+8iOWQju+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9IGVsc2UgaWYgKGRpcmVjdGlvbiA9PT0gJ+mAgCcpIHsNCiAgICAgICAgICAgICAgICAvLyDpgIDmmK/lkJHlt7HmlrnmlrnlkJHnp7vliqjvvIzmiYDku6XpgInmi6nmm7TpnaDov5HmlYzmlrnnmoTmo4vlrZDvvIjliY3vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICByZXR1cm4gY2FuZGlkYXRlc1swXTsgLy8gRGVmYXVsdCB0byBmaXJzdCBpZiBkaXJlY3Rpb24gaXMgJ+W5sycgYW5kIG5vIG1hcmtlcg0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byB1cGRhdGUgcGllY2UgcG9zaXRpb24NCiAgICAgICAgY29uc3QgdXBkYXRlUGllY2VQb3NpdGlvbiA9IChwaWVjZVR5cGUsIGNvbG9yLCBvbGRQb3MsIG5ld1BvcykgPT4gew0KICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7Y29sb3J9LSR7cGllY2VUeXBlfWA7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1trZXldOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiBwb3NpdGlvbnMgZXhpc3QgYW5kIGFyZSB2YWxpZA0KICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IE5vIHBvc2l0aW9ucyBmb3VuZCBmb3IgcGllY2U6Jywga2V5KTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgIHBvc2l0aW9ucy5yID0gbmV3UG9zLnI7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zLmMgPSBuZXdQb3MuYzsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IGluZGV4ID0gcG9zaXRpb25zLmZpbmRJbmRleChwb3MgPT4gcG9zLnIgPT09IG9sZFBvcy5yICYmIHBvcy5jID09PSBvbGRQb3MuYyk7DQogICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKSB7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zW2luZGV4XS5yID0gbmV3UG9zLnI7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zW2luZGV4XS5jID0gbmV3UG9zLmM7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogQ291bGQgbm90IGZpbmQgcGllY2UgcG9zaXRpb24gdG8gdXBkYXRlOicsIG9sZFBvcywgJ2luJywgcG9zaXRpb25zKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY2hlY2sgaWYgcG9zaXRpb24gaXMgdmFsaWQNCiAgICAgICAgY29uc3QgaXNWYWxpZFBvcyA9IChyLCBjKSA9PiByID49IDAgJiYgciA8IDEwICYmIGMgPj0gMCAmJiBjIDwgOTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGhvcnNlIG1vdmVzDQogICAgICAgIGNvbnN0IGdldEhvcnNlTW92ZXMgPSAocG9zLCBjb2xvcikgPT4gew0KICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyBkcjogLTIsIGRjOiAtMSB9LCB7IGRyOiAtMiwgZGM6IDEgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAtMSwgZGM6IC0yIH0sIHsgZHI6IC0xLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDEsIGRjOiAtMiB9LCB7IGRyOiAxLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDIsIGRjOiAtMSB9LCB7IGRyOiAyLCBkYzogMSB9DQogICAgICAgICAgICBdOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgaG9yc2UgY2FuIG1vdmUgaW4gdGhlIGRpcmVjdGlvbg0KICAgICAgICAgICAgY29uc3QgY2FuTW92ZSA9IChkciwgZGMsIGJsb2NrZWRSLCBibG9ja2VkQykgPT4gew0KICAgICAgICAgICAgICAgIGlmICghaXNWYWxpZFBvcyhyICsgYmxvY2tlZFIsIGMgKyBibG9ja2VkQykpIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH07DQoNCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSwgaW5kZXgpID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCBibG9ja2VkUiA9IGRyID4gMCA/IDEgOiBkciA8IDAgPyAtMSA6IDA7DQogICAgICAgICAgICAgICAgY29uc3QgYmxvY2tlZEMgPSBkYyA+IDAgPyAxIDogZGMgPCAwID8gLTEgOiAwOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBwYXRoIGlzIGJsb2NrZWQNCiAgICAgICAgICAgICAgICBpZiAoKGluZGV4IDwgMiB8fCBpbmRleCA+PSA2KSAmJiBibG9ja2VkUiAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBibG9ja2VkDQogICAgICAgICAgICAgICAgICAgIGlmICghY2FuTW92ZShkciwgZGMsIGJsb2NrZWRSLCAwKSkgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoYmxvY2tlZEMgIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBibG9ja2VkDQogICAgICAgICAgICAgICAgICAgIGlmICghY2FuTW92ZShkciwgZGMsIDAsIGJsb2NrZWRDKSkgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSkgew0KICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCg0KICAgICAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgZWxlcGhhbnQgbW92ZXMNCiAgICAgICAgY29uc3QgZ2V0RWxlcGhhbnRNb3ZlcyA9IChwb3MsIGNvbG9yKSA9PiB7DQogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IGRyOiAtMiwgZGM6IC0yIH0sIHsgZHI6IC0yLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDIsIGRjOiAtMiB9LCB7IGRyOiAyLCBkYzogMiB9DQogICAgICAgICAgICBdOw0KDQogICAgICAgICAgICAvLyBFbGVwaGFudCdzIHRlcnJpdG9yeSAtIHJlZCBlbGVwaGFudHMgY2FuIG9ubHkgYmUgaW4gcjw9NCwgYmxhY2sgZWxlcGhhbnRzIGluIHI+PTUNCiAgICAgICAgICAgIGNvbnN0IGlzSW5UZXJyaXRvcnkgPSAocikgPT4gew0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyByIDw9IDQgOiByID49IDU7DQogICAgICAgICAgICB9Ow0KDQogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0pID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCBtaWRSID0gciArIGRyIC8gMjsNCiAgICAgICAgICAgICAgICBjb25zdCBtaWRDID0gYyArIGRjIC8gMjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7DQoNCiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBtaWQgcG9zaXRpb24gaXMgZW1wdHkgYW5kIG5ldyBwb3NpdGlvbiBpcyB2YWxpZA0KICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG1pZFIsIG1pZEMpICYmIGlzVmFsaWRQb3MobmV3UiwgbmV3QykgJiYgaXNJblRlcnJpdG9yeShuZXdSKSkgew0KICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCg0KICAgICAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgYWR2aXNvciBtb3Zlcw0KICAgICAgICBjb25zdCBnZXRBZHZpc29yTW92ZXMgPSAocG9zLCBjb2xvcikgPT4gew0KICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyBkcjogLTEsIGRjOiAtMSB9LCB7IGRyOiAtMSwgZGM6IDEgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAxLCBkYzogLTEgfSwgeyBkcjogMSwgZGM6IDEgfQ0KICAgICAgICAgICAgXTsNCg0KICAgICAgICAgICAgLy8gQWR2aXNvcidzIHRlcnJpdG9yeSAocGFsYWNlKSAtIHJlZCBhZHZpc29ycyBpbiByPTAtMixjPTMtNSwgYmxhY2sgYWR2aXNvcnMgaW4gcj03LTksYz0zLTUNCiAgICAgICAgICAgIGNvbnN0IGlzSW5QYWxhY2UgPSAociwgYykgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IHJSYW5nZSA9IGNvbG9yID09PSAncmVkJyA/IFswLCAyXSA6IFs3LCA5XTsNCiAgICAgICAgICAgICAgICByZXR1cm4gciA+PSByUmFuZ2VbMF0gJiYgciA8PSByUmFuZ2VbMV0gJiYgYyA+PSAzICYmIGMgPD0gNTsNCiAgICAgICAgICAgIH07DQoNCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSkgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSAmJiBpc0luUGFsYWNlKG5ld1IsIG5ld0MpKSB7DQogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0pOw0KDQogICAgICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGJvYXJkIHRvIHRyYWNrIG1vdmVzDQogICAgICAgIGxldCB0ZW1wQm9hcmQgPSB0aGlzLmNyZWF0ZUluaXRpYWxCb2FyZCgpOw0KICAgICAgICANCiAgICAgICAgLy8gRW5zdXJlIHRlbXBCb2FyZCBpcyBwcm9wZXJseSBpbml0aWFsaXplZA0KICAgICAgICBpZiAoIXRlbXBCb2FyZCB8fCB0ZW1wQm9hcmQubGVuZ3RoICE9PSAxMCkgew0KICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBib2FyZCBpbml0aWFsaXphdGlvbicpOw0KICAgICAgICAgICAgcmV0dXJuIFtdOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyBWZXJpZnkgYWxsIHJvd3MgaGF2ZSA5IGNvbHVtbnMNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDsgaSsrKSB7DQogICAgICAgICAgICBpZiAoIXRlbXBCb2FyZFtpXSB8fCB0ZW1wQm9hcmRbaV0ubGVuZ3RoICE9PSA5KSB7DQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2ldID0gQXJyYXkoOSkuZmlsbChudWxsKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIGNvbnNvbGUubG9nKCdUb3RhbCBtb3ZlczonLCBub3RhdGlvbi5sZW5ndGgpOw0KICAgICAgICBub3RhdGlvbi5mb3JFYWNoKG1vdmVOb3RhdGlvbiA9PiB7DQoNCg0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBQYXJzZSB0aGUgbW92ZSBub3RhdGlvbiAtIGtlZXAgbGFzdCBncm91cCBvcHRpb25hbA0KICAgICAgICAgICAgY29uc3QgcmVnZXggPSAvKFvliY3lkI5dKT8oW+WwhuW4heWjq+S7leixoeebuOmprOi9pueCruWFteWNkl0pKFvkuIDkuozkuInlm5vkupTlha3kuIPlhavkuZ0xMjM0NTY3ODldKShb6L+b6YCA5bmzXSkoW+S4gOS6jOS4ieWbm+S6lOWFreS4g+WFq+S5nTEyMzQ1Njc4OV0pPy87DQogICAgICAgICAgICBjb25zdCBtYXRjaCA9IG1vdmVOb3RhdGlvbi5tYXRjaChyZWdleCk7DQoNCiAgICAgICAgICAgIGlmICghbWF0Y2gpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIG1vdmUgbm90YXRpb246JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IFssIGZyb250QmFja01hcmtlciwgcGllY2VDaGFyLCBmcm9tQ29sTm90YXRpb24sIGRpcmVjdGlvbiwgdG9Db2xPclN0ZXBOb3RhdGlvbl0gPSBtYXRjaDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlTWFwW3BpZWNlQ2hhcl07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIEdldCBjb2x1bW4gbWFwcGluZyBiYXNlZCBvbiBjdXJyZW50IGNvbG9yIChibGFjayBzZWVzIGNvbHVtbnMgbWlycm9yZWQpDQogICAgICAgICAgICBsZXQgZnJvbUNvbCA9IGNvbE1hcFtmcm9tQ29sTm90YXRpb25dOw0KICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjayAoZnJvbSBibGFjaydzIHBlcnNwZWN0aXZlKQ0KICAgICAgICAgICAgICAgIGZyb21Db2wgPSA4IC0gZnJvbUNvbDsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gRmluZCB0aGUgY3VycmVudCBwb3NpdGlvbiBvZiB0aGUgcGllY2UNCiAgICAgICAgICAgIGNvbnN0IGZyb21Qb3MgPSBmaW5kUGllY2VQb3NpdGlvbihwaWVjZVR5cGUsIGN1cnJlbnRDb2xvciwgZnJvbUNvbCwgZGlyZWN0aW9uLCB0ZW1wQm9hcmQsIGZyb250QmFja01hcmtlcik7DQoNCiAgICAgICAgICAgIGlmICghZnJvbVBvcykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBmaW5kIHBpZWNlIHBvc2l0aW9uIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBsZXQgdG9Qb3M7DQoNCiAgICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT09ICflubMnKSB7DQogICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBtb3ZlbWVudA0KICAgICAgICAgICAgICAgIGxldCB0b0NvbCA9IGNvbE1hcFt0b0NvbE9yU3RlcE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICBpZiAodG9Db2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb246JywgdG9Db2xPclN0ZXBOb3RhdGlvbiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrIHdoZW4gbW92aW5nIGhvcml6b250YWxseQ0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgdG9Db2wgPSA4IC0gdG9Db2w7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIHRvUG9zID0geyByOiBmcm9tUG9zLnIsIGM6IHRvQ29sIH07DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIG9yIGRpYWdvbmFsIG1vdmVtZW50DQogICAgICAgICAgICAgICAgY29uc3Qgc3RlcHMgPSBjaGluZXNlTnVtYmVyTWFwW3RvQ29sT3JTdGVwTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKHN0ZXBzID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBzdGVwIGNvdW50OicsIHRvQ29sT3JTdGVwTm90YXRpb24sICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2hvcnNlJykgew0KICAgICAgICAgICAgICAgICAgICAvLyBIb3JzZSBtb3ZlcyBpbiBMLXNoYXBlDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRIb3JzZU1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7DQogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247DQogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgaG9yc2U6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjaw0KICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdlbGVwaGFudCcpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gRWxlcGhhbnQgbW92ZXMgZGlhZ29uYWxseSAyIHN0ZXBzDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRFbGVwaGFudE1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7DQogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247DQogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgZWxlcGhhbnQ6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjaw0KICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdhZHZpc29yJykgew0KICAgICAgICAgICAgICAgICAgICAvLyBBZHZpc29yIG1vdmVzIGRpYWdvbmFsbHkgMSBzdGVwDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRBZHZpc29yTW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsNCiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvbE5vdGF0aW9uID0gdG9Db2xPclN0ZXBOb3RhdGlvbjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uIGZvciBhZHZpc29yOicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sNCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIFN0cmFpZ2h0IGxpbmUgbW92ZW1lbnQgKGNoYXJpb3QsIGNhbm5vbiwgc29sZGllcikNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RlcCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyAoY3VycmVudENvbG9yID09PSAncmVkJyA/IDEgOiAtMSkgKiBzdGVwcyA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IC0xIDogMSkgKiBzdGVwczsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IGZyb21Qb3MuciArIHN0ZXA7DQogICAgICAgICAgICAgICAgICAgIGlmIChuZXdSIDwgMCB8fCBuZXdSID49IDEwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHJvdyBwb3NpdGlvbiBhZnRlciBtb3ZlOicsIG5ld1IsICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0geyByOiBuZXdSLCBjOiBmcm9tUG9zLmMgfTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmICghdG9Qb3MpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZGV0ZXJtaW5lIHRhcmdldCBwb3NpdGlvbiBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gQWRkIHRoZSBtb3ZlIHRvIHRoZSBsaXN0DQogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgZnJvbTogeyByOiBmcm9tUG9zLnIsIGM6IGZyb21Qb3MuYyB9LCB0bzogeyByOiB0b1Bvcy5yLCBjOiB0b1Bvcy5jIH0gfSk7DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlJ3MgYSBjYXB0dXJlZCBwaWVjZQ0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRQaWVjZSA9IHRlbXBCb2FyZFt0b1Bvcy5yXVt0b1Bvcy5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gSWYgdGhlcmUncyBhIGNhcHR1cmVkIHBpZWNlLCByZW1vdmUgaXQgZnJvbSBwaWVjZVBvc2l0aW9ucw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGAke2NhcHR1cmVkUGllY2UuY29sb3J9LSR7Y2FwdHVyZWRQaWVjZS50eXBlfWA7DQogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGNhcHR1cmVkUG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWwhi/luIXkuI3kvJrooqvlkIPmjonvvIzmiYDku6Xlj6rlpITnkIblhbbku5bmo4vlrZANCiAgICAgICAgICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBSZW1vdmUgdGhlIGNhcHR1cmVkIHBvc2l0aW9uIGZyb20gdGhlIGFycmF5DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjYXB0dXJlZFBvc2l0aW9ucykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB1cGRhdGVkUG9zaXRpb25zID0gY2FwdHVyZWRQb3NpdGlvbnMuZmlsdGVyKHBvcyA9PiANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zICYmIChwb3MuciAhPT0gdG9Qb3MuciB8fCBwb3MuYyAhPT0gdG9Qb3MuYykNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XSA9IHVwZGF0ZWRQb3NpdGlvbnM7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVmVyaWZ5IHJlbW92YWwgd2FzIHN1Y2Nlc3NmdWwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGlsbEV4aXN0cyA9IHVwZGF0ZWRQb3NpdGlvbnMuc29tZShwb3MgPT4gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiBwb3MuciA9PT0gdG9Qb3MuciAmJiBwb3MuYyA9PT0gdG9Qb3MuYw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHN0aWxsRXhpc3RzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogQ2FwdHVyZWQgcGllY2Ugc3RpbGwgZXhpc3RzIGluIHBpZWNlUG9zaXRpb25zIScpOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCfinIUgU1VDQ0VTUzogQ2FwdHVyZWQgcGllY2UgcmVtb3ZlZCBmcm9tIHBpZWNlUG9zaXRpb25zJyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IFVuZXhwZWN0ZWQgbm9uLWFycmF5IHBvc2l0aW9ucyBmb3IgcGllY2U6JywgY2FwdHVyZWRLZXkpOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBObyBwb3NpdGlvbnMgZm91bmQgZm9yIGNhcHR1cmVkIHBpZWNlOicsIGNhcHR1cmVkS2V5KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFZlcmlmeSB0aGUgY2FwdHVyZWQgcGllY2UgaGFzIGJlZW4gcmVtb3ZlZA0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGAke2NhcHR1cmVkUGllY2UuY29sb3J9LSR7Y2FwdHVyZWRQaWVjZS50eXBlfWA7DQogICAgICAgICAgICAgICAgY29uc3QgZmluYWxQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07DQogICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmluYWxQb3NpdGlvbnMpKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0aWxsRXhpc3RzID0gZmluYWxQb3NpdGlvbnMuc29tZShwb3MgPT4gDQogICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgcG9zLnIgPT09IHRvUG9zLnIgJiYgcG9zLmMgPT09IHRvUG9zLmMNCiAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHN0aWxsRXhpc3RzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFUlJPUjogQ2FwdHVyZWQgcGllY2Ugc3RpbGwgZXhpc3RzIGluIHBpZWNlUG9zaXRpb25zOicsIGNhcHR1cmVkUGllY2UsICdhdCcsIHRvUG9zKTsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTVUNDRVNTOiBDYXB0dXJlZCBwaWVjZSByZW1vdmVkIGZyb20gcGllY2VQb3NpdGlvbnMnKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gTWFrZSB0aGUgbW92ZSBvbiB0aGUgdGVtcG9yYXJ5IGJvYXJkIGZpcnN0IGJlZm9yZSB1cGRhdGluZyBwaWVjZSBwb3NpdGlvbnMNCiAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKGZyb21Qb3MuciwgZnJvbVBvcy5jKSAmJiBpc1ZhbGlkUG9zKHRvUG9zLnIsIHRvUG9zLmMpICYmIA0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtmcm9tUG9zLnJdICYmIHRlbXBCb2FyZFt0b1Bvcy5yXSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gdGVtcEJvYXJkW2Zyb21Qb3Mucl1bZnJvbVBvcy5jXTsNCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbdG9Qb3Mucl1bdG9Qb3MuY10gPSBwaWVjZTsNCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbZnJvbVBvcy5yXVtmcm9tUG9zLmNdID0gbnVsbDsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBJbnZhbGlkIHBvc2l0aW9ucyBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24sIGZyb21Qb3MsIHRvUG9zKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBwaWVjZSBwb3NpdGlvbiBpbiBwaWVjZVBvc2l0aW9ucw0KICAgICAgICAgICAgdXBkYXRlUGllY2VQb3NpdGlvbihwaWVjZVR5cGUsIGN1cnJlbnRDb2xvciwgZnJvbVBvcywgdG9Qb3MpOw0KICAgICAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBTd2l0Y2ggY29sb3IgZm9yIG5leHQgbW92ZQ0KICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgfSk7DQoNCiAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgIH0NCn0NCg0KLy8gLS0tIENvbnN0YW50cyAtLS0NCg0KLy8gSW5pdGlhbGl6ZSBPcGVuaW5nIEJvb2sNCmNvbnN0IG9wZW5pbmdCb29rID0gbmV3IE9wZW5pbmdCb29rKDEyKTsNCg0KY29uc3QgUElFQ0VfVkFMVUVTID0gew0KICBnZW5lcmFsOiAxMDAwMCwgICAgIC8vIOWwhi/luIUNCiAgY2hhcmlvdDogOTAwLCAgICAgICAvLyDovaYNCiAgY2Fubm9uOiA0NTAsICAgICAgICAvLyDngq4NCiAgaG9yc2U6IDQwMCwgICAgICAgICAvLyDpqawNCiAgZWxlcGhhbnQ6IDIwMCwgICAgICAvLyDosaEv55u4DQogIGFkdmlzb3I6IDIwMCwgICAgICAgLy8g5aOrL+S7lQ0KICBzb2xkaWVyOiAxMDAsICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIC0tLSBQaWVjZS1TcXVhcmUgVGFibGVzIC0tLQ0KY29uc3QgUFNUX1NPTERJRVIgPSBbDQogIFsxMCwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDEwXSwNCiAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgWzUsIDEwLCAyMCwgMjUsIDI1LCAyNSwgMjAsIDEwLCA1XSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0NCl07DQpjb25zdCBQU1RfQ0hBUklPVCA9IFsNCiAgWzUsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDEwLCA1XSwNCiAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICBbMTAsIDEyLCAxNSwgMTUsIDE1LCAxNSwgMTUsIDEyLCAxMF0sDQogIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgWzUsIDEwLCAxMiwgMTAsIDEwLCAxMCwgMTIsIDEwLCA1XSwNCiAgWzEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTBdLA0KICBbMCwgMTAsIDUsIDEwLCA1LCAxMCwgNSwgMTAsIDBdDQpdOw0KY29uc3QgUFNUX0hPUlNFID0gWw0KICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgWzAsIDUsIDE1LCAxMCwgMTAsIDEwLCAxNSwgNSwgMF0sDQogIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICBbNSwgMTAsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTAsIDVdLA0KICBbMCwgNSwgMTUsIDIwLCAyMCwgMjAsIDE1LCA1LCAwXSwNCiAgWzAsIDUsIDE1LCAyMCwgMjAsIDIwLCAxNSwgNSwgMF0sDQogIFswLCA1LCAxMCwgMTUsIDE1LCAxNSwgMTAsIDUsIDBdLA0KICBbMCwgMCwgNSwgNSwgNSwgNSwgNSwgMCwgMF0sDQogIFswLCAtNSwgMCwgNSwgNSwgNSwgMCwgLTUsIDBdLA0KICBbMCwgLTEwLCAtNSwgMCwgMCwgMCwgLTUsIC0xMCwgMF0NCl07DQpjb25zdCBQU1RfQ0FOTk9OID0gWw0KICBbMCwgMCwgNSwgMTAsIDEwLCAxMCwgNSwgMCwgMF0sDQogIFswLCA1LCAxNSwgMTAsIDEwLCAxMCwgMTUsIDUsIDBdLA0KICBbMCwgNSwgMTUsIDI1LCAyNSwgMjUsIDE1LCA1LCAwXSwNCiAgWzAsIDUsIDEwLCAxNSwgMTUsIDE1LCAxMCwgNSwgMF0sDQogIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgWzAsIDUsIDUsIDUsIDUsIDUsIDUsIDUsIDBdLA0KICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogIFs1LCAxNSwgMjAsIDMwLCAzMCwgMzAsIDIwLCAxNSwgNV0sIA0KICBbMCwgNSwgNSwgMTAsIDEwLCAxMCwgNSwgNSwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KXTsNCmNvbnN0IFBTVF9ERUZFTlNFID0gWw0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICBbMCwgMCwgMCwgMjAsIDMwLCAyMCwgMCwgMCwgMF0NCl07DQoNCmNvbnN0IGdldFBTVFZhbHVlID0gKHR5cGUsIGNvbG9yLCByLCBjKSA9PiB7DQogIGNvbnN0IHJvd0lkeCA9IGNvbG9yID09PSAncmVkJyA/IHIgOiAoOSAtIHIpOw0KICBsZXQgdGFibGUgPSBbXTsNCiAgc3dpdGNoICh0eXBlKSB7DQogICAgY2FzZSAnc29sZGllcic6IHRhYmxlID0gUFNUX1NPTERJRVI7IGJyZWFrOw0KICAgIGNhc2UgJ2NoYXJpb3QnOiB0YWJsZSA9IFBTVF9DSEFSSU9UOyBicmVhazsNCiAgICBjYXNlICdob3JzZSc6IHRhYmxlID0gUFNUX0hPUlNFOyBicmVhazsNCiAgICBjYXNlICdjYW5ub24nOiB0YWJsZSA9IFBTVF9DQU5OT047IGJyZWFrOw0KICAgIGRlZmF1bHQ6IHRhYmxlID0gUFNUX0RFRkVOU0U7IGJyZWFrOyANCiAgfQ0KICByZXR1cm4gdGFibGVbcm93SWR4XT8uW2NdIHx8IDA7DQp9Ow0KDQpjb25zdCBpc1ZhbGlkUG9zID0gKHIsIGMpID0+IHIgPj0gMCAmJiByIDwgUk9XUyAmJiBjID49IDAgJiYgYyA8IENPTFM7DQoNCi8vIOiOt+WPluaji+WtkOeahOWogeiDgeebruagh+WSjOS/neaKpOebruaghw0KY29uc3QgZ2V0UGllY2VUYXJnZXRzID0gKGJvYXJkLCBwb3MsIHBpZWNlKSA9PiB7DQogIGNvbnN0IHRocmVhdCA9IFtdOyAgICAgICAgICAgLy8g5b2T5YmN5qOL5a2Q5aiB6IOB55qE5pWM5pa55qOL5a2QDQogIGNvbnN0IGd1YXJkID0gW107ICAgICAgIC8vIOW9k+WJjeaji+WtkOS/neaKpOeahOW3seaWueaji+WtkA0KICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQoNCiAgY29uc3QgYWRkSWZWYWxpZCA9ICh0ciwgdGMpID0+IHsNCiAgICBpZiAoaXNWYWxpZFBvcyh0ciwgdGMpKSB7DQogICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW3RyXVt0Y107DQogICAgICAgIGlmICh0YXJnZXQpIHsNCiAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlLmNvbG9yKSB7DQogICAgICAgICAgICAgICAgLy8g5pWM5pa55qOL5a2Q77yM5Yqg5YWl5aiB6IOB5YiX6KGoDQogICAgICAgICAgICAgICAgdGhyZWF0LnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIOW3seaWueaji+WtkO+8jOWKoOWFpeS/neaKpOWIl+ihqO+8jOWwhuW4heS4jemcgOimgeS6i+WQjueahOS/neaKpA0KICAgICAgICAgICAgICAgIGlmICh0YXJnZXQudHlwZSAhPSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgZ3VhcmQucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogIH07DQogIA0KDQoNCiAgc3dpdGNoIChwaWVjZS50eXBlKSB7DQogICAgY2FzZSAnZ2VuZXJhbCc6IA0KICAgICAgW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGlmIChuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDcgJiYgbnIgPD0gOSkgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2Fkdmlzb3InOg0KICAgICAgW1sxLCAxXSwgWzEsIC0xXSwgWy0xLCAxXSwgWy0xLCAtMV1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgaWYgKG5jID49IDMgJiYgbmMgPD0gNSkgew0KICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA+PSAwICYmIG5yIDw9IDIpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnZWxlcGhhbnQnOg0KICAgICAgW1syLCAyXSwgWzIsIC0yXSwgWy0yLCAyXSwgWy0yLCAtMl1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgY29uc3QgZXllUiA9IHIgKyBkciAvIDIsIGV5ZUMgPSBjICsgZGMgLyAyOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhuciwgbmMpICYmIGJvYXJkW2V5ZVJdW2V5ZUNdID09PSBudWxsKSB7DQogICAgICAgICAgaWYgKGlzUmVkICYmIG5yIDw9IDQpIGFkZElmVmFsaWQobnIsIG5jKTsgDQogICAgICAgICAgZWxzZSBpZiAoIWlzUmVkICYmIG5yID49IDUpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdob3JzZSc6DQogICAgICBbWzIsIDFdLCBbMiwgLTFdLCBbLTIsIDFdLCBbLTIsIC0xXSwgWzEsIDJdLCBbMSwgLTJdLCBbLTEsIDJdLCBbLTEsIC0yXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBjb25zdCBsZWdSID0gciArIChNYXRoLmFicyhkcikgPT09IDIgPyBNYXRoLnNpZ24oZHIpIDogMCk7DQogICAgICAgIGNvbnN0IGxlZ0MgPSBjICsgKE1hdGguYWJzKGRjKSA9PT0gMiA/IE1hdGguc2lnbihkYykgOiAwKTsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MobGVnUiwgbGVnQykgJiYgYm9hcmRbbGVnUl1bbGVnQ10gPT09IG51bGwpIHsNCiAgICAgICAgICBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnY2hhcmlvdCc6DQogICAgICBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgLy8g56m65L2N572u77yM5LiN5YGa5aSE55CGDQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgIH0NCiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnY2Fubm9uJzoNCiAgICAgIFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgbGV0IHNjcmVlbkZvdW5kID0gZmFsc2U7DQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAvLyDnqbrkvY3nva7vvIzkuI3lgZrlpITnkIYNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgIHNjcmVlbkZvdW5kID0gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gIT09IG51bGwpIHsNCiAgICAgICAgICAgICAgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICB9DQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ3NvbGRpZXInOiB7DQogICAgICAvLyDnuqLmlrnlhbXliJ3lp4vkvY3nva7lnKhyPTPvvIzlkJHliY3otbDmmK9y5aKe5aSn77yI5ZCR5LiL77yJ77yb6buR5pa55YW15Yid5aeL5L2N572u5Zyocj0277yM5ZCR5YmN6LWw5pivcuWHj+Wwj++8iOWQkeS4iu+8iQ0KICAgICAgY29uc3QgZm9yd2FyZCA9IGlzUmVkID8gMSA6IC0xOw0KICAgICAgLy8g57qi5pa55YW16L+H5rKz5p2h5Lu25pivciA+PSA177yM6buR5pa55YW16L+H5rKz5p2h5Lu25pivciA8PSA0DQogICAgICAvLyDmsrPnlYzkvY3kuo5yPTTlkoxyPTXkuYvpl7TvvIznuqLmlrnlhbXpnIDopoHotbDliLByPTXmiY3og73ov4fmsrPvvIzpu5HmlrnlhbXpnIDopoHotbDliLByPTTmiY3og73ov4fmsrMNCiAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGlzUmVkID8gciA+PSA1IDogciA8PSA0Ow0KICAgICAgYWRkSWZWYWxpZChyICsgZm9yd2FyZCwgYyk7DQogICAgICBpZiAoY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgIGFkZElmVmFsaWQociwgYyAtIDEpOw0KICAgICAgICBhZGRJZlZhbGlkKHIsIGMgKyAxKTsNCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgfQ0KICByZXR1cm4geyB0aHJlYXQsIGd1YXJkIH07DQp9Ow0KDQpjb25zdCBnZXRQaWVjZU1vdmVzID0gKGJvYXJkLCBwb3MsIHBpZWNlKSA9PiB7DQogIGNvbnN0IG1vdmVzID0gW107DQogIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCg0KICBjb25zdCBhZGRJZlZhbGlkID0gKHRyLCB0YykgPT4gew0KICAgIGlmIChpc1ZhbGlkUG9zKHRyLCB0YykpIHsNCiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbdHJdW3RjXTsNCiAgICAgICAgaWYgKCF0YXJnZXQgfHwgdGFyZ2V0LmNvbG9yICE9PSBwaWVjZS5jb2xvcikgew0KICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgfQ0KICAgIH0NCiAgfTsNCg0KICBzd2l0Y2ggKHBpZWNlLnR5cGUpIHsNCiAgICBjYXNlICdnZW5lcmFsJzogDQogICAgICBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGNvbnN0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgaWYgKG5jID49IDMgJiYgbmMgPD0gNSkgew0KICAgICAgICAgIGlmIChpc1JlZCAmJiBuciA+PSAwICYmIG5yIDw9IDIpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgIH0pOw0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnYWR2aXNvcic6DQogICAgICBbWzEsIDFdLCBbMSwgLTFdLCBbLTEsIDFdLCBbLTEsIC0xXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBpZiAobmMgPj0gMyAmJiBuYyA8PSA1KSB7DQogICAgICAgICAgaWYgKGlzUmVkICYmIG5yID49IDAgJiYgbnIgPD0gMikgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICAgIGVsc2UgaWYgKCFpc1JlZCAmJiBuciA+PSA3ICYmIG5yIDw9IDkpIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdlbGVwaGFudCc6DQogICAgICBbWzIsIDJdLCBbMiwgLTJdLCBbLTIsIDJdLCBbLTIsIC0yXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgY29uc3QgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBjb25zdCBleWVSID0gciArIGRyIC8gMiwgZXllQyA9IGMgKyBkYyAvIDI7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYgYm9hcmRbZXllUl1bZXllQ10gPT09IG51bGwpIHsNCiAgICAgICAgICBpZiAoaXNSZWQgJiYgbnIgPD0gNCkgYWRkSWZWYWxpZChuciwgbmMpOyANCiAgICAgICAgICBlbHNlIGlmICghaXNSZWQgJiYgbnIgPj0gNSkgYWRkSWZWYWxpZChuciwgbmMpOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2hvcnNlJzoNCiAgICAgIFtbMiwgMV0sIFsyLCAtMV0sIFstMiwgMV0sIFstMiwgLTFdLCBbMSwgMl0sIFsxLCAtMl0sIFstMSwgMl0sIFstMSwgLTJdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgICBjb25zdCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGNvbnN0IGxlZ1IgPSByICsgKE1hdGguYWJzKGRyKSA9PT0gMiA/IE1hdGguc2lnbihkcikgOiAwKTsNCiAgICAgICAgY29uc3QgbGVnQyA9IGMgKyAoTWF0aC5hYnMoZGMpID09PSAyID8gTWF0aC5zaWduKGRjKSA6IDApOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhsZWdSLCBsZWdDKSAmJiBib2FyZFtsZWdSXVtsZWdDXSA9PT0gbnVsbCkgew0KICAgICAgICAgIGFkZElmVmFsaWQobnIsIG5jKTsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgICBicmVhazsNCiAgICBjYXNlICdjaGFyaW90JzoNCiAgICAgIFtbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXV0uZm9yRWFjaCgoW2RyLCBkY10pID0+IHsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgd2hpbGUgKGlzVmFsaWRQb3MobnIsIG5jKSkgew0KICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdID09PSBudWxsKSB7DQogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXS5jb2xvciAhPT0gcGllY2UuY29sb3IpIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgICB9DQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2Nhbm5vbic6DQogICAgICBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dLmZvckVhY2goKFtkciwgZGNdKSA9PiB7DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGxldCBzY3JlZW5Gb3VuZCA9IGZhbHNlOw0KICAgICAgICB3aGlsZSAoaXNWYWxpZFBvcyhuciwgbmMpKSB7DQogICAgICAgICAgaWYgKCFzY3JlZW5Gb3VuZCkgew0KICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgIHNjcmVlbkZvdW5kID0gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gIT09IG51bGwpIHsNCiAgICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10uY29sb3IgIT09IHBpZWNlLmNvbG9yKSBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICB9DQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgICB9DQogICAgICB9KTsNCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ3NvbGRpZXInOiB7DQogICAgICAvLyDnuqLmlrnlhbXliJ3lp4vkvY3nva7lnKhyPTPvvIzlkJHliY3otbDmmK9y5aKe5aSn77yI5ZCR5LiL77yJ77yb6buR5pa55YW15Yid5aeL5L2N572u5Zyocj0277yM5ZCR5YmN6LWw5pivcuWHj+Wwj++8iOWQkeS4iu+8iQ0KICAgICAgY29uc3QgZm9yd2FyZCA9IGlzUmVkID8gMSA6IC0xOw0KICAgICAgLy8g57qi5pa55YW16L+H5rKz5p2h5Lu25pivciA+PSA177yM6buR5pa55YW16L+H5rKz5p2h5Lu25pivciA8PSA0DQogICAgICAvLyDmsrPnlYzkvY3kuo5yPTTlkoxyPTXkuYvpl7TvvIznuqLmlrnlhbXpnIDopoHotbDliLByPTXmiY3og73ov4fmsrPvvIzpu5HmlrnlhbXpnIDopoHotbDliLByPTTmiY3og73ov4fmsrMNCiAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGlzUmVkID8gciA+PSA1IDogciA8PSA0Ow0KICAgICAgYWRkSWZWYWxpZChyICsgZm9yd2FyZCwgYyk7DQogICAgICBpZiAoY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgIGFkZElmVmFsaWQociwgYyAtIDEpOw0KICAgICAgICBhZGRJZlZhbGlkKHIsIGMgKyAxKTsNCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgfQ0KICByZXR1cm4gbW92ZXM7DQp9Ow0KDQovLyDojrflj5bmo4vlrZDnmoTmjqfliLbngrkNCmNvbnN0IGdldFBpZWNlQ29udHJvbCA9IChib2FyZCwgcG9zLCBwaWVjZSkgPT4gew0KICBjb25zdCBjb250cm9sID0gW107DQogIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCg0KICBjb25zdCBhZGRJZlZhbGlkID0gKHRyLCB0YykgPT4gew0KICAgIGlmIChpc1ZhbGlkUG9zKHRyLCB0YykpIHsNCiAgICAgICAgY29udHJvbC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgIH0NCiAgfTsNCg0KICAvLyDlr7nkuo7pnZ7ngq7mo4vlrZDvvIzmjqfliLbngrnlj6rljIXmi6zlhbblj6/ku6XmiZPliLDnmoTnqbrkvY3nva7vvIzljbPlpoLmnpzmlYzmlrnmo4vlrZDov5vlhaXov5nkupvngrnlsIbooqvmlLvlh7sNCiAgaWYgKHBpZWNlLnR5cGUgIT09ICdjYW5ub24nKSB7DQogICAgLy8g6I635Y+W5omA5pyJ5Y+v6IO955qE56e75Yqo5L2N572u77yM54S25ZCO6L+H5ruk5o6J5pyJ5qOL5a2Q55qE5L2N572uDQogICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCBwb3MsIHBpZWNlKTsNCiAgICBtb3Zlcy5mb3JFYWNoKG1vdmUgPT4gew0KICAgICAgLy8g5Y+q5re75Yqg56m65L2N572u5L2c5Li65o6n5Yi254K5DQogICAgICBpZiAoYm9hcmRbbW92ZS5yXVttb3ZlLmNdID09PSBudWxsKSB7DQogICAgICAgIGNvbnRyb2wucHVzaChtb3ZlKTsNCiAgICAgIH0NCiAgICB9KTsNCiAgfSBlbHNlIHsNCiAgICAvLyDlr7nkuo7ngq7mo4vlrZDvvIzpnIDopoHnibnmrororqHnrpfmjqfliLbngrnvvIzmjqfliLbngrnlj6rljIXmi6zlhbblj6/ku6XmiZPliLDnmoTnqbrkvY3nva7vvIzljbPlpoLmnpzmlYzmlrnmo4vlrZDov5vlhaXov5nkupvngrnlsIbooqvmlLvlh7sNCiAgICAvLyDngq7og73mjqfliLbnmoTmmK/nrKwx5Liq54Ku5Y+w5LmL5ZCO77yI5LiN5ZCr54Ku5Y+w77yJ56ysMuS4queCruWPsOS5i+WJje+8iOS4jeWQq+eCruWPsO+8ieeahOaJgOacieepuuS9jee9rg0KICAgIC8vIOWmguaenOayoeacieesrDLkuKrngq7lj7DpgqPkuYjlsLHmmK/nrKwx5Liq54Ku5Y+w5LmL5ZCO77yI5LiN5ZCr54Ku5Y+w77yJ55qE5omA5pyJ56m65L2N572uDQogICAgW1swLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdXS5mb3JFYWNoKChbZHIsIGRjXSkgPT4gew0KICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgIGxldCBzY3JlZW5Gb3VuZENvdW50ID0gMDsNCiAgICAgIA0KICAgICAgd2hpbGUgKGlzVmFsaWRQb3MobnIsIG5jKSAmJiBzY3JlZW5Gb3VuZENvdW50IDwgMikgew0KICAgICAgICBjb25zdCBjdXJyZW50UGllY2UgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICANCiAgICAgICAgaWYgKGN1cnJlbnRQaWVjZSAhPT0gbnVsbCkgew0KICAgICAgICAgIC8vIOaJvuWIsOS4gOS4queCruWPsO+8jOWinuWKoOiuoeaVsA0KICAgICAgICAgIHNjcmVlbkZvdW5kQ291bnQrKzsNCiAgICAgICAgfSBlbHNlIGlmIChzY3JlZW5Gb3VuZENvdW50ID09PSAxKSB7DQogICAgICAgICAgLy8g56ysMeS4queCruWPsOS5i+WQju+8jOesrDLkuKrngq7lj7DkuYvliY3nmoTnqbrkvY3nva7vvIzmt7vliqDliLDmjqfliLbngrkNCiAgICAgICAgICBhZGRJZlZhbGlkKG5yLCBuYyk7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIG5yICs9IGRyOyBuYyArPSBkYzsNCiAgICAgIH0NCiAgICB9KTsNCiAgfQ0KDQogIHJldHVybiBjb250cm9sOw0KfTsNCg0KY29uc3QgaXNGbHlpbmdHZW5lcmFsID0gKGJvYXJkKSA9PiB7DQogIGxldCByZWRHID0gbnVsbDsNCiAgbGV0IGJsYWNrRyA9IG51bGw7DQogIGZvcihsZXQgcj0wOyByPFJPV1M7IHIrKykgew0KICAgICAgZm9yKGxldCBjPTM7IGM8PTU7IGMrKykgew0KICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICBpZiAocD8udHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgIGlmIChwLmNvbG9yID09PSAncmVkJykgcmVkRyA9IHtyLCBjfTsNCiAgICAgICAgICAgICAgZWxzZSBibGFja0cgPSB7ciwgY307DQogICAgICAgICAgfQ0KICAgICAgfQ0KICB9DQogIGlmICghcmVkRyB8fCAhYmxhY2tHIHx8IHJlZEcuYyAhPT0gYmxhY2tHLmMpIHJldHVybiBmYWxzZTsNCiAgDQogIC8vIOehruS/neW+queOr+aWueWQkeato+ehru+8jOS7jui+g+Wwj+eahHLliLDovoPlpKfnmoRyDQogIGNvbnN0IHN0YXJ0UiA9IE1hdGgubWluKGJsYWNrRy5yLCByZWRHLnIpICsgMTsNCiAgY29uc3QgZW5kUiA9IE1hdGgubWF4KGJsYWNrRy5yLCByZWRHLnIpIC0gMTsNCiAgDQogIGZvciAobGV0IHIgPSBzdGFydFI7IHIgPD0gZW5kUjsgcisrKSB7DQogICAgaWYgKGJvYXJkW3JdW3JlZEcuY10gIT09IG51bGwpIHJldHVybiBmYWxzZTsNCiAgfQ0KICByZXR1cm4gdHJ1ZTsNCn07DQoNCmNvbnN0IGlzQ2hlY2sgPSAoYm9hcmQsIGNvbG9yLCBwaWVjZXNJbmZvID0gbnVsbCwgYm9hcmRJbmZvID0gbnVsbCkgPT4gew0KICAgIC8vIOS8mOWFiOS9v+eUqOmihOiuoeeul+eahOWwhuWGm+eKtuaAgQ0KICAgIGlmIChib2FyZEluZm8pIHsNCiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRJc0luQ2hlY2sgOiBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2s7DQogICAgfQ0KICAgIA0KICAgIC8vIOWmguaenOaciXBpZWNlc0luZm/vvIzkuZ/lj6/ku6Xku47kuK3ojrflj5blsIblhpvnirbmgIENCiAgICBpZiAocGllY2VzSW5mbyAmJiBwaWVjZXNJbmZvLmxlbmd0aCA+IDApIHsNCiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IHBpZWNlc0luZm9bMF0ucmVkSXNJbkNoZWNrIDogcGllY2VzSW5mb1swXS5ibGFja0lzSW5DaGVjazsNCiAgICB9DQogICAgDQogICAgLy8g5rKh5pyJ6aKE6K6h566X57uT5p6c5pe277yM5omn6KGM5Y6f5aeL6K6h566XDQogICAgLy8g5LyY5YyW5ZCO55qEaXNDaGVja+WHveaVsO+8jOmBv+WFjemHjeWkjeiwg+eUqGdldFBpZWNlTW92ZXMNCiAgICBsZXQgZ2VuZXJhbFBvcyA9IG51bGw7DQogICAgZm9yKGxldCByPTA7IHI8Uk9XUzsgcisrKSB7DQogICAgICAgIGZvcihsZXQgYz0wOyBjPENPTFM7IGMrKykgeyANCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmIChwICYmIHAudHlwZSA9PT0gJ2dlbmVyYWwnICYmIHAuY29sb3IgPT09IGNvbG9yKSB7DQogICAgICAgICAgICAgICAgZ2VuZXJhbFBvcyA9IHtyLCBjfTsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoZ2VuZXJhbFBvcykgYnJlYWs7DQogICAgfQ0KICAgIA0KICAgIGlmICghZ2VuZXJhbFBvcykgcmV0dXJuIHRydWU7DQoNCiAgICBjb25zdCBlbmVteUNvbG9yID0gY29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgIGNvbnN0IHsgcjogZ3IsIGM6IGdjIH0gPSBnZW5lcmFsUG9zOw0KICAgIA0KICAgIC8vIOajgOafpeebtOe6v+aUu+WHu++8iOi9puOAgeWwhu+8iQ0KICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF1dOw0KICAgIGZvciAoY29uc3QgW2RyLCBkY10gb2YgZGlyZWN0aW9ucykgew0KICAgICAgICBsZXQgbnIgPSBnciArIGRyOw0KICAgICAgICBsZXQgbmMgPSBnYyArIGRjOw0KICAgICAgICANCiAgICAgICAgd2hpbGUgKGlzVmFsaWRQb3MobnIsIG5jKSkgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICBpZiAocCkgew0KICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yID09PSBlbmVteUNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgIGlmICgocC50eXBlID09PSAnY2hhcmlvdCcgfHwgcC50eXBlID09PSAnZ2VuZXJhbCcpKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIG5yICs9IGRyOw0KICAgICAgICAgICAgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g5LiT6Zeo5qOA5p+l54Ku55qE5pS75Ye777ya5pWM5pa554Ku5ZKM5oiR5pa55bCG5Zyo5LiA5p2h57q/77yM5Lit6Ze06ZqU552A5LiA5Liq5Lu75oSP5qOL5a2QDQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnY2Fubm9uJykgew0KICAgICAgICAgICAgICAgIC8vIOajgOafpeeCruWSjOWwhuaYr+WQpuWcqOWQjOS4gOebtOe6v+S4ig0KICAgICAgICAgICAgICAgIGlmIChyID09PSBnciB8fCBjID09PSBnYykgew0KICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDnm7Tnur/kuIrvvIzorqHnrpfkuK3pl7TnmoTmo4vlrZDmlbDph48NCiAgICAgICAgICAgICAgICAgICAgbGV0IHNjcmVlbkNvdW50ID0gMDsNCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIGlmIChyID09PSBncikgew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g5ZCM5LiA6KGMDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFydENvbCA9IE1hdGgubWluKGMsIGdjKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVuZENvbCA9IE1hdGgubWF4KGMsIGdjKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgY29sID0gc3RhcnRDb2wgKyAxOyBjb2wgPCBlbmRDb2w7IGNvbCsrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJvYXJkW3JdW2NvbF0gIT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2NyZWVuQ291bnQrKzsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyDlkIzkuIDliJcNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0Um93ID0gTWF0aC5taW4ociwgZ3IpOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kUm93ID0gTWF0aC5tYXgociwgZ3IpOw0KICAgICAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCByb3cgPSBzdGFydFJvdyArIDE7IHJvdyA8IGVuZFJvdzsgcm93KyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoYm9hcmRbcm93XVtjXSAhPT0gbnVsbCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzY3JlZW5Db3VudCsrOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8g54Ku6ZyA6KaB5LiA5Liq54Ku5p625omN6IO95pS75Ye7DQogICAgICAgICAgICAgICAgICAgIGlmIChzY3JlZW5Db3VudCA9PT0gMSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g5qOA5p+l5pac57q/5pS75Ye777yI6ams44CB5aOr44CB6LGh77yJDQogICAgLy8g5qOA5p+l6ams55qE5pS75Ye777ya5LuO5bCG5L2N5Y+N5o6o6ams55qE5L2N572u5pe277yM6ams6IW/5bqU5Zyo6ams5LiA5L6n77yI5LiOIGdldFBpZWNlTW92ZXMg5LiA6Ie077yJDQogICAgY29uc3QgaG9yc2VNb3ZlcyA9IFtbMiwgMV0sIFsyLCAtMV0sIFstMiwgMV0sIFstMiwgLTFdLCBbMSwgMl0sIFsxLCAtMl0sIFstMSwgMl0sIFstMSwgLTJdXTsNCiAgICBmb3IgKGNvbnN0IFtkciwgZGNdIG9mIGhvcnNlTW92ZXMpIHsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGRyOw0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICAgIC8vIOmprOWcqCAobnIsbmMp77yM6LWw5ZCR5bCG5pe26ams6IW/57Sn6LS06ams77ya6ZW/6L205pa55ZCR6YCA5LiA5q2lDQogICAgICAgICAgICBjb25zdCBsZWdSID0gbnIgLSAoTWF0aC5hYnMoZHIpID09PSAyID8gTWF0aC5zaWduKGRyKSA6IDApOw0KICAgICAgICAgICAgY29uc3QgbGVnQyA9IG5jIC0gKE1hdGguYWJzKGRjKSA9PT0gMiA/IE1hdGguc2lnbihkYykgOiAwKTsNCiAgICAgICAgICAgIGlmIChib2FyZFtsZWdSXVtsZWdDXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnaG9yc2UnKSB7DQogICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDmo4Dmn6Xlo6vnmoTmlLvlh7vvvIjlj6rlnKjkuZ3lrqvlhoXvvIkNCiAgICBjb25zdCBhZHZpc29yTW92ZXMgPSBbWzEsIDFdLCBbMSwgLTFdLCBbLTEsIDFdLCBbLTEsIC0xXV07DQogICAgZm9yIChjb25zdCBbZHIsIGRjXSBvZiBhZHZpc29yTW92ZXMpIHsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGRyOw0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYgDQogICAgICAgICAgICAoKGNvbG9yID09PSAncmVkJyAmJiBuciA+PSAwICYmIG5yIDw9IDIpIHx8IChjb2xvciA9PT0gJ2JsYWNrJyAmJiBuciA+PSA3ICYmIG5yIDw9IDkpKSAmJg0KICAgICAgICAgICAgbmMgPj0gMyAmJiBuYyA8PSA1KSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnYWR2aXNvcicpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDmo4Dmn6XlhbXnmoTmlLvlh7vvvIjku47lsIbkvY3nva7lj43mjqjmlYzlhbXmnaXmupDvvIkNCiAgICAvLyDnuqLlhbXlkJHliY0gKzHvvIzpu5HlhbXlkJHliY0gLTHvvJvmraPliY3mlrnmlLvlh7vlp4vnu4jmnInmlYjvvIzlt6blj7Pku4Xov4fmsrPlhbXlj6/mlLvlh7sNCiAgICBjb25zdCBlbmVteUZvcndhcmQgPSBlbmVteUNvbG9yID09PSAncmVkJyA/IDEgOiAtMTsNCiAgICBjb25zdCBmb3J3YXJkRnJvbVIgPSBnciAtIGVuZW15Rm9yd2FyZDsNCiAgICBpZiAoaXNWYWxpZFBvcyhmb3J3YXJkRnJvbVIsIGdjKSkgew0KICAgICAgICBjb25zdCBwID0gYm9hcmRbZm9yd2FyZEZyb21SXVtnY107DQogICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnc29sZGllcicpIHsNCiAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgfQ0KICAgIGZvciAoY29uc3QgZGMgb2YgWzEsIC0xXSkgew0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKGdyLCBuYykpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtncl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGVuZW15Q29sb3IgPT09ICdyZWQnID8gZ3IgPj0gNSA6IGdyIDw9IDQ7DQogICAgICAgICAgICAgICAgaWYgKGNyb3NzZWRSaXZlcikgew0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgcmV0dXJuIGZhbHNlOw0KfTsNCg0KLy8g5L+u5aSN77ya5q+P5qyh5qOA5p+l6LWw5rOV5pe25YWL6ZqG5qOL55uY77yM6YG/5YWN5L+u5pS55Y6f5aeL5a+56LGhDQpjb25zdCBnZXRWYWxpZE1vdmVzID0gKGJvYXJkLCBwb3MpID0+IHsNCiAgY29uc3QgcGllY2UgPSBib2FyZFtwb3Mucl1bcG9zLmNdOw0KICBpZiAoIXBpZWNlKSByZXR1cm4gW107DQogIA0KICBjb25zdCBwc2V1ZG9Nb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHBvcywgcGllY2UpOw0KICBjb25zdCB2YWxpZE1vdmVzID0gW107DQogIA0KICBmb3IgKGNvbnN0IHRvIG9mIHBzZXVkb01vdmVzKSB7DQogICAgLy8g5YWL6ZqG5qOL55uY77yM6YG/5YWN5L+u5pS55Y6f5aeL5a+56LGhDQogICAgY29uc3QgY2xvbmVkQm9hcmQgPSBib2FyZC5tYXAocm93ID0+IFsuLi5yb3ddKTsNCiAgICANCiAgICAvLyDkv67mlLnlhYvpmoblkI7nmoTmo4vnm5gNCiAgICBjbG9uZWRCb2FyZFt0by5yXVt0by5jXSA9IGNsb25lZEJvYXJkW3Bvcy5yXVtwb3MuY107DQogICAgY2xvbmVkQm9hcmRbcG9zLnJdW3Bvcy5jXSA9IG51bGw7DQogICAgDQogICAgLy8g5qOA5p+l6LWw5rOV5piv5ZCm5ZCI5rOVDQogICAgbGV0IGlzVmFsaWQgPSB0cnVlOw0KICAgIGlmIChpc0ZseWluZ0dlbmVyYWwoY2xvbmVkQm9hcmQpKSB7DQogICAgICBpc1ZhbGlkID0gZmFsc2U7DQogICAgfSBlbHNlIGlmIChpc0NoZWNrKGNsb25lZEJvYXJkLCBwaWVjZS5jb2xvcikpIHsNCiAgICAgIGlzVmFsaWQgPSBmYWxzZTsNCiAgICB9DQogICAgDQogICAgaWYgKGlzVmFsaWQpIHsNCiAgICAgIHZhbGlkTW92ZXMucHVzaCh0byk7DQogICAgfQ0KICB9DQogIA0KICByZXR1cm4gdmFsaWRNb3ZlczsNCn07DQoNCmNvbnN0IGlzVmFsaWRQbGFjZW1lbnQgPSAodHlwZSwgY29sb3IsIHIsIGMpID0+IHsNCiAgICBjb25zdCBpc1JlZCA9IGNvbG9yID09PSAncmVkJzsNCiAgICBzd2l0Y2godHlwZSkgew0KICAgICAgICBjYXNlICdnZW5lcmFsJzoNCiAgICAgICAgICAgIC8vIOW4heWwhuWPquiDveWcqOS5neWuq+S4reW/g+eahOS4gOadoee6v+S4ig0KICAgICAgICAgICAgaWYgKGMgPCAzIHx8IGMgPiA1KSByZXR1cm4gZmFsc2U7DQogICAgICAgICAgICBpZiAoaXNSZWQpIHJldHVybiByID49IDAgJiYgciA8PSAyOw0KICAgICAgICAgICAgZWxzZSByZXR1cm4gciA+PSA3ICYmIHIgPD0gOTsNCiAgICAgICAgY2FzZSAnYWR2aXNvcic6DQogICAgICAgICAgICAvLyDlo6vlj6rog73lnKjkuZ3lrqvnmoQ15Liq54K55LmL5LiADQogICAgICAgICAgICBjb25zdCB2YWxpZEFkdmlzb3JQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgcmVkOiBbWzAsIDNdLCBbMCwgNV0sIFsxLCA0XSwgWzIsIDNdLCBbMiwgNV1dLA0KICAgICAgICAgICAgICAgIGJsYWNrOiBbWzcsIDNdLCBbNywgNV0sIFs4LCA0XSwgWzksIDNdLCBbOSwgNV1dDQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgcmV0dXJuIHZhbGlkQWR2aXNvclBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ10uc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgIGNhc2UgJ2VsZXBoYW50JzoNCiAgICAgICAgICAgIC8vIOebuOWPquiDveWcqOW3seaWueWNiuWcuueahDfkuKrngrnkuYvkuIANCiAgICAgICAgICAgIGNvbnN0IHZhbGlkRWxlcGhhbnRQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgcmVkOiBbWzAsIDJdLCBbMCwgNl0sIFsyLCAwXSwgWzIsIDRdLCBbMiwgOF0sIFs0LCAyXSwgWzQsIDZdXSwNCiAgICAgICAgICAgICAgICBibGFjazogW1s1LCAyXSwgWzUsIDZdLCBbNywgMF0sIFs3LCA0XSwgWzcsIDhdLCBbOSwgMl0sIFs5LCA2XV0NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICByZXR1cm4gdmFsaWRFbGVwaGFudFBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ10uc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgIGNhc2UgJ3NvbGRpZXInOg0KICAgICAgICAgICAgLy8g5YW155qE5L2N572u6ZmQ5Yi277ya6L+H5rKz5YmN5Y+q6IO95Zyo5YG25pWw5YiX77yM6L+H5rKz5ZCO5Y+v5Lul5Zyo5Lu75L2V5YiXDQogICAgICAgICAgICAvLyDnuqLmlrnlhbXov4fmsrPmnaHku7bmmK9yID49IDXvvIzpu5HmlrnlhbXov4fmsrPmnaHku7bmmK9yIDw9IDQNCiAgICAgICAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGlzUmVkID8gciA+PSA1IDogciA8PSA0Ow0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoIWNyb3NzZWRSaXZlcikgew0KICAgICAgICAgICAgICAgIC8vIOi/h+ays+WJjeWPquiDveWcqOWBtuaVsOWIl++8iGM9MCwyLDQsNiw477yJDQogICAgICAgICAgICAgICAgaWYgKCFbMCwgMiwgNCwgNiwgOF0uaW5jbHVkZXMoYykpIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5YW155qE5L2N572u6ZmQ5Yi277ya6L+H5rKz5YmN5Y+q6IO95Zyo5YW15L2N5ZKM5YW15L2N5YmN5pa577yM6L+H5rKz5ZCO5pWM5pa55Y2K5Zy66YO95ZCI5rOVDQogICAgICAgICAgICBjb25zdCB2YWxpZFNvbGRpZXJQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgcmVkOiB7DQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWueWIneWni+WFteS9je+8mnI9MywgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbDogW1szLCAwXSwgWzMsIDJdLCBbMywgNF0sIFszLCA2XSwgWzMsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa55YW15L2N5YmN5pa577yacj00LCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBmb3J3YXJkOiBbWzQsIDBdLCBbNCwgMl0sIFs0LCA0XSwgWzQsIDZdLCBbNCwgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov4fmsrPnur/vvJpyPj01DQogICAgICAgICAgICAgICAgICAgIGNyb3NzZWRSaXZlcjogciA+PSA1DQogICAgICAgICAgICAgICAgfSwNCiAgICAgICAgICAgICAgICBibGFjazogew0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnliJ3lp4vlhbXkvY3vvJpyPTYsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGluaXRpYWw6IFtbNiwgMF0sIFs2LCAyXSwgWzYsIDRdLCBbNiwgNl0sIFs2LCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueWFteS9jeWJjeaWue+8mnI9NSwgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgZm9yd2FyZDogW1s1LCAwXSwgWzUsIDJdLCBbNSwgNF0sIFs1LCA2XSwgWzUsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+H5rKz57q/77yacjw9NA0KICAgICAgICAgICAgICAgICAgICBjcm9zc2VkUml2ZXI6IHIgPD0gNA0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICANCiAgICAgICAgICAgIGNvbnN0IHNvbGRpZXJJbmZvID0gdmFsaWRTb2xkaWVyUG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXTsNCiAgICAgICAgICAgIGNvbnN0IGlzSW5pdGlhbFBvcyA9IHNvbGRpZXJJbmZvLmluaXRpYWwuc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgICAgICBjb25zdCBpc0ZvcndhcmRQb3MgPSBzb2xkaWVySW5mby5mb3J3YXJkLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoc29sZGllckluZm8uY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgICAgICAgICAgLy8g6L+H5rKz5ZCO5pWM5pa55Y2K5Zy66YO95ZCI5rOVDQogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIOi/h+ays+WJjeWPquiDveWcqOWFteS9jeWSjOWFteS9jeWJjeaWuQ0KICAgICAgICAgICAgICAgIHJldHVybiBpc0luaXRpYWxQb3MgfHwgaXNGb3J3YXJkUG9zOw0KICAgICAgICAgICAgfQ0KICAgICAgICBkZWZhdWx0Og0KICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgfQ0KfTsNCg0KY29uc3QgY2hlY2tHYW1lU3RhdGUgPSAoYm9hcmQsIHR1cm4sIHBpZWNlc0luZm8gPSBudWxsLCBib2FyZEluZm8gPSBudWxsKSA9PiB7DQogICAgLy8g5LyY5YWI5L2/55So6aKE6K6h566X55qEZ2FtZVN0YXRlDQogICAgaWYgKGJvYXJkSW5mbyAmJiBib2FyZEluZm8uZ2FtZVN0YXRlKSB7DQogICAgICAgIHJldHVybiBib2FyZEluZm8uZ2FtZVN0YXRlOw0KICAgIH0NCiAgICANCiAgICAvLyDmsqHmnInpooTorqHnrpfnu5Pmnpzml7bvvIzmiafooYzljp/lp4vorqHnrpcNCiAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsNCiAgICBmb3IobGV0IHI9MDsgcjxST1dTOyByKyspIHsNCiAgICAgICAgZm9yKGxldCBjPTA7IGM8Q09MUzsgYysrKSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbcl1bY10/LmNvbG9yID09PSB0dXJuKSB7DQogICAgICAgICAgICAgICAgaWYgKGdldFZhbGlkTW92ZXMoYm9hcmQsIHtyLGN9KS5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmIChoYXNNb3ZlcykgYnJlYWs7DQogICAgfQ0KDQogICAgaWYgKGhhc01vdmVzKSByZXR1cm4geyBzdGF0dXM6ICdwbGF5aW5nJyB9Ow0KDQogICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2soYm9hcmQsIHR1cm4sIHBpZWNlc0luZm8sIGJvYXJkSW5mbyk7DQogICAgY29uc3Qgb3Bwb25lbnQgPSB0dXJuID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICANCiAgICBpZiAoaW5DaGVjaykgew0KICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfSBlbHNlIHsNCiAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgIH0NCn07DQoNCg0KDQovLyDlop7lvLrnmoTmuLjmiI/pmLbmrrXor4bliKsNCmNvbnN0IGdldEdhbWVQaGFzZSA9IChib2FyZCkgPT4gew0KICAvKg0KICBjb25zdCBwaWVjZUNvdW50ID0gY291bnRQaWVjZXMoYm9hcmQpOw0KICANCiAgaWYgKHBpZWNlQ291bnQgPD0gOCkgcmV0dXJuICdlbmRnYW1lJzsNCiAgaWYgKHBpZWNlQ291bnQgPD0gMTYpIHJldHVybiAnbWlkZGxlZ2FtZSc7DQogIHJldHVybiAnb3BlbmluZyc7DQogICovDQogIHJldHVybiAnb3BlbmluZyc7DQp9Ow0KDQovLyDliqjmgIHmnYPph43orqHnrpcNCmNvbnN0IGNhbGN1bGF0ZUR5bmFtaWNXZWlnaHRzID0gKHBoYXNlKSA9PiB7DQogIHN3aXRjaCAocGhhc2UpIHsNCiAgICBjYXNlICdvcGVuaW5nJzoNCiAgICAgIHJldHVybiB7IG1hdGVyaWFsOiA4LCBwb3NpdGlvbjogMiwgdGFjdGljOiA2LCBzYWZldHk6IDQsIG1vYmlsaXR5OiA3LCB0aHJlYXQ6IDMgfTsNCiAgICBjYXNlICdtaWRkbGVnYW1lJzoNCiAgICAgIHJldHVybiB7IG1hdGVyaWFsOiA2LCBwb3NpdGlvbjogOSwgdGFjdGljOiA3LCBzYWZldHk6IDYsIG1vYmlsaXR5OiA4LCB0aHJlYXQ6IDcgfTsNCiAgICBjYXNlICdlbmRnYW1lJzoNCiAgICAgIHJldHVybiB7IG1hdGVyaWFsOiA5LCBwb3NpdGlvbjogNywgdGFjdGljOiAyLCBzYWZldHk6IDgsIG1vYmlsaXR5OiA0LCB0aHJlYXQ6IDkgfTsNCiAgICBkZWZhdWx0Og0KICAgICAgcmV0dXJuIHsgbWF0ZXJpYWw6IDgsIHBvc2l0aW9uOiA1LCB0YWN0aWM6IDUsIHNhZmV0eTogNiwgbW9iaWxpdHk6IDUsIHRocmVhdDogNSB9Ow0KICB9DQp9Ow0KDQovLyDorqHnrpfmo4vlrZDmgLvmlbANCmNvbnN0IGNvdW50UGllY2VzID0gKGJvYXJkKSA9PiB7DQogIGxldCBjb3VudCA9IDA7DQogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgIGlmIChib2FyZFtyXVtjXSkgY291bnQrKzsNCiAgICB9DQogIH0NCiAgcmV0dXJuIGNvdW50Ow0KfTsNCg0KLy8g5a6e5L6L5YyWWm9icmlzdEhhc2hlcg0KY29uc3Qgem9icmlzdEhhc2hlciA9IG5ldyBab2JyaXN0SGFzaGVyKCk7DQoNCi8vIOe9ruaNouihqOWunueOsA0KY2xhc3MgVHJhbnNwb3NpdGlvblRhYmxlIHsNCiAgICBjb25zdHJ1Y3RvcihzaXplID0gTWF0aC5wb3coMiwgMjQpKSB7DQogICAgICAgIHRoaXMudGFibGUgPSBuZXcgTWFwKCk7DQogICAgICAgIHRoaXMuc2l6ZSA9IHNpemU7DQogICAgICAgIHRoaXMuaGFzaGVyID0gem9icmlzdEhhc2hlcjsNCiAgICAgICAgLy8g57uf6K6h5L+h5oGvDQogICAgICAgIHRoaXMuc3RhdHMgPSB7DQogICAgICAgICAgICBoaXRzOiAwLA0KICAgICAgICAgICAgbWlzc2VzOiAwLA0KICAgICAgICAgICAgZXhhY3RIaXRzOiAwLA0KICAgICAgICAgICAgbG93ZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICB1cHBlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHN0b3JlczogMCwNCiAgICAgICAgICAgIGxydUV2aWN0aW9uczogMCwNCiAgICAgICAgICAgIGNsZWFyczogMA0KICAgICAgICB9Ow0KICAgIH0NCiAgICANCiAgICBzdG9yZShoYXNoLCBkZXB0aCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlID0gbnVsbCkgew0KICAgICAgICBpZiAodGhpcy50YWJsZS5zaXplID49IHRoaXMuc2l6ZSkgew0KICAgICAgICAgICAgLy8g566A5Y2V55qETFJV562W55Wl77ya56e76Zmk56ys5LiA5Liq5YWD57SgDQogICAgICAgICAgICBjb25zdCBmaXJzdEtleSA9IHRoaXMudGFibGUua2V5cygpLm5leHQoKS52YWx1ZTsNCiAgICAgICAgICAgIHRoaXMudGFibGUuZGVsZXRlKGZpcnN0S2V5KTsNCiAgICAgICAgICAgIHRoaXMuc3RhdHMubHJ1RXZpY3Rpb25zKys7DQogICAgICAgIH0NCiAgICAgICAgdGhpcy50YWJsZS5zZXQoaGFzaCwgeyBkZXB0aCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlIH0pOw0KICAgICAgICB0aGlzLnN0YXRzLnN0b3JlcysrOw0KICAgIH0NCiAgICANCiAgICByZXRyaWV2ZShoYXNoKSB7DQogICAgICAgIGNvbnN0IGVudHJ5ID0gdGhpcy50YWJsZS5nZXQoaGFzaCkgfHwgbnVsbDsNCiAgICAgICAgaWYgKGVudHJ5KSB7DQogICAgICAgICAgICB0aGlzLnN0YXRzLmhpdHMrKzsNCiAgICAgICAgICAgIC8vIOe7n+iuoeS4jeWQjOexu+Wei+eahOWRveS4rQ0KICAgICAgICAgICAgc3dpdGNoIChlbnRyeS5mbGFnKSB7DQogICAgICAgICAgICAgICAgY2FzZSAnZXhhY3QnOg0KICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLmV4YWN0SGl0cysrOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICBjYXNlICdsb3dlcmJvdW5kJzoNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0cy5sb3dlcmJvdW5kSGl0cysrOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICBjYXNlICd1cHBlcmJvdW5kJzoNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0cy51cHBlcmJvdW5kSGl0cysrOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIHRoaXMuc3RhdHMubWlzc2VzKys7DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIGVudHJ5Ow0KICAgIH0NCiAgICANCiAgICBjbGVhcigpIHsNCiAgICAgICAgdGhpcy50YWJsZS5jbGVhcigpOw0KICAgICAgICB0aGlzLnN0YXRzLmNsZWFycysrOw0KICAgIH0NCiAgICANCiAgICAvLyDojrflj5bnu5/orqHkv6Hmga/lubborqHnrpflkb3kuK3njocNCiAgICBnZXRTdGF0cygpIHsNCiAgICAgICAgY29uc3QgdG90YWxBY2Nlc3NlcyA9IHRoaXMuc3RhdHMuaGl0cyArIHRoaXMuc3RhdHMubWlzc2VzOw0KICAgICAgICBjb25zdCBoaXRSYXRlID0gdG90YWxBY2Nlc3NlcyA+IDAgPyAodGhpcy5zdGF0cy5oaXRzIC8gdG90YWxBY2Nlc3NlcyAqIDEwMCkudG9GaXhlZCgyKSA6IDA7DQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICAuLi50aGlzLnN0YXRzLA0KICAgICAgICAgICAgdG90YWxBY2Nlc3NlcywNCiAgICAgICAgICAgIGhpdFJhdGUsDQogICAgICAgICAgICBjdXJyZW50U2l6ZTogdGhpcy50YWJsZS5zaXplLA0KICAgICAgICAgICAgbWF4U2l6ZTogdGhpcy5zaXplLA0KICAgICAgICAgICAgZmlsbFBlcmNlbnRhZ2U6ICh0aGlzLnRhYmxlLnNpemUgLyB0aGlzLnNpemUgKiAxMDApLnRvRml4ZWQoMikNCiAgICAgICAgfTsNCiAgICB9DQogICAgDQogICAgLy8g6YeN572u57uf6K6h5L+h5oGvDQogICAgcmVzZXRTdGF0cygpIHsNCiAgICAgICAgdGhpcy5zdGF0cyA9IHsNCiAgICAgICAgICAgIGhpdHM6IDAsDQogICAgICAgICAgICBtaXNzZXM6IDAsDQogICAgICAgICAgICBleGFjdEhpdHM6IDAsDQogICAgICAgICAgICBsb3dlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHVwcGVyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgc3RvcmVzOiAwLA0KICAgICAgICAgICAgbHJ1RXZpY3Rpb25zOiAwLA0KICAgICAgICAgICAgY2xlYXJzOiAwDQogICAgICAgIH07DQogICAgfQ0KfQ0KDQovLyDmgKfog73nu5/orqENCmxldCBwZXJmU3RhdHMgPSB7DQogICAgZXZhbHVhdGVCb2FyZENvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwNCiAgICBwcmVwYXJlU2VhcmNoSW5mb0NvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwNCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sDQogICAgYWxwaGFCZXRhQ2FsbHM6IDAsICAvLyDmgLvosIPnlKjmrKHmlbANCiAgICBub2Rlc1NlYXJjaGVkOiB7fSwgLy8g5oyJ5rex5bqm57uf6K6h5pCc57Si55qE6IqC54K55pWwDQogICAgbW92ZXNHZW5lcmF0ZWQ6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHnlJ/miJDnmoTotbDms5XmlbANCiAgICBjdXRvZmZzOiB7fSwgLy8g5oyJ5rex5bqm57uf6K6h5Ymq5p6d5qyh5pWwDQogICAgc3RhcnRUaW1lOiBEYXRlLm5vdygpDQp9Ow0KDQovLyDph43nva7nu5/orqHvvIjmr4/mrKHmkJzntKLlvIDlp4vml7bosIPnlKjvvIkNCmNvbnN0IHJlc2V0UGVyZlN0YXRzID0gKCkgPT4gew0KICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsNCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscyA9IDA7DQogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWQgPSB7fTsNCiAgICBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWQgPSB7fTsNCiAgICBwZXJmU3RhdHMuY3V0b2ZmcyA9IHt9Ow0KICAgIHBlcmZTdGF0cy5zdGFydFRpbWUgPSBEYXRlLm5vdygpOw0KfTsNCg0KLy8g5omT5Y2w57uf6K6h5L+h5oGvDQpjb25zdCBsb2dQZXJmU3RhdHMgPSAoY3VycmVudFBsYXllcikgPT4gew0KICAgIGNvbnN0IGVsYXBzZWQgPSBEYXRlLm5vdygpIC0gcGVyZlN0YXRzLnN0YXJ0VGltZTsNCiAgICBjb25zb2xlLmxvZyhg8J+TiiDmgKfog73nu5/orqEgKCR7Y3VycmVudFBsYXllcn0pIC0gJHtlbGFwc2VkfW1zOmApOw0KICAgIGNvbnNvbGUubG9nKGAgICBldmFsdWF0ZUJvYXJkOiByZWQ9JHtwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50LnJlZH0sIGJsYWNrPSR7cGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRDb3VudC5ibGFja31gKTsNCiAgICBjb25zb2xlLmxvZyhgICAgcHJlcGFyZVNlYXJjaEluZm86IHJlZD0ke3BlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50LnJlZH0sIGJsYWNrPSR7cGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnQuYmxhY2t9YCk7DQogICAgY29uc29sZS5sb2coYCAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlczogcmVkPSR7cGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50LnJlZH0sIGJsYWNrPSR7cGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50LmJsYWNrfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBhbHBoYUJldGHosIPnlKjmrKHmlbA6ICR7cGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzfWApOw0KICAgIA0KICAgIC8vIOaJk+WNsOaMiea3seW6pue7n+iuoeeahOiKgueCueaVsOOAgei1sOazleaVsOOAgeWJquaeneaVsA0KICAgIGNvbnN0IGRlcHRocyA9IE9iamVjdC5rZXlzKHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkKS5zb3J0KChhLCBiKSA9PiBhIC0gYik7DQogICAgaWYgKGRlcHRocy5sZW5ndGggPiAwKSB7DQogICAgICAgIGNvbnNvbGUubG9nKCcgICDmjInmt7Hluqbnu5/orqE6Jyk7DQogICAgICAgIGZvciAoY29uc3QgZCBvZiBkZXB0aHMpIHsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICAgIOa3seW6piR7ZH06IOiKgueCuT0ke3BlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdfSwg6LWw5rOVPSR7cGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdIHx8IDB9LCDliarmnp09JHtwZXJmU3RhdHMuY3V0b2Zmc1tkXSB8fCAwfWApOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KY29uc3QgdHJhbnNwb3NpdGlvblRhYmxlID0gbmV3IFRyYW5zcG9zaXRpb25UYWJsZSgpOw0KDQovLyBXb3JrZXIgbWVzc2FnZSBoYW5kbGluZw0KaWYgKHR5cGVvZiBzZWxmICE9PSAndW5kZWZpbmVkJykgew0KICAgIHNlbGYub25tZXNzYWdlID0gZnVuY3Rpb24oZSkgew0KICAgIGNvbnN0IHsgdHlwZSwgcGF5bG9hZCB9ID0gZS5kYXRhOw0KICAgIA0KICAgIHN3aXRjaCAodHlwZSkgeyAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdTRUFSQ0gnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBzZWFyY2hCb2FyZCwgdHVybjogc2VhcmNoVHVybiwgZGVwdGg6IHNlYXJjaERlcHRoLCByYW5kb21uZXNzOiBzZWFyY2hSYW5kb21uZXNzLCBnYW1lSWQsIG9wZW5pbmdCb29rRW5hYmxlZDogc2VhcmNoT3BlbmluZ0Jvb2tFbmFibGVkID0gdHJ1ZSwgcGx5OiBzZWFyY2hQbHkgPSAwLCBlbmFibGVUaW1lTGltaXQ6IHNlYXJjaEVuYWJsZVRpbWVMaW1pdCA9IGZhbHNlIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgLy8gU2V0IG9wZW5pbmcgYm9vayBlbmFibGVkIHN0YXR1cw0KICAgICAgICAgICAgb3BlbmluZ0Jvb2suc2V0RW5hYmxlZChzZWFyY2hPcGVuaW5nQm9va0VuYWJsZWQpOw0KICAgICAgICAgICAgLy8g6K6w5b2V5pCc57Si5byA5aeL5pe26Ze0DQogICAgICAgICAgICBjb25zdCBzdGFydFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKTsNCiAgICAgICAgICAgIC8vIOaJp+ihjOaQnOe0og0KICAgICAgICAgICAgY29uc3QgYmVzdFNlYXJjaE1vdmUgPSBnZXRCZXN0TW92ZShzZWFyY2hCb2FyZCwgc2VhcmNoVHVybiwgc2VhcmNoRGVwdGgsIHNlYXJjaFJhbmRvbW5lc3MsIHNlYXJjaFBseSwgc2VhcmNoRW5hYmxlVGltZUxpbWl0KTsNCiAgICAgICAgICAgIC8vIOiusOW9leaQnOe0oue7k+adn+aXtumXtOW5tuiuoeeul+aAneiAg+aXtumXtA0KICAgICAgICAgICAgY29uc3QgZW5kVGltZSA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgICAgICAgICAgY29uc3QgdGhpbmtpbmdUaW1lID0gZW5kVGltZSAtIHN0YXJ0VGltZTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5qOA5p+l5piv5ZCm5p2l6Ieq5byA5bGA5bqTDQogICAgICAgICAgICBjb25zdCBib29rTW92ZVNlYXJjaCA9IG9wZW5pbmdCb29rLmdldEJvb2tNb3ZlKHNlYXJjaEJvYXJkLCBzZWFyY2hQbHkpOw0KICAgICAgICAgICAgY29uc3QgZnJvbUJvb2tTZWFyY2ggPSAhIWJvb2tNb3ZlU2VhcmNoICYmIEpTT04uc3RyaW5naWZ5KGJvb2tNb3ZlU2VhcmNoKSA9PT0gSlNPTi5zdHJpbmdpZnkoYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmUpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmt7vliqDmgKfog73nu5/orqHml6Xlv5cNCiAgICAgICAgICAgIGxvZ1BlcmZTdGF0cyhzZWFyY2hUdXJuKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5re75Yqg5oCd6ICD5pe26Ze05pel5b+XDQogICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VhcmNoIGNvbXBsZXRlZCBpbiAke01hdGgucm91bmQodGhpbmtpbmdUaW1lKX1tcywgZ2FtZUlkPSR7Z2FtZUlkfSwgYmVzdE1vdmU9JHtKU09OLnN0cmluZ2lmeShiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSl9LCBzZWNvbmRCZXN0TW92ZT0ke0pTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlKX0sIGZyb21Cb29rPSR7ZnJvbUJvb2tTZWFyY2h9YCk7DQogICAgICAgICAgICAvLyDlj5HpgIHmkJzntKLnu5PmnpzlkozmgJ3ogIPml7bpl7QNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnU0VBUkNIX0NPTVBMRVRFJywgDQogICAgICAgICAgICAgICAgcGF5bG9hZDogeyANCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmU6IGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlLCANCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kQmVzdE1vdmU6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlLCANCiAgICAgICAgICAgICAgICAgICAgZ2FtZUlkLCANCiAgICAgICAgICAgICAgICAgICAgZnJvbUJvb2s6IGZyb21Cb29rU2VhcmNoLCANCiAgICAgICAgICAgICAgICAgICAgdGhpbmtpbmdUaW1lOiBNYXRoLnJvdW5kKHRoaW5raW5nVGltZSksIC8vIOWbm+iIjeS6lOWFpeWIsOavq+enkg0KICAgICAgICAgICAgICAgICAgICBtb3ZlU2VxdWVuY2U6IGJlc3RTZWFyY2hNb3ZlLm1vdmVTZXF1ZW5jZSwNCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kTW92ZVNlcXVlbmNlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRNb3ZlU2VxdWVuY2UsDQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2NvcmU6IGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlU2NvcmUsDQogICAgICAgICAgICAgICAgICAgIHNlY29uZEJlc3RNb3ZlU2NvcmU6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlU2NvcmUsDQogICAgICAgICAgICAgICAgICAgIGFsbE1vdmVzV2l0aFNjb3JlczogYmVzdFNlYXJjaE1vdmUuYWxsTW92ZXNXaXRoU2NvcmVzIHx8IFtdDQogICAgICAgICAgICAgICAgfSANCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnZ2V0VmFsaWRNb3Zlcyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHZtQm9hcmQsIHBvczogdm1Qb3MgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCB2YWxpZE1vdmVzID0gZ2V0VmFsaWRNb3Zlcyh2bUJvYXJkLCB2bVBvcyk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAndmFsaWRNb3ZlcycsDQogICAgICAgICAgICAgICAgbW92ZXM6IHZhbGlkTW92ZXMNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdnZXRQaWVjZVJlbGF0aW9ucyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHByQm9hcmQsIHBvczogcHJQb3MgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IHByQm9hcmRbcHJQb3Mucl1bcHJQb3MuY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOiwg+eUqGV2YWx1YXRlQm9hcmTojrflj5blrozmlbTnmoTmo4vlrZDkv6Hmga/lkoxib2FyZEluZm8NCiAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKHByQm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQogICAgICAgICAgICBjb25zdCBib2FyZEV2YWx1YXRpb24gPSBldmFsdWF0ZUJvYXJkKHByQm9hcmQsIGZhbHNlLCBudWxsLCAwLCBudWxsLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgY29uc3QgcGllY2VzSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5waWVjZXNJbmZvOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRJbmZvID0gYm9hcmRFdmFsdWF0aW9uLmJvYXJkSW5mbzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gR2V0IHRoZSBjdXJyZW50IHBvc2l0aW9uJ3MgY29udHJvbGxlcnMgZnJvbSBib2FyZEluZm8NCiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJzID0gYm9hcmRJbmZvW3ByUG9zLnJdW3ByUG9zLmNdIHx8IFtdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBsZXQgcmVsYXRpb25zID0gew0KICAgICAgICAgICAgICAgIHRocmVhdDogW10sIA0KICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeTogW10sIA0KICAgICAgICAgICAgICAgIGd1YXJkOiBbXSwgDQogICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwgDQogICAgICAgICAgICAgICAgY29udHJvbDogW10sDQogICAgICAgICAgICAgICAgY29udHJvbGxlcnM6IGNvbnRyb2xsZXJzIC8vIOa3u+WKoOaOp+WItuiAheS/oeaBr++8jOeOsOWcqOaYr+S9jee9ruaVsOe7hCBbe3IsY31dIA0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5aaC5p6c54K55Ye755qE5piv5qOL5a2Q77yM6L+U5Zue6K+l5qOL5a2Q55qE5YWz57O75L+h5oGvDQogICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBjdXJyZW50IHBpZWNlIGluZm8NCiAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50UGllY2VJbmZvID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSBwclBvcy5yICYmIHAuYyA9PT0gcHJQb3MuYyk7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRQaWVjZUluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gRXh0cmFjdCByZWxhdGlvbnMNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGhyZWF0ID0gY3VycmVudFBpZWNlSW5mby50aHJlYXQubWFwKHRocmVhdFBpZWNlID0+ICh7IHI6IHRocmVhdFBpZWNlLnIsIGM6IHRocmVhdFBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0aHJlYXRlbmVkQnkgPSBjdXJyZW50UGllY2VJbmZvLnRocmVhdGVuZWRCeS5tYXAodGhyZWF0ZW5lZEJ5UGllY2UgPT4gKHsgcjogdGhyZWF0ZW5lZEJ5UGllY2UuciwgYzogdGhyZWF0ZW5lZEJ5UGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGd1YXJkID0gY3VycmVudFBpZWNlSW5mby5ndWFyZC5tYXAoZ3VhcmRQaWVjZSA9PiAoeyByOiBndWFyZFBpZWNlLnIsIGM6IGd1YXJkUGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGd1YXJkZWRCeSA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmRlZEJ5Lm1hcChndWFyZGVkQnlQaWVjZSA9PiAoeyByOiBndWFyZGVkQnlQaWVjZS5yLCBjOiBndWFyZGVkQnlQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udHJvbCA9IGN1cnJlbnRQaWVjZUluZm8uY29udHJvbC5tYXAoY29udHJvbFBvcyA9PiAoeyByOiBjb250cm9sUG9zLnIsIGM6IGNvbnRyb2xQb3MuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICByZWxhdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQsIA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5LCANCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkLCANCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkZWRCeSwgDQogICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sLA0KICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbGxlcnMNCiAgICAgICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZVJlbGF0aW9ucycsDQogICAgICAgICAgICAgICAgcmVsYXRpb25zOiByZWxhdGlvbnMNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdjaGVja0dhbWVTdGF0ZSc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGNnc0JvYXJkLCB0dXJuOiBjZ3NUdXJuLCByZXF1ZXN0SWQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBnYW1lU3RhdGUgPSBjaGVja0dhbWVTdGF0ZShjZ3NCb2FyZCwgY2dzVHVybik7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAnZ2FtZVN0YXRlJywNCiAgICAgICAgICAgICAgICBzdGF0ZTogZ2FtZVN0YXRlLA0KICAgICAgICAgICAgICAgIHJlcXVlc3RJZA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2V2YWx1YXRlQm9hcmQnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBldmFsQm9hcmQsIHR1cm46IGV2YWxUdXJuLCBpc1JlcGxheSA9IGZhbHNlLCBkZXB0aCA9IDEgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICAvLyDmiZPljbDmjqXmlLbnmoTlj4LmlbANCiAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ2V2YWx1YXRlQm9hcmQgY2FsbGVkIHdpdGg6JywgeyB0dXJuOiBldmFsVHVybiwgaXNSZXBsYXksIGRlcHRoIH0pOw0KICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoZXZhbEJvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgY29uc3QgZGV0YWlsZWRFdmFsID0gZXZhbHVhdGVCb2FyZChldmFsQm9hcmQsIGlzUmVwbGF5LCBldmFsVHVybiwgZGVwdGgsIGV2YWxUdXJuLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2RldGFpbGVkRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZGV0YWlsZWRFdmFsDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQoNCiAgICAgICAgY2FzZSAnZXZhbHVhdGVQaWVjZSc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHBpZWNlRXZhbEJvYXJkLCBwb3M6IHBpZWNlRXZhbFBvcywgdHVybiB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gcGllY2VFdmFsQm9hcmRbcGllY2VFdmFsUG9zLnJdW3BpZWNlRXZhbFBvcy5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFwaWVjZSkgew0KICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogew0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiAwDQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQogICAgICAgICAgICBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDkuLvliqjosIPnlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE6K+E5Lyw5L+h5oGvDQogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5ri45oiP6Zi25q61DQogICAgICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UocGllY2VFdmFsQm9hcmQpOw0KICAgICAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgICAgIGNvbnN0IGJvYXJkRXZhbHVhdGlvbiA9IGV2YWx1YXRlQm9hcmQocGllY2VFdmFsQm9hcmQsIGZhbHNlLCB0dXJuLCAwLCB0dXJuLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIOS7jmV2YWx1YXRlQm9hcmTnmoTov5Tlm57lgLzkuK3mib7liLDlvZPliY3mo4vlrZDnmoTkv6Hmga8NCiAgICAgICAgICAgICAgICBjdXJyZW50UGllY2VJbmZvID0gYm9hcmRFdmFsdWF0aW9uLnBpZWNlc0luZm8uZmluZCgNCiAgICAgICAgICAgICAgICAgICAgcCA9PiBwLnIgPT09IHBpZWNlRXZhbFBvcy5yICYmIHAuYyA9PT0gcGllY2VFdmFsUG9zLmMNCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGllY2VJbmZvKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOW6lOeUqOadg+mHjeW5tui/lOWbnuWNleS4quaji+WtkOeahOivhOS8sOWAvA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBldmFsdWF0aW9uID0gew0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IGN1cnJlbnRQaWVjZUluZm8ubWF0ZXJpYWxWYWx1ZSAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogY3VycmVudFBpZWNlSW5mby5wb3NpdGlvblZhbHVlICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiBjdXJyZW50UGllY2VJbmZvLm1vYmlsaXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiBjdXJyZW50UGllY2VJbmZvLnRocmVhdFZhbHVlICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IGN1cnJlbnRQaWVjZUluZm8uc2FmZXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogY3VycmVudFBpZWNlSW5mby50YWN0aWNWYWx1ZSAqIFZBTFVFX1dFSUdIVFMudGFjdGljDQogICAgICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZXZhbHVhdGlvbg0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDlpoLmnpzku43nhLbmib7kuI3liLDmo4vlrZDkv6Hmga/vvIzov5Tlm57pu5jorqTlgLwNCiAgICAgICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMA0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnaXNDaGVjayc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGNCb2FyZCwgY29sb3I6IGNDb2xvciwgcmVxdWVzdElkIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2soY0JvYXJkLCBjQ29sb3IpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2NoZWNrJywNCiAgICAgICAgICAgICAgICBpc0NoZWNrOiBpbkNoZWNrLA0KICAgICAgICAgICAgICAgIHJlcXVlc3RJZA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2lzVmFsaWRQbGFjZW1lbnQnOiB7DQogICAgICAgICAgICBjb25zdCB7IHR5cGU6IGlwVHlwZSwgY29sb3I6IGlwQ29sb3IsIHIsIGMgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCB2YWxpZFBsYWNlbWVudCA9IGlzVmFsaWRQbGFjZW1lbnQoaXBUeXBlLCBpcENvbG9yLCByLCBjKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICd2YWxpZFBsYWNlbWVudCcsDQogICAgICAgICAgICAgICAgaXNWYWxpZDogdmFsaWRQbGFjZW1lbnQNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcnOiB7DQogICAgICAgICAgICBjb25zdCB7IG1vdmVzLCB3ZWlnaHRzIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgLy8gQWRkIHRoZSBvcGVuaW5nIGxpbmUgdG8gdGhlIG9wZW5pbmcgYm9vaw0KICAgICAgICAgICAgb3BlbmluZ0Jvb2suYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKFttb3Zlc10sIHdlaWdodHMpOw0KICAgICAgICAgICAgLy8gU2VuZCBjb25maXJtYXRpb24NCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnb3BlbmluZ0xpbmVBZGRlZCcsIA0KICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUgDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnbW92ZXNUb05vdGF0aW9uJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5IH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3Qgbm90YXRpb24gPSBvcGVuaW5nQm9vay5tb3Zlc1RvTm90YXRpb24oYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ25vdGF0aW9uJywgDQogICAgICAgICAgICAgICAgbm90YXRpb246IG5vdGF0aW9uIA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ25vdGF0aW9uVG9Nb3Zlcyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgbm90YXRpb246IG5vdGF0aW9uU3RyaW5nLCBpbml0aWFsQm9hcmQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBtb3Zlc0Zyb21Ob3RhdGlvbiA9IG9wZW5pbmdCb29rLm5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvblN0cmluZywgaW5pdGlhbEJvYXJkKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnbW92ZXMnLCANCiAgICAgICAgICAgICAgICBtb3ZlczogbW92ZXNGcm9tTm90YXRpb24gDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnc2V0VmFsdWVXZWlnaHRzJzogew0KICAgICAgICAgICAgVkFMVUVfV0VJR0hUUyA9IHsgLi4uVkFMVUVfV0VJR0hUUywgLi4ucGF5bG9hZCB9Ow0KICAgICAgICAgICAgY29uc29sZS5sb2coJ1VwZGF0ZWQgVkFMVUVfV0VJR0hUUzonLCBWQUxVRV9XRUlHSFRTKTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KICAgIC8vIE92ZXJyaWRlIGNvbnNvbGUubG9nIHRvIHNlbmQgbWVzc2FnZXMgYmFjayB0byBtYWluIHRocmVhZA0KICAgIGNvbnN0IG9yaWdpbmFsQ29uc29sZUxvZyA9IGNvbnNvbGUubG9nOw0KICAgIGNvbnNvbGUubG9nID0gZnVuY3Rpb24oLi4uYXJncykgew0KICAgICAgICAvLyBTZW5kIHRvIG1haW4gdGhyZWFkDQogICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgdHlwZTogJ2xvZycsDQogICAgICAgICAgICBkYXRhOiBhcmdzLmpvaW4oJyAnKQ0KICAgICAgICB9KTsNCiAgICAgICAgDQogICAgICAgIC8vIEFsc28gbG9nIHRvIHdvcmtlciBjb25zb2xlDQogICAgICAgIG9yaWdpbmFsQ29uc29sZUxvZy5hcHBseShjb25zb2xlLCBhcmdzKTsNCiAgICB9Ow0KfQ0KDQovLyDov63ku6PliqDmt7HmkJzntKLlrp7njrANCmNvbnN0IGl0ZXJhdGl2ZURlZXBlbmluZyA9IChib2FyZCwgdHVybiwgbWF4RGVwdGggPSA0LCB0aW1lTGltaXQgPSA1MDAwLCBlbmFibGVUaW1lTGltaXQgPSBmYWxzZSkgPT4gew0KICAvLyDph43nva7mgKfog73nu5/orqENCiAgcmVzZXRQZXJmU3RhdHMoKTsNCiAgDQogIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7DQogIGxldCBiZXN0TW92ZSA9IG51bGw7DQogIGxldCBzZWNvbmRCZXN0TW92ZSA9IG51bGw7DQoNCiAgLy8g5riF56m6572u5o2i6KGoDQogIHRyYW5zcG9zaXRpb25UYWJsZS5yZXNldFN0YXRzKCk7DQogIHRyYW5zcG9zaXRpb25UYWJsZS5jbGVhcigpOw0KICANCiAgLy8g56ys5LiA5q2l77ya6I635Y+W5b2T5YmN5ri45oiP6Zi25q61DQogIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKGJvYXJkKTsNCiAgLy8g5bCG5ri45oiP6Zi25q616L2s5o2i5Li65p2Q5paZ5YC86K6h566X5omA6ZyA55qE5qC85byPDQogIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KDQogIC8vIOS9v+eUqGV2YWx1YXRlQm9hcmTojrflj5blrozmlbTnmoTor4TkvLDkv6Hmga/vvIjljIXmi6xwaWVjZXNJbmZv5ZKMYm9hcmRJbmZv77yJDQogIGNvbnN0IHJvb3RFdmFsUmVzdWx0ID0gZXZhbHVhdGVCb2FyZChib2FyZCwgZmFsc2UsIHR1cm4sIDAsIHR1cm4sIGdhbWVTdGFnZSk7DQogIGNvbnN0IHJvb3RQaWVjZXNJbmZvID0gcm9vdEV2YWxSZXN1bHQucGllY2VzSW5mbzsNCiAgY29uc3Qgcm9vdEJvYXJkSW5mbyA9IHJvb3RFdmFsUmVzdWx0LmJvYXJkSW5mbzsNCg0KICAvLyDmlLbpm4bmiYDmnInmoLnoioLngrnotbDms5XvvJvmnKrooqvlsIbml7bov4fmu6TpgIHlkIPvvIzooqvlsIbml7bkv53nlZnlhajpg6jlkIjms5XlupTlsIbnnYDms5UNCiAgbGV0IHJvb3RNb3ZlcyA9IFtdOw0KICBjb25zdCByb290SW5DaGVjayA9ICh0dXJuID09PSAncmVkJyAmJiByb290Qm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwNCiAgICAgICAgICAgICAgICAgICAgICAodHVybiA9PT0gJ2JsYWNrJyAmJiByb290Qm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKTsNCiAgDQogIC8vIOaUtumbhuagueiKgueCuei1sOazle+8jOS9v+eUqOmihOiuoeeul+eahGJvYXJkSW5mb+WSjHBpZWNlc0luZm8NCiAgLy9jb25zb2xlLmxvZyhg5byA5aeL5pS26ZuG5qC56IqC54K56LWw5rOV77yM5b2T5YmN546p5a62OiAke3R1cm59YCk7DQogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHIsIGMgfSk7DQogICAgICAgIC8vY29uc29sZS5sb2coYOaji+WtkCgke3J9LCR7Y30pICR7cGllY2UudHlwZX0g5pyJICR7dmFsaWREZXN0aW5hdGlvbnMubGVuZ3RofSDkuKrmnInmlYjnp7vliqhgKTsNCiAgICAgICAgdmFsaWREZXN0aW5hdGlvbnMuZm9yRWFjaCh0byA9PiB7DQogICAgICAgICAgLy8g6KKr5bCG5pe25LiN5b6X55So6YCB5ZCD6L+H5ruk5Lii5o6J5ZSv5LiA5Ye66Lev77yb5ZCm5YiZ5qOA5p+l55uu5qCH5piv5ZCm5Y+v5o6l5Y+XDQogICAgICAgICAgY29uc3QgaXNBY2NlcHRhYmxlID0gcm9vdEluQ2hlY2sgfHwgaXNQb3NpdGlvbkFjY2VwdGFibGUoYm9hcmQsIHsgciwgYyB9LCB0bywgdHVybiwgcm9vdEJvYXJkSW5mbywgcm9vdFBpZWNlc0luZm8sIHBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgIC8vY29uc29sZS5sb2coYOenu+WKqCAoJHtyfSwke2N9KSAtPiAoJHt0by5yfSwke3RvLmN9KSDmmK/lkKblronlhag6ICR7aXNBY2NlcHRhYmxlfWApOw0KICAgICAgICAgIGlmIChpc0FjY2VwdGFibGUpIHsNCiAgICAgICAgICAgIHJvb3RNb3Zlcy5wdXNoKHsgZnJvbToge3IsY30sIHRvLCBzY29yZTogMCB9KTsNCiAgICAgICAgICAgIC8vY29uc29sZS5sb2coYOa3u+WKoOWuieWFqOenu+WKqDogKCR7cn0sJHtjfSkgLT4gKCR7dG8ucn0sJHt0by5jfSlgKTsNCiAgICAgICAgICB9DQogICAgICAgIH0pOw0KICAgICAgfQ0KICAgIH0NCiAgfQ0KICAvL2NvbnNvbGUubG9nKGDmoLnoioLngrnotbDms5XmlLbpm4blrozmiJDvvIzlhbHmlLbpm4bliLAgJHtyb290TW92ZXMubGVuZ3RofSDkuKrlronlhajnp7vliqhgKTsNCg0KICAvLyDlr7nmoLnoioLngrnnnYDms5Xov5vooYzmjpLluo/vvIzkvKDpgJJnYW1lU3RhZ2Xlkoxib2FyZEluZm/pgb/lhY3ph43lpI3orqHnrpcNCiAgcm9vdE1vdmVzID0gc29ydE1vdmVzKHJvb3RNb3ZlcywgYm9hcmQsIHR1cm4sIHJvb3RQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIHJvb3RCb2FyZEluZm8pOw0KICAgIA0KICBsZXQgZGVwdGggPSBtYXhEZXB0aDsgIA0KICAvLyDmo4Dmn6Xml7bpl7TpmZDliLYNCiAgaWYgKGVuYWJsZVRpbWVMaW1pdCAmJiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lID4gdGltZUxpbWl0KSB7DQogICAgY29uc29sZS5sb2coYEl0ZXJhdGl2ZSBEZWVwZW5pbmcgc3RvcHBlZCBhdCBkZXB0aCAke2RlcHRoLTF9IGR1ZSB0byB0aW1lIGxpbWl0YCk7DQogIH0NCiAgY29uc29sZS5sb2coYFN0YXJ0aW5nIGRlcHRoICR7ZGVwdGh9IHNlYXJjaCB8IHR1cm46ICR7dHVybn0sIG1heERlcHRoOiAke21heERlcHRofSwgdGltZUxpbWl0OiAke3RpbWVMaW1pdH1tcywgZW5hYmxlVGltZUxpbWl0OiAke2VuYWJsZVRpbWVMaW1pdH1gKTsNCiAgDQogIA0KICAvLyDlr7nmr4/kuKrmoLnoioLngrnotbDms5Xov5vooYxhbHBoYS1iZXRh5pCc57SiDQogIGZvciAoY29uc3QgaXRlbSBvZiByb290TW92ZXMpIHsNCiAgICBjb25zdCBuZXh0Qm9hcmQgPSBib2FyZC5tYXAocm93ID0+IFsuLi5yb3ddKTsNCiAgICBuZXh0Qm9hcmRbaXRlbS50by5yXVtpdGVtLnRvLmNdID0gbmV4dEJvYXJkW2l0ZW0uZnJvbS5yXVtpdGVtLmZyb20uY107DQogICAgbmV4dEJvYXJkW2l0ZW0uZnJvbS5yXVtpdGVtLmZyb20uY10gPSBudWxsOw0KICAgIA0KICAgIC8vIOajgOafpeW9k+WJjeWxgOmdouaYr+WQpuS4uuaNieWtkOWxgOmdouS4lOW3sumHjeWkjTTmrKHku6XkuIoNCiAgICBjb25zdCBuZXh0SGFzaCA9IHpvYnJpc3RIYXNoZXIuaGFzaChuZXh0Qm9hcmQpOw0KICAgIC8vIOiuoeeul+S4i+S4gOS4quihjOaji+eOqeWutu+8jOWfuuS6juW9k+WJjXR1cm4NCiAgICBjb25zdCBuZXh0VHVybiA9IHR1cm4gPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgIA0KICAgIC8vIOato+ehrueahG1pbmltYXjpgLvovpHvvJoNCiAgICAvLyAxLiDmkJzntKLlj5HotbfmlrnmmK90dXJu77yMQUnkuLp0dXJu5a+75om+5pyA5LyY6LWw5rOVDQogICAgLy8gMi4gdHVybui1sOWujOS4gOatpeWQju+8jOi9ruWIsOWvueaJiyhuZXh0VHVybinotbDmo4sNCiAgICAvLyAzLiBtYXhpbWl6aW5n5Y+C5pWw77ya5b2T5YmN546p5a625piv5ZCm5piv5pCc57Si5Y+R6LW35pa5DQogICAgLy8gICAgLSDlpoLmnpzmmK/vvIxtYXhpbWl6aW5nID0gdHJ1Ze+8iOacgOWkp+WMluiHquW3seeahOWIhuaVsO+8iQ0KICAgIC8vICAgIC0g5aaC5p6c5ZCm77yMbWF4aW1pemluZyA9IGZhbHNl77yI5pyA5bCP5YyW5a+55omL55qE5YiG5pWw77yJDQogICAgLy8gNC4g5Lyg6YCSdHVybuS9nOS4unNlYXJjaEluaXRpYXRvcu+8jOehruS/neivhOS8sOWni+e7iOS7jnR1cm7op5LluqborqHnrpcNCiAgICANCiAgICBjb25zdCBtYXhpbWl6aW5nID0gZmFsc2U7DQogICAgY29uc3QgYWxwaGFCZXRhUmVzdWx0ID0gYWxwaGFCZXRhKG5leHRCb2FyZCwgZGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LCBtYXhpbWl6aW5nLCBuZXh0VHVybiwgZGVwdGgsIHR1cm4sIGdhbWVTdGFnZSk7DQogICAgY29uc3Qgc2NvcmUgPSBhbHBoYUJldGFSZXN1bHQudmFsdWU7DQogICAgaXRlbS5zY29yZSA9IHNjb3JlOw0KICAgIGl0ZW0ubW92ZVNlcXVlbmNlID0gW3sgZnJvbTogaXRlbS5mcm9tLCB0bzogaXRlbS50byB9LCAuLi5hbHBoYUJldGFSZXN1bHQubW92ZVNlcXVlbmNlXTsNCiAgfQ0KICAgIA0KICAgIC8vIOaMieWIhuaVsOaOkuW6jyAtIOeUseS6jnNjb3Jl5bey57uP5piv5YeA6IOc5YiG77yI5b2T5YmN546p5a62LeWvueaJi++8ie+8jOaJgOS7peWPjOaWuemDveW6lOmAieaLqeWIhuaVsOacgOWkp+eahOi1sOazlQ0KICAgIHJvb3RNb3Zlcy5zb3J0KChhLCBiKSA9PiB7DQogICAgICAgIGNvbnN0IHNjb3JlRGlmZiA9IGIuc2NvcmUgLSBhLnNjb3JlOw0KICAgICAgICBpZiAoTWF0aC5hYnMoc2NvcmVEaWZmKSA8IDFlLTYpIHsNCiAgICAgICAgICAgIC8vIOWIhuaVsOebuOWQjO+8jOagueaNruiDnOi0n+aDheWGteavlOi+g+W6j+WIl+mVv+W6pg0KICAgICAgICAgICAgLy8g6IOc5Yip5YiG5pWw5Li65q2j77yM5aSx6LSl5YiG5pWw5Li66LSfDQogICAgICAgICAgICBpZiAoYS5zY29yZSA+IDApIHsNCiAgICAgICAgICAgICAgICAvLyDpg73mmK/og5zliKnvvIzpgInmi6nluo/liJfmm7Tnn63nmoQNCiAgICAgICAgICAgICAgICByZXR1cm4gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYi5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoYS5zY29yZSA8IDApIHsNCiAgICAgICAgICAgICAgICAvLyDpg73mmK/lpLHotKXvvIzpgInmi6nluo/liJfmm7Tplb/nmoQNCiAgICAgICAgICAgICAgICByZXR1cm4gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYS5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIDA7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIHNjb3JlRGlmZjsNCiAgICB9KTsNCiAgICANCiAgICAvLyDmm7TmlrDmnIDkvJjotbDms5UNCiAgICBpZiAocm9vdE1vdmVzLmxlbmd0aCA+IDApIHsNCiAgICAgIGJlc3RNb3ZlID0gcm9vdE1vdmVzWzBdOyAvLyByb290TW92ZXPlhYPntKDnm7TmjqXmmK9tb3Zl5a+56LGh77yM5rKh5pyJLm1vdmXlsZ7mgKcNCiAgICAgIHNlY29uZEJlc3RNb3ZlID0gcm9vdE1vdmVzLmxlbmd0aCA+IDEgPyByb290TW92ZXNbMV0gOiBudWxsOw0KICAgIH0NCiAgDQogIC8vIOiOt+WPluW5tuaJk+WNsOe9ruaNouihqOe7n+iuoeS/oeaBrw0KICBjb25zdCB0dFN0YXRzID0gdHJhbnNwb3NpdGlvblRhYmxlLmdldFN0YXRzKCk7DQoNCiAgLyoNCiAgY29uc29sZS5sb2coJ1xu572u5o2i6KGo5L2/55So57uf6K6h5L+h5oGvOicpOw0KICBjb25zb2xlLmxvZyhgICAg6K6/6Zeu5oC75pWwOiAke3R0U3RhdHMudG90YWxBY2Nlc3Nlc31gKTsNCiAgY29uc29sZS5sb2coYCAgIOWRveS4reasoeaVsDogJHt0dFN0YXRzLmhpdHN9ICgke3R0U3RhdHMuaGl0UmF0ZX0lKWApOw0KICBjb25zb2xlLmxvZyhgICAgLSBFeGFjdOWRveS4rTogJHt0dFN0YXRzLmV4YWN0SGl0c31gKTsNCiAgY29uc29sZS5sb2coYCAgIC0gTG93ZXJib3VuZOWRveS4rTogJHt0dFN0YXRzLmxvd2VyYm91bmRIaXRzfWApOw0KICBjb25zb2xlLmxvZyhgICAgLSBVcHBlcmJvdW5k5ZG95LitOiAke3R0U3RhdHMudXBwZXJib3VuZEhpdHN9YCk7DQogIGNvbnNvbGUubG9nKGAgICDmnKrlkb3kuK3mrKHmlbA6ICR7dHRTdGF0cy5taXNzZXN9YCk7DQogIGNvbnNvbGUubG9nKGAgICDlrZjlgqjmrKHmlbA6ICR7dHRTdGF0cy5zdG9yZXN9YCk7DQogIGNvbnNvbGUubG9nKGAgICBMUlXpqbHpgJDmrKHmlbA6ICR7dHRTdGF0cy5scnVFdmljdGlvbnN9YCk7DQogIGNvbnNvbGUubG9nKGAgICDooajloavlhYXnjoc6ICR7dHRTdGF0cy5jdXJyZW50U2l6ZX0vJHt0dFN0YXRzLm1heFNpemV9ICgke3R0U3RhdHMuZmlsbFBlcmNlbnRhZ2V9JSlgKTsNCiAgKi8NCiAgLy8g5om+5Ye65pyA5LyY552A5rOV5bqP5YiX5ZKM5qyh5LyY552A5rOV5bqP5YiXDQogIGxldCBiZXN0TW92ZVNlcXVlbmNlID0gW107DQogIGxldCBzZWNvbmRNb3ZlU2VxdWVuY2UgPSBbXTsNCiAgaWYgKHJvb3RNb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgYmVzdE1vdmVTZXF1ZW5jZSA9IHJvb3RNb3Zlc1swXS5tb3ZlU2VxdWVuY2UgfHwgW107DQogIH0NCiAgaWYgKHJvb3RNb3Zlcy5sZW5ndGggPiAxKSB7DQogICAgc2Vjb25kTW92ZVNlcXVlbmNlID0gcm9vdE1vdmVzWzFdLm1vdmVTZXF1ZW5jZSB8fCBbXTsNCiAgfQ0KICANCiAgcmV0dXJuIHsgYmVzdE1vdmUsIHNlY29uZEJlc3RNb3ZlLCByb290TW92ZXMsIHNlYXJjaFRpbWU6IERhdGUubm93KCkgLSBzdGFydFRpbWUsIHR0U3RhdHMsIG1vdmVTZXF1ZW5jZTogYmVzdE1vdmVTZXF1ZW5jZSwgc2Vjb25kTW92ZVNlcXVlbmNlIH07DQp9Ow0KDQovLyDkv67lpI3vvJphbHBoYUJldGHlh73mlbDpnIDopoHkuIDkuKrpop3lpJbnmoTlj4LmlbDmnaXmoIfor4bmkJzntKLlj5HotbfmlrnvvIznoa7kv53or4TkvLDlp4vnu4jku47lj5Hotbfmlrnop5LluqborqHnrpcNCmNvbnN0IGFscGhhQmV0YSA9IChiLCBkLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwgc2VhcmNoRGVwdGggPSAwLCBzZWFyY2hJbml0aWF0b3IgPSBjdXJyZW50UGxheWVyLCBnYW1lU3RhZ2UgPSAnbWlkJykgPT4gew0KICAgIC8vIG1heGltaXppbmfooajnpLrlvZPliY3njqnlrrbmmK/lkKbmraPlnKjmnIDlpKfljJboh6rlt7HnmoTliIbmlbANCiAgICAvLyBjdXJyZW50UGxheWVy6KGo56S65b2T5YmN6KGM5qOL546p5a6255qE6aKc6ImyDQogICAgLy8gc2VhcmNoSW5pdGlhdG9y6KGo56S65pCc57Si5Y+R6LW35pa577yM6K+E5Lyw5YC85aeL57uI5LuO5Y+R6LW35pa56KeS5bqm6K6h566XDQoNCiAgICAvLyDmgKfog73nu5/orqENCiAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMrKzsNCiAgICBpZiAoIXBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKSBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSA9IDA7DQogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0rKzsNCg0KICAgIGxldCBwaWVjZXNJbmZvLCBib2FyZEluZm8sIGV2YWxSZXN1bHQ7DQoNCiAgICAvLyDlj7boioLngrnvvJrosIPnlKjlrozmlbTnmoRldmFsdWF0ZUJvYXJkDQogICAgaWYgKGQgPT09IDApIHsNCiAgICAgICAgZXZhbFJlc3VsdCA9IGV2YWx1YXRlQm9hcmQoYiwgZmFsc2UsIHNlYXJjaEluaXRpYXRvciwgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsNCiAgICAgICAgcGllY2VzSW5mbyA9IGV2YWxSZXN1bHQucGllY2VzSW5mbzsNCiAgICAgICAgYm9hcmRJbmZvID0gZXZhbFJlc3VsdC5ib2FyZEluZm87DQoNCiAgICAgICAgLy8g5Y+26IqC54K56K+E5Lyw77ya5aeL57uI5LuO5pCc57Si5Y+R6LW35pa56KeS5bqm6K6h566X6K+E5Lyw5YC8DQogICAgICAgIGNvbnN0IGV2YWxQbGF5ZXIgPSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgIGNvbnN0IG9wcG9uZW50ID0gZXZhbFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIC8vIOiuoeeul+WHgOiDnOWIhu+8muWPkei1t+aWueeahOaAu+WIhuWHj+WOu+WvueaWueeahOaAu+WIhg0KICAgICAgICBjb25zdCBuZXRTY29yZSA9IGV2YWxSZXN1bHRbZXZhbFBsYXllcl0udG90YWwgLSBldmFsUmVzdWx0W29wcG9uZW50XS50b3RhbDsNCiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IG5ldFNjb3JlLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KDQogICAgLy8g6Z2e5Y+26IqC54K577ya5L2/55So6L276YeP57qn55qEcHJlcGFyZVNlYXJjaEluZm8NCiAgICBjb25zdCBzZWFyY2hJbmZvID0gcHJlcGFyZVNlYXJjaEluZm8oYiwgY3VycmVudFBsYXllciwgZ2FtZVN0YWdlKTsNCiAgICBwaWVjZXNJbmZvID0gc2VhcmNoSW5mby5waWVjZXNJbmZvOw0KICAgIGJvYXJkSW5mbyA9IHNlYXJjaEluZm8uYm9hcmRJbmZvOw0KICAgIA0KICAgIC8vIOajgOafpea4uOaIj+eKtuaAge+8jOS9v+eUqGJvYXJkSW5mb+S4reeahOmihOiuoeeul+e7k+aenA0KICAgIGlmIChib2FyZEluZm8uZ2FtZVN0YXRlICYmIGJvYXJkSW5mby5nYW1lU3RhdGUuc3RhdHVzICE9PSAncGxheWluZycpIHsNCiAgICAgICAgY29uc3QgZ2FtZVN0YXRlID0gYm9hcmRJbmZvLmdhbWVTdGF0ZTsNCiAgICAgICAgLy8g5ri45oiP57uT5p2f77yM5LuO5pCc57Si5Y+R6LW35pa56KeS5bqm6K+E5LywDQogICAgICAgIGlmIChnYW1lU3RhdGUuc3RhdHVzID09PSAnY2hlY2ttYXRlJyB8fCBnYW1lU3RhdGUuc3RhdHVzID09PSAnc3RhbGVtYXRlJykgew0KICAgICAgICAgICAgLy8g5aaC5p6c5pCc57Si5Y+R6LW35pa55piv6I636IOc6ICF77yM6L+U5Zue5q2j5YiG77yb5ZCm5YiZ6L+U5Zue6LSf5YiGDQogICAgICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGdhbWVTdGF0ZS53aW5uZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgICAgIGNvbnN0IGJhc2VTY29yZSA9IGlzSW5pdGlhdG9yV2lubmVyID8gMTAwMDAwIDogLTEwMDAwMDsNCiAgICAgICAgICAgIGNvbnN0IHN0ZXBzRnJvbVJvb3QgPSBzZWFyY2hEZXB0aCAtIGQ7IC8vIOS7juagueiKgueCueWIsOW9k+WJjeiKgueCueeahOatpeaVsA0KICAgICAgICAgICAgY29uc3QgYWRqdXN0ZWRTY29yZSA9IGJhc2VTY29yZSArIChpc0luaXRpYXRvcldpbm5lciA/IGQgOiBzdGVwc0Zyb21Sb290KTsNCiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBhZGp1c3RlZFNjb3JlLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IDAsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICB9DQogICAgLyoNCiAgICAvLyDlsJ3or5Xku47nva7mjaLooajkuK3ojrflj5bnvJPlrZjnmoTnu5PmnpwNCiAgICBjb25zdCBoYXNoID0gem9icmlzdEhhc2hlci5oYXNoKGIpOw0KICAgIGNvbnN0IHR0RW50cnkgPSB0cmFuc3Bvc2l0aW9uVGFibGUucmV0cmlldmUoaGFzaCk7DQogICAgaWYgKHR0RW50cnkgJiYgdHRFbnRyeS5kZXB0aCA+PSBkKSB7DQogICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICdleGFjdCcpIHsNCiAgICAgICAgICAgIHJldHVybiB0dEVudHJ5LnZhbHVlOw0KICAgICAgICB9IGVsc2UgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ2xvd2VyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPj0gYmV0YSkgew0KICAgICAgICAgICAgcmV0dXJuIGJldGE7DQogICAgICAgIH0gZWxzZSBpZiAodHRFbnRyeS5mbGFnID09PSAndXBwZXJib3VuZCcgJiYgdHRFbnRyeS52YWx1ZSA8PSBhbHBoYSkgew0KICAgICAgICAgICAgcmV0dXJuIGFscGhhOw0KICAgICAgICB9DQogICAgfQ0KICAgICovDQogICANCg0KDQoNCiAgICBpZiAoZCA9PT0gMCkgew0KICAgICAgICAvLyDlj7boioLngrnor4TkvLDvvJrlp4vnu4jku47mkJzntKLlj5Hotbfmlrnop5LluqborqHnrpfor4TkvLDlgLwNCiAgICAgICAgY29uc3QgZXZhbFBsYXllciA9IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBldmFsUGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgLy8g6K6h566X5YeA6IOc5YiG77ya5Y+R6LW35pa555qE5oC75YiG5YeP5Y675a+55pa555qE5oC75YiGDQogICAgICAgIGNvbnN0IG5ldFNjb3JlID0gZXZhbFJlc3VsdFtldmFsUGxheWVyXS50b3RhbCAtIGV2YWxSZXN1bHRbb3Bwb25lbnRdLnRvdGFsOw0KICAgICAgICByZXR1cm4geyB2YWx1ZTogbmV0U2NvcmUsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICB9DQoNCiAgICAvLyDpnZ7lj7boioLngrnvvIzkvb/nlKjlt7Lojrflj5bnmoRwaWVjZXNJbmZv5ZKMYm9hcmRJbmZvDQogICAgY29uc3QgYWJQaWVjZXNJbmZvID0gcGllY2VzSW5mbzsNCiAgICBjb25zdCBhYkJvYXJkSW5mbyA9IGJvYXJkSW5mbzsNCg0KICAgIC8vIOS8mOWMlu+8muWPqueUn+aIkOW9k+WJjeeOqeWutueahOaji+WtkOeahOi1sOazle+8jOmBv+WFjeS4jeW/heimgeeahOmBjeWOhg0KICAgIGxldCBtb3ZlcyA9IFtdOw0KICAgIC8vIOW9k+WJjeeOqeWutuminOiJsuS4jmN1cnJlbnRQbGF5ZXLkv53mjIHkuIDoh7QNCiAgICBjb25zdCBjdXJyZW50UGxheWVyQ29sb3IgPSBjdXJyZW50UGxheWVyOw0KICAgIA0KICAgIC8vIOmihOWFiOiOt+WPluaJgOacieW9k+WJjeeOqeWutueahOaji+WtkOS9jee9ru+8jOmBv+WFjemBjeWOhuaVtOS4quaji+ebmA0KICAgIGNvbnN0IHBsYXllclBpZWNlcyA9IFtdOw0KICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICBpZiAoYltyXVtjXT8uY29sb3IgPT09IGN1cnJlbnRQbGF5ZXJDb2xvcikgew0KICAgICAgICAgIHBsYXllclBpZWNlcy5wdXNoKHsgciwgYywgcGllY2U6IGJbcl1bY10gfSk7DQogICAgICAgIH0NCiAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g5Y+q6YGN5Y6G5b2T5YmN546p5a6255qE5qOL5a2Q55Sf5oiQ6LWw5rOV77yb6KKr5bCG5pe25L+d55WZ5YWo6YOo5ZCI5rOV5bqU5bCG552A5rOV77yM5ZCm5YiZ6L+H5ruk6YCB5ZCDDQogICAgY29uc3QgYWJJbkNoZWNrID0gKGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ3JlZCcgJiYgYWJCb2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fA0KICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50UGxheWVyQ29sb3IgPT09ICdibGFjaycgJiYgYWJCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOw0KICAgIGZvciAoY29uc3QgeyByLCBjLCBwaWVjZSB9IG9mIHBsYXllclBpZWNlcykgew0KICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGIsIHsgciwgYyB9KTsNCiAgICAgIHZhbGlkRGVzdGluYXRpb25zLmZvckVhY2godG8gPT4gew0KICAgICAgICAgaWYgKGFiSW5DaGVjayB8fCBpc1Bvc2l0aW9uQWNjZXB0YWJsZShiLCB7IHIsIGMgfSwgdG8sIGN1cnJlbnRQbGF5ZXJDb2xvciwgYWJCb2FyZEluZm8sIGFiUGllY2VzSW5mbywgcGllY2UsIGdhbWVTdGFnZSkpIHsNCiAgICAgICAgICAgbW92ZXMucHVzaCh7IGZyb206IHtyLGN9LCB0bywgc2NvcmU6IDAgfSk7DQogICAgICAgICB9DQogICAgICB9KTsNCiAgICB9DQogICAgDQogICAgLy8g5aSE55CG56m6bW92ZXPmlbDnu4TvvIzpgb/lhY3ov5Tlm55JbmZpbml0eQ0KICAgIGlmIChtb3Zlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgLy8g5L2/55SoYm9hcmRJbmZv5Lit55qE6aKE6K6h566XZ2FtZVN0YXRlDQogICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGFiQm9hcmRJbmZvLmdhbWVTdGF0ZTsNCiAgICAgICAgaWYgKGdhbWVTdGF0ZSAmJiAoZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ2NoZWNrbWF0ZScgfHwgZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ3N0YWxlbWF0ZScpKSB7DQogICAgICAgICAgICAvLyDlpoLmnpzmkJzntKLlj5HotbfmlrnmmK/ojrfog5zogIXvvIzov5Tlm57mraPliIbvvJvlkKbliJnov5Tlm57otJ/liIYNCiAgICAgICAgICAgIGNvbnN0IGlzSW5pdGlhdG9yV2lubmVyID0gZ2FtZVN0YXRlLndpbm5lciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICAgICAgY29uc3QgYmFzZVNjb3JlID0gaXNJbml0aWF0b3JXaW5uZXIgPyAxMDAwMDAgOiAtMTAwMDAwOw0KICAgICAgICAgICAgY29uc3Qgc3RlcHNGcm9tUm9vdCA9IHNlYXJjaERlcHRoIC0gZDsgLy8g5LuO5qC56IqC54K55Yiw5b2T5YmN6IqC54K555qE5q2l5pWwDQogICAgICAgICAgICBjb25zdCBhZGp1c3RlZFNjb3JlID0gYmFzZVNjb3JlICsgKGlzSW5pdGlhdG9yV2lubmVyID8gZCA6IHN0ZXBzRnJvbVJvb3QpOw0KICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IGFkanVzdGVkU2NvcmUsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4geyB2YWx1ZTogMCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgIH0NCg0KICAgIC8vIOe7n+iuoeeUn+aIkOeahOi1sOazleaVsA0KICAgIGlmICghcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdKSBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gPSAwOw0KICAgIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSArPSBtb3Zlcy5sZW5ndGg7DQoNCiAgICAvLyDorqHnrpflqIHog4Hkv6Hmga/nlKjkuo7mjpLluo/vvIjlj6rmnInmjpLluo/pnIDopoHov5nkupvkv6Hmga/vvIkNCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMoYiwgYWJQaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyLCBkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYWJCb2FyZEluZm8pOw0KICAgIA0KICAgIC8vIOWvueedgOazlei/m+ihjOaOkuW6j++8jOS8oOmAkmdhbWVTdGFnZeWSjGJvYXJkSW5mb+mBv+WFjemHjeWkjeiuoeeulw0KICAgIG1vdmVzID0gc29ydE1vdmVzKG1vdmVzLCBiLCBjdXJyZW50UGxheWVyQ29sb3IsIGFiUGllY2VzSW5mbywgZ2FtZVN0YWdlLCBhYkJvYXJkSW5mbyk7DQogICAgDQogICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgIGxldCBtYXhFdmFsID0gLUluZmluaXR5Ow0KICAgICAgbGV0IGJlc3RNb3ZlID0gbnVsbDsNCiAgICAgIGxldCBiZXN0TW92ZVNlcXVlbmNlID0gW107DQogICAgICBmb3IgKGNvbnN0IG1vdmUgb2YgbW92ZXMpIHsNCiAgICAgICAgY29uc3QgbmV4dEJvYXJkID0gYi5tYXAocm93ID0+IFsuLi5yb3ddKTsNCiAgICAgICAgbmV4dEJvYXJkW21vdmUudG8ucl1bbW92ZS50by5jXSA9IG5leHRCb2FyZFttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOw0KICAgICAgICBuZXh0Qm9hcmRbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXSA9IG51bGw7DQogICAgICAgIC8vIOS4i+S4gOS4quihjOaji+eahOeOqeWutuaYr+W9k+WJjeeOqeWutueahOWvueaJiw0KICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIC8vIOmAkuW9kuiwg+eUqOaXtuS/neaMgXNlYXJjaEluaXRpYXRvcuS4jeWPmO+8jOehruS/neivhOS8sOWni+e7iOS7juWPkei1t+aWueinkuW6puiuoeeulw0KICAgICAgICBjb25zdCBuZXh0TWF4aW1pemluZyA9IG5leHRQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgY29uc3QgcmVzdWx0ID0gYWxwaGFCZXRhKG5leHRCb2FyZCwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsNCiAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IG1heEV2YWwpIHsNCiAgICAgICAgICBtYXhFdmFsID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgIGJlc3RNb3ZlID0gbW92ZTsNCiAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmUsIC4uLnJlc3VsdC5tb3ZlU2VxdWVuY2VdOw0KICAgICAgICB9DQogICAgICAgIGFscGhhID0gTWF0aC5tYXgoYWxwaGEsIHJlc3VsdC52YWx1ZSk7DQogICAgICAgIGlmIChiZXRhIDw9IGFscGhhKSB7DQogICAgICAgICAgICAvLyDnu5/orqHliarmnp0NCiAgICAgICAgICAgIGlmICghcGVyZlN0YXRzLmN1dG9mZnNbZF0pIHBlcmZTdGF0cy5jdXRvZmZzW2RdID0gMDsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5jdXRvZmZzW2RdKys7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgICAgLyoNCiAgICAgIC8vIOWtmOWCqOWIsOe9ruaNouihqA0KICAgICAgY29uc3QgaGFzaCA9IHpvYnJpc3RIYXNoZXIuaGFzaChiKTsNCiAgICAgIGxldCBmbGFnOw0KICAgICAgaWYgKG1heEV2YWwgPD0gYWxwaGEpIHsNCiAgICAgICAgZmxhZyA9ICd1cHBlcmJvdW5kJzsNCiAgICAgIH0gZWxzZSBpZiAobWF4RXZhbCA+PSBiZXRhKSB7DQogICAgICAgIGZsYWcgPSAnbG93ZXJib3VuZCc7DQogICAgICB9IGVsc2Ugew0KICAgICAgICBmbGFnID0gJ2V4YWN0JzsNCiAgICAgIH0NCiAgICAgIHRyYW5zcG9zaXRpb25UYWJsZS5zdG9yZShoYXNoLCBkLCBtYXhFdmFsLCBmbGFnLCBiZXN0TW92ZSk7DQogICAgICAqLw0KICAgICAgcmV0dXJuIHsgdmFsdWU6IG1heEV2YWwsIG1vdmVTZXF1ZW5jZTogYmVzdE1vdmVTZXF1ZW5jZSB9Ow0KICAgIH0gZWxzZSB7DQogICAgICBsZXQgbWluRXZhbCA9IEluZmluaXR5Ow0KICAgICAgbGV0IGJlc3RNb3ZlID0gbnVsbDsNCiAgICAgIGxldCBiZXN0TW92ZVNlcXVlbmNlID0gW107DQogICAgICBmb3IgKGNvbnN0IG1vdmUgb2YgbW92ZXMpIHsNCiAgICAgICAgY29uc3QgbmV4dEJvYXJkID0gYi5tYXAocm93ID0+IFsuLi5yb3ddKTsNCiAgICAgICAgbmV4dEJvYXJkW21vdmUudG8ucl1bbW92ZS50by5jXSA9IG5leHRCb2FyZFttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOw0KICAgICAgICBuZXh0Qm9hcmRbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXSA9IG51bGw7DQogICAgICAgIC8vIOS4i+S4gOS4quihjOaji+eahOeOqeWutuaYr+W9k+WJjeeOqeWutueahOWvueaJiw0KICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIC8vIOmAkuW9kuiwg+eUqOaXtuS/neaMgXNlYXJjaEluaXRpYXRvcuS4jeWPmO+8jOehruS/neivhOS8sOWni+e7iOS7juWPkei1t+aWueinkuW6puiuoeeulw0KICAgICAgICBjb25zdCBuZXh0TWF4aW1pemluZyA9IG5leHRQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgY29uc3QgcmVzdWx0ID0gYWxwaGFCZXRhKG5leHRCb2FyZCwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsNCiAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA8IG1pbkV2YWwpIHsNCiAgICAgICAgICBtaW5FdmFsID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgIGJlc3RNb3ZlID0gbW92ZTsNCiAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmUsIC4uLnJlc3VsdC5tb3ZlU2VxdWVuY2VdOw0KICAgICAgICB9DQogICAgICAgIGJldGEgPSBNYXRoLm1pbihiZXRhLCByZXN1bHQudmFsdWUpOw0KICAgICAgICBpZiAoYmV0YSA8PSBhbHBoYSkgew0KICAgICAgICAgICAgLy8g57uf6K6h5Ymq5p6dDQogICAgICAgICAgICBpZiAoIXBlcmZTdGF0cy5jdXRvZmZzW2RdKSBwZXJmU3RhdHMuY3V0b2Zmc1tkXSA9IDA7DQogICAgICAgICAgICBwZXJmU3RhdHMuY3V0b2Zmc1tkXSsrOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgIH0NCiAgICAgIC8qDQogICAgICAvLyDlrZjlgqjliLDnva7mjaLooagNCiAgICAgIGNvbnN0IGhhc2ggPSB6b2JyaXN0SGFzaGVyLmhhc2goYik7DQogICAgICBsZXQgZmxhZzsNCiAgICAgIGlmIChtaW5FdmFsIDw9IGFscGhhKSB7DQogICAgICAgIGZsYWcgPSAndXBwZXJib3VuZCc7DQogICAgICB9IGVsc2UgaWYgKG1pbkV2YWwgPj0gYmV0YSkgew0KICAgICAgICBmbGFnID0gJ2xvd2VyYm91bmQnOw0KICAgICAgfSBlbHNlIHsNCiAgICAgICAgZmxhZyA9ICdleGFjdCc7DQogICAgICB9DQogICAgICB0cmFuc3Bvc2l0aW9uVGFibGUuc3RvcmUoaGFzaCwgZCwgbWluRXZhbCwgZmxhZywgYmVzdE1vdmUpOw0KICAgICAgKi8NCiAgICAgIHJldHVybiB7IHZhbHVlOiBtaW5FdmFsLCBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UgfTsNCiAgICB9DQp9Ow0KDQpjb25zdCBnZXRCZXN0TW92ZSA9IChib2FyZCwgdHVybiwgZGVwdGggPSA0LCByYW5kb21uZXNzID0gMCwgcGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0ID0gZmFsc2UpID0+IHsNCiAgbGV0IGJlc3RNb3ZlID0gbnVsbDsNCiAgbGV0IHNlY29uZEJlc3RNb3ZlID0gbnVsbDsNCiAgbGV0IHJvb3RNb3ZlcyA9IFtdOw0KICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOw0KDQogIC8vIEZpcnN0IHRyeSB0byBnZXQgbW92ZSBmcm9tIG9wZW5pbmcgYm9vaw0KICBjb25zdCBib29rTW92ZSA9IG9wZW5pbmdCb29rLmdldEJvb2tNb3ZlKGJvYXJkLCBwbHkpOw0KICANCiAgaWYgKGJvb2tNb3ZlKSB7DQogICAgLy8gQ2hlY2sgaWYgYm9va01vdmUgaXMgdmFsaWQgZm9yIGN1cnJlbnQgYm9hcmQNCiAgICBpZiAoYm9va01vdmUuZnJvbSAmJiBib29rTW92ZS50byAmJiANCiAgICAgICAgdHlwZW9mIGJvb2tNb3ZlLmZyb20uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJvb2tNb3ZlLmZyb20uYyA9PT0gJ251bWJlcicgJiYNCiAgICAgICAgdHlwZW9mIGJvb2tNb3ZlLnRvLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBib29rTW92ZS50by5jID09PSAnbnVtYmVyJykgew0KICAgICAgDQogICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJvYXJkW2Jvb2tNb3ZlLmZyb20ucl1bYm9va01vdmUuZnJvbS5jXTsNCiAgICAgIA0KICAgICAgaWYgKG1vdmluZ1BpZWNlICYmIG1vdmluZ1BpZWNlLmNvbG9yID09PSB0dXJuKSB7DQogICAgICAgIC8vIFZlcmlmeSBtb3ZlIGlzIHZhbGlkDQogICAgICAgIGNvbnN0IHZhbGlkRGVzdGluYXRpb25zID0gZ2V0VmFsaWRNb3Zlcyhib2FyZCwgYm9va01vdmUuZnJvbSk7DQogICAgICAgIGNvbnN0IGlzVmFsaWQgPSB2YWxpZERlc3RpbmF0aW9ucy5zb21lKGRlc3QgPT4gZGVzdC5yID09PSBib29rTW92ZS50by5yICYmIGRlc3QuYyA9PT0gYm9va01vdmUudG8uYyk7DQogICAgICAgIA0KICAgICAgICBpZiAoaXNWYWxpZCkgew0KICAgICAgICAgIHJldHVybiB7IGJlc3RNb3ZlOiBib29rTW92ZSwgc2Vjb25kQmVzdE1vdmU6IG51bGwsIG1vdmVTZXF1ZW5jZTogW10sIHNlY29uZE1vdmVTZXF1ZW5jZTogW10sIGJlc3RNb3ZlU2NvcmU6IDAsIHNlY29uZEJlc3RNb3ZlU2NvcmU6IDAsIGFsbE1vdmVzV2l0aFNjb3JlczogW10gfTsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgIH0NCiAgfQ0KDQogIC8vIOS9v+eUqOi/reS7o+WKoOa3seaQnOe0ouiOt+WPluacgOS8mOi1sOazlQ0KICAvL2NvbnNvbGUubG9nKGDlvIDlp4vov63ku6PliqDmt7HmkJzntKLvvIzmt7HluqY6ICR7ZGVwdGh9YCk7DQogIGNvbnN0IHsgYmVzdE1vdmU6IGlkQmVzdE1vdmUsIHNlY29uZEJlc3RNb3ZlOiBpZFNlY29uZEJlc3RNb3ZlLCByb290TW92ZXM6IGlkUm9vdE1vdmVzLCBzZWFyY2hUaW1lLCBtb3ZlU2VxdWVuY2U6IGlkTW92ZVNlcXVlbmNlLCBzZWNvbmRNb3ZlU2VxdWVuY2U6IGlkU2Vjb25kTW92ZVNlcXVlbmNlIH0gPSBpdGVyYXRpdmVEZWVwZW5pbmcoYm9hcmQsIHR1cm4sIGRlcHRoLCA1MDAwLCBlbmFibGVUaW1lTGltaXQpOw0KICANCiAgLy8g5Yid5aeL5YyWcm9vdE1vdmVzDQogIHJvb3RNb3ZlcyA9IGlkUm9vdE1vdmVzOw0KICAvL2NvbnNvbGUubG9nKGDov63ku6PliqDmt7HmkJzntKLlrozmiJDvvIzov5Tlm57nmoRiZXN0TW92ZTogJHtKU09OLnN0cmluZ2lmeShpZEJlc3RNb3ZlKX0sIHNlY29uZEJlc3RNb3ZlOiAke0pTT04uc3RyaW5naWZ5KGlkU2Vjb25kQmVzdE1vdmUpfSwgcm9vdE1vdmVz5pWw6YePOiAke3Jvb3RNb3Zlcy5sZW5ndGh9YCk7DQoNCiAgLy8g5LuOcm9vdE1vdmVz5Lit6I635Y+W5pyA5LyY6LWw5rOV5ZKM5qyh5LyY6LWw5rOVDQogIGJlc3RNb3ZlID0gaWRCZXN0TW92ZTsNCiAgc2Vjb25kQmVzdE1vdmUgPSBpZFNlY29uZEJlc3RNb3ZlOw0KICBiZXN0TW92ZVNlcXVlbmNlID0gaWRNb3ZlU2VxdWVuY2U7DQogIHNlY29uZE1vdmVTZXF1ZW5jZSA9IGlkU2Vjb25kTW92ZVNlcXVlbmNlOw0KDQogIC8vIOiOt+WPluacgOS8mOWSjOasoeS8mOedgOazleeahOWHgOiDnOWIhg0KICBsZXQgYmVzdE1vdmVTY29yZSA9IDA7DQogIGxldCBzZWNvbmRCZXN0TW92ZVNjb3JlID0gMDsNCiAgaWYgKHJvb3RNb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgYmVzdE1vdmVTY29yZSA9IHJvb3RNb3Zlc1swXS5zY29yZTsNCiAgfQ0KICBpZiAocm9vdE1vdmVzLmxlbmd0aCA+IDEpIHsNCiAgICBzZWNvbmRCZXN0TW92ZVNjb3JlID0gcm9vdE1vdmVzWzFdLnNjb3JlOw0KICB9DQogIA0KICAvLyDov5Tlm57miYDmnInnnYDms5XnmoTliIbmlbDkv6Hmga/vvIjnlKjkuo5BbmFseXNpc+WKn+iDve+8iQ0KICBjb25zdCBhbGxNb3Zlc1dpdGhTY29yZXMgPSByb290TW92ZXMubWFwKG1vdmVJbmZvID0+ICh7DQogICAgLy8g5o+Q5Y+WbW92ZUluZm/kuK3nmoRtb3Zl5bGe5oCnDQogICAgbW92ZTogew0KICAgICAgZnJvbTogbW92ZUluZm8uZnJvbSwNCiAgICAgIHRvOiBtb3ZlSW5mby50bw0KICAgIH0sDQogICAgc2NvcmU6IG1vdmVJbmZvLnNjb3JlLA0KICAgIG1vdmVTZXF1ZW5jZTogbW92ZUluZm8ubW92ZVNlcXVlbmNlIHx8IFtdDQogIH0pKTsNCiAgDQogIHJldHVybiB7IGJlc3RNb3ZlLCBzZWNvbmRCZXN0TW92ZSwgbW92ZVNlcXVlbmNlOiBiZXN0TW92ZVNlcXVlbmNlLCBzZWNvbmRNb3ZlU2VxdWVuY2UsIGJlc3RNb3ZlU2NvcmUsIHNlY29uZEJlc3RNb3ZlU2NvcmUsIGFsbE1vdmVzV2l0aFNjb3JlcyB9Ow0KfTsNCg0KLy8gLS0tIFdPUktFUiBMSVNURU5FUiAo57uf5LiA5raI5oGv5aSE55CGKSAtLS0NCg==';
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

