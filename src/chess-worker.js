/* eslint-disable no-restricted-globals */

// 棋盘常量定义
const ROWS = 10;
const COLS = 9;

// 棋子类型定义
const PIECE_TYPES = {
    GENERAL: 'general',
    CHARIOT: 'chariot',
    CANNON: 'cannon',
    HORSE: 'horse',
    ELEPHANT: 'elephant',
    ADVISOR: 'advisor',
    SOLDIER: 'soldier'
};

// 材料值权重配置
const MATERIAL_VALUES = {
    general: 10000,  // 将/帅
    chariot: 900,     // 车
    cannon: {
        early: 450,    // 开局阶段
        mid: 400,      // 中局阶段
        late: 400      // 残局阶段
    },                // 炮
    horse: {
        early: 400,    // 开局阶段
        mid: 450,      // 中局阶段
        late: 450      // 残局阶段
    },                // 马
    elephant: 200,    // 象/相
    advisor: 200,     // 士/仕
    soldier: {
        early: 100,    // 开局阶段
        mid: 200,      // 中局阶段
        late: 450      // 残局阶段
    }                  // 兵/卒
};

// 棋子价值权重配置
let VALUE_WEIGHTS = {
    //material: 0.4,   // 材料值权重
    //position: 0.2,   // 位置值权重
    //threat: 0.15,    // 威胁值权重
    //tactic: 0.1,     // 战术值权重
    //safety: 0.1,     // 安全值权重
    //mobility: 0.05   // 机动值权重

    material: 1,    // 材料值权重
    position: 1,    // 位置值权重
    threat: 1,     // 威胁值权重
    tactic: 1,      // 战术值权重
    safety: 1,      // 安全值权重
    mobility: 1     // 机动值权重
};

// 评估算法参数配置 - 集中定义所有权重系数和加成数字
const EVALUATION_PARAMETERS = {
    // 机动值参数
    mobility: {
        baseMoveValue: 1,      // 基础移动价值
    },
    // 将军：仅作小额先手加分，禁止按将/帅材料值(10000)计入威胁/SEE
    check: {
        bonus: 80
    },
    // 帮助关系参数
    assist: {
        //cannonScreenValue: 40  // 炮架价值
        cannonScreenValue: 0  // 炮架价值
    },
    // 阻挡关系参数
    block: {
        //enemyChariotBlockValue: 20,     // 阻挡对方车价值
        //enemyHorseBlockValue: 15,       // 别对方马腿价值
        //enemyElephantBlockValue: 10,    // 堵塞对方象眼价值
        //allyChariotBlockPenalty: 20,    // 阻挡己方车惩罚
        //allyHorseBlockPenalty: 15,      // 别己方马腿惩罚
        //allyElephantBlockPenalty: 10    // 堵塞己方象眼惩罚

        enemyChariotBlockValue: 0,     // 阻挡对方车价值
        enemyHorseBlockValue: 0,       // 别对方马腿价值
        enemyElephantBlockValue: 0,    // 堵塞对方象眼价值
        allyChariotBlockPenalty: 0,    // 阻挡己方车惩罚
        allyHorseBlockPenalty: 0,      // 别己方马腿惩罚
        allyElephantBlockPenalty: 0    // 堵塞己方象眼惩罚
    }
};

// 位置评估表 - 基于棋子类型和位置
const POSITION_TABLES = {
    // 兵/卒位置表 (红方视角)
    soldier: [
        [0, 5, 10, 15, 20, 15, 10, 5, 0],
        [5, 15, 20, 25, 25, 25, 20, 15, 5],
        [10, 15, 20, 25, 25, 25, 20, 15, 10],
        [10, 15, 25, 30, 30, 30, 25, 15, 10],
        [10, 15, 20, 25, 25, 25, 20, 15, 10],
        [5, 0, 5, 0, 5, 0, 5, 0, 5],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0]
    ],
    // 车位置表 (红方视角)
    chariot: [
        [5, 10, 10, 10, 10, 10, 10, 10, 5],
        [10, 15, 20, 20, 20, 20, 20, 15, 10],
        [10, 15, 20, 20, 20, 20, 20, 15, 10],
        [10, 15, 20, 20, 20, 20, 20, 15, 10],
        [10, 15, 20, 20, 20, 20, 20, 15, 10],
        [10, 12, 15, 15, 15, 15, 15, 12, 10],
        [10, 12, 15, 15, 15, 15, 15, 12, 10],
        [5, 10, 8, 10, 5, 10, 8, 10, 5],
        [10, 10, 5, 15, 0, 15, 5, 10, 10],
        [0, 10, 5, 5, 5, 5, 10, 5, 0]
    ],
    // 马位置表 (红方视角)
    horse: [
        [0, -5, 0, 0, 0, 0, 0, -5, 0],
        [0, 5, 25, 10, 10, 10, 25, 5, 0],
        [5, 5, 20, 25, 25, 25, 20, 5, 5],
        [5, 20, 10, 25, 0, 25, 10, 20, 5],
        [0, 5, 15, 20, 20, 20, 15, 5, 0],
        [0, 5, 25, 20, 0, 20, 25, 5, 0],
        [0, 5, 10, 15, 15, 15, 10, 5, 0],
        [5, 0, 5, 5, 0, 5, 5, 0, 5],
        [0, 0, 0, 5, -20, 5, 0, 0, 0],
        [0, 0, 0, 5, 0, 5, 0, 0, 0]
    ],
    // 炮位置表 (红方视角)
    cannon: [
        [10, 20, 15, 10, 0, 10, 15, 20, 10],
        [0, 5, 5, 10, 10, 10, 5, 5, 0],
        [0, 5, 5, 10, 10, 10, 5, 5, 0],
        [5, 5, 15, 5, 25, 5, 15, 5, 5],
        [0, 5, 5, 5, 5, 5, 5, 5, 0],
        [0, 15, 5, 5, 10, 5, 5, 15, 0],
        [0, 5, 5, 5, 5, 5, 5, 5, 0],
        [10, 10, 15, 20, 30, 20, 15, 10, 10], 
        [0, 5, 5, 10, 10, 10, 5, 5, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0]
    ],
    // 象位置表 (红方视角)
    elephant: [
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 10, 0, 0, 0, 10, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [5, 0, 0, 0, 20, 0, 0, 0, 5],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 10, 0, 0, 0, 10, 0, 0]
    ],
    // 士位置表 (红方视角)
    advisor: [
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 5, 0, 5, 0, 0, 0],
        [0, 0, 0, 0, 10, 0, 0, 0, 0],
        [0, 0, 0, 10, 0, 10, 0, 0, 0]
    ]
};

// 获取棋子的材料值
const getMaterialValue = (piece, gameStage = 'mid') => {
    let value = MATERIAL_VALUES[piece.type];
    
    // 针对有分阶段材料值的兵种（兵、炮、马）调整材料值
    if (typeof value === 'object') {
        value = value[gameStage] || value.mid;
    }
    
    return value;
};

// 获取棋子的位置值
const getPositionValue = (piece, r, c) => {
    const table = POSITION_TABLES[piece.type];
    if (!table) return 0;
    
    // 黑方需要翻转位置表
    const rowIdx = piece.color === 'red' ? (9- r) : r;
    return table[rowIdx][c] || 0;
};

// 主评估函数 - 详细评估棋盘局势
const evaluateBoard = (board, isReplay = false, currentPlayer = null, depth = 0, searchInitiator = null, gameStage = 'mid') => {
    // 统计
    if (currentPlayer) {
        perfStats.evaluateBoardCount[currentPlayer]++;
    }
    
    // 第一步：获取当前游戏阶段
    //const phase = getGamePhase(board);
    // 将游戏阶段转换为材料值计算所需的格式
    //const gameStage = phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';
    // 将游戏阶段转换为输出格式
    //const outputPhase = phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';
    const outputPhase = gameStage;

    // 第二步：遍历一次棋盘，收集所有棋子信息并计算基础分数
    let piecesInfo = [];
    let redMaterial = 0, redPosition = 0;
    let blackMaterial = 0, blackPosition = 0;
    
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const piece = board[r][c];
            if (!piece) continue;
            
            // 收集棋子基本信息
            const materialValue = getMaterialValue(piece, gameStage);
            const positionValue = getPositionValue(piece, r, c);
            const moves = getPieceMoves(board, { r, c }, piece);
            
            // 立即处理moves，计算机动性（将processPieceMoves逻辑内联此处）
            const { baseMoveValue } = EVALUATION_PARAMETERS.mobility;
            let mobilityValue = 0;
            for (const move of moves) {
                const target = board[move.r][move.c];
                if (!target) {
                    // 目标位置为空，计算机动性
                    mobilityValue += baseMoveValue;
                }
            }
            
            // 立即累加基础分数，避免后续再次遍历
            if (piece.color === 'red') {
                redMaterial += materialValue;
                redPosition += positionValue;
            } else {
                blackMaterial += materialValue;
                blackPosition += positionValue;
            }
            
            piecesInfo.push({
                piece,
                r,
                c,
                moves,
                materialValue,
                positionValue,
                // 初始化并设置计算好的机动值
                threatValue: 0,
                safetyValue: 0,
                tacticValue: 0,
                mobilityValue: mobilityValue,
                // 添加威胁者和保护者数组
                threat: [],    // 威胁当前棋子的敌方棋子列表
                protect: []  // 保护当前棋子的己方棋子列表
            });
        }
    }
    
    // 第二步：基于收集的棋子信息计算其他值，传递gameStage避免重复计算
    // 创建boardInfo并传递给calculateDerivedValues
    const boardInfo = Array(10).fill(null).map(() => Array(9).fill(null).map(() => []));
    calculateDerivedValues(board, piecesInfo, currentPlayer, depth, searchInitiator, gameStage, boardInfo);
    
    // 第三步：计算总分（只计算剩余分数，基础分数已在棋盘遍历时计算）
    let redThreat = 0, redTactic = 0, redSafety = 0, redMobility = 0;
    let blackThreat = 0, blackTactic = 0, blackSafety = 0, blackMobility = 0;
    
    for (const info of piecesInfo) {
        const { piece, threatValue, tacticValue, safetyValue, mobilityValue } = info;
        
        if (piece.color === 'red') {
            redThreat += threatValue;
            redTactic += tacticValue;
            redSafety += safetyValue;
            redMobility += mobilityValue;
        } else {
            blackThreat += threatValue;
            blackTactic += tacticValue;
            blackSafety += safetyValue;
            blackMobility += mobilityValue;
        }
    }
    
    // 计算局势总分
    const redTotal = 
        redMaterial * VALUE_WEIGHTS.material +
        redPosition * VALUE_WEIGHTS.position +
        redThreat * VALUE_WEIGHTS.threat +
        redTactic * VALUE_WEIGHTS.tactic +
        redSafety * VALUE_WEIGHTS.safety +
        redMobility * VALUE_WEIGHTS.mobility; 
    
    const blackTotal = 
        blackMaterial * VALUE_WEIGHTS.material +
        blackPosition * VALUE_WEIGHTS.position +
        blackThreat * VALUE_WEIGHTS.threat +
        blackTactic * VALUE_WEIGHTS.tactic +
        blackSafety * VALUE_WEIGHTS.safety +
        blackMobility * VALUE_WEIGHTS.mobility;
    
    // 返回详细评估结果
    return {
        red: {
            total: redTotal,
            material: redMaterial * VALUE_WEIGHTS.material,
            position: redPosition * VALUE_WEIGHTS.position,
            threat: redThreat * VALUE_WEIGHTS.threat,
            tactic: redTactic * VALUE_WEIGHTS.tactic,
            safety: redSafety * VALUE_WEIGHTS.safety,
            mobility: redMobility * VALUE_WEIGHTS.mobility,
            phase: outputPhase,
            weights: {
                material: 0.4,
                position: 0.2,
                tactic: 0.1,
                safety: 0.1,
                mobility: 0.05,
                threat: 0.15
            }
        },
        black: {
            total: blackTotal,
            material: blackMaterial * VALUE_WEIGHTS.material,
            position: blackPosition * VALUE_WEIGHTS.position,
            threat: blackThreat * VALUE_WEIGHTS.threat,
            tactic: blackTactic * VALUE_WEIGHTS.tactic,
            safety: blackSafety * VALUE_WEIGHTS.safety,
            mobility: blackMobility * VALUE_WEIGHTS.mobility,
            phase: outputPhase,
            weights: {
                material: 0.4,
                position: 0.2,
                tactic: 0.1,
                safety: 0.1,
                mobility: 0.05,
                threat: 0.15
            }
        },
        piecesInfo: piecesInfo,
        gameStage: gameStage,
        boardInfo: boardInfo
    };
};

// 轻量级搜索信息准备函数：只计算搜索需要的基本信息
// 不计算完整的威胁值和安全值，只计算棋子关系和游戏状态
const prepareSearchInfo = (board, currentPlayer, gameStage) => {
    // 统计
    perfStats.prepareSearchInfoCount[currentPlayer]++;
    
    // 收集棋子基本信息
    let piecesInfo = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const piece = board[r][c];
            if (!piece) continue;
            
            const materialValue = getMaterialValue(piece, gameStage);
            const positionValue = getPositionValue(piece, r, c);
            const moves = getPieceMoves(board, { r, c }, piece);
            
            // 计算机动性
            const { baseMoveValue } = EVALUATION_PARAMETERS.mobility;
            let mobilityValue = 0;
            for (const move of moves) {
                const target = board[move.r][move.c];
                if (!target) {
                    mobilityValue += baseMoveValue;
                }
            }
            
            piecesInfo.push({
                piece,
                r, c, moves,
                materialValue,
                positionValue,
                threatValue: 0,
                safetyValue: 0,
                tacticValue: 0,
                mobilityValue: mobilityValue,
                threat: [],
                protect: []
            });
        }
    }
    
    // 初始化boardInfo
    const boardInfo = Array(10).fill(null).map(() => Array(9).fill(null).map(() => []));
    
    // 计算棋子关系
    calculatePieceRelations(board, piecesInfo, boardInfo);
    
    // 计算游戏状态
    let hasMoves = false;
    for (const info of piecesInfo) {
        if (info.piece.color === currentPlayer) {
            if (getValidMoves(board, { r: info.r, c: info.c }).length > 0) {
                hasMoves = true;
                break;
            }
        }
    }
    
    let gameState = { status: 'playing' };
    if (!hasMoves) {
        const inCheck = currentPlayer === 'red' ? boardInfo.redIsInCheck : boardInfo.blackIsInCheck;
        const opponent = currentPlayer === 'red' ? 'black' : 'red';
        
        if (inCheck) {
            gameState = { status: 'checkmate', winner: opponent };
        } else {
            gameState = { status: 'stalemate', winner: opponent };
        }
    }
    
    boardInfo.gameState = gameState;
    
    return { piecesInfo, boardInfo };
};

// 计算衍生值：威胁值、安全值、战术值、机动值
// 修改：添加searchInitiator参数，传递给calculateThreatValues
// 添加gameStage参数，避免在循环中重复调用getGamePhase
const calculateDerivedValues = (board, piecesInfo, currentPlayer = null, depth = 0, searchInitiator = null, gameStage = 'mid', boardInfo = null) => {
    // 重置所有衍生值，除了机动值（已在收集棋子信息时计算）
    for (const info of piecesInfo) {
        info.threatValue = 0;
        info.safetyValue = 0;
        info.tacticValue = 0;
        // 保留机动值，因为已在收集棋子信息时计算
    }
    
    // 1. 计算棋子关系（威胁者、被威胁者、保护者、被保护者）
    if (!boardInfo) {
        boardInfo = Array(10).fill(null).map(() => Array(9).fill(null).map(() => []));
    }
    calculatePieceRelations(board, piecesInfo, boardInfo);
    
    // 2. 计算威胁值（基于完整的威胁关系），传递gameStage和boardInfo
    calculateThreatValues(board, piecesInfo, currentPlayer, depth, searchInitiator, gameStage, boardInfo);
    
    // 3. 计算战术值的其他部分（帮助关系和阻挡关系）
    for (const info of piecesInfo) {
        //info.tacticValue += calculateAssistValue(piecesInfo, info);
        //info.tacticValue += calculateBlockValue(board, piecesInfo, info);
    }
    
    // 4. 最后计算安全值，传递boardInfo作为参数
    calculateSafetyValues(piecesInfo, boardInfo);
    
    // 5. 计算游戏状态并保存到boardInfo
    if (currentPlayer) {
        // 检查当前玩家是否有合法走法
        let hasMoves = false;
        for (const info of piecesInfo) {
            if (info.piece.color === currentPlayer) {
                // 获取当前棋子的有效走法
                const moves = getValidMoves(board, { r: info.r, c: info.c });
                if (moves.length > 0) {
                    hasMoves = true;
                    break;
                }
            }
        }
        
        // 判断游戏状态
        let gameState = { status: 'playing' };
        if (!hasMoves) {
            // 没有合法走法，检查是否被将军
            const inCheck = currentPlayer === 'red' ? boardInfo.redIsInCheck : boardInfo.blackIsInCheck;
            const opponent = currentPlayer === 'red' ? 'black' : 'red';
            
            if (inCheck) {
                gameState = { status: 'checkmate', winner: opponent };
            } else {
                gameState = { status: 'stalemate', winner: opponent };
            }
        }
        
        // 保存游戏状态到boardInfo
        boardInfo.gameState = gameState;
    }
};

// 计算棋子关系（威胁者、被威胁者、保护者、被保护者）
// 同时计算boardInfo：为棋盘每个位置登记控制者
const calculatePieceRelations = (board, piecesInfo, boardInfo) => {
    // 初始化棋子关系数组
    for (const info of piecesInfo) {
        info.threat = [];           // 检查这个棋子可以威胁哪些棋子
        info.threatenedBy = [];     // 检查这个棋子被哪些棋子威胁
        info.guard = [];       // 检查这个棋子可以保护哪些棋子
        info.guardedBy = [];      // 检查这个棋子被哪些棋子保护
        info.control = [];      // 检查这个棋子可以控制的哪些位置
    }
    
    // 如果boardInfo为空，则初始化
    if (!boardInfo) {
        boardInfo = Array(10).fill(null).map(() => Array(9).fill(null).map(() => []));
    }
    
    // 处理每个棋子的威胁和保护关系
    for (const info of piecesInfo) {
        // 获取棋子的威胁目标和保护目标
        const { threat, guard } = getPieceTargets(board, { r: info.r, c: info.c }, info.piece);
        
        // 处理威胁目标，同时记录双向威胁关系
        for (const threatPos of threat) {
            const targetInfo = piecesInfo.find(p => p.r === threatPos.r && p.c === threatPos.c);
            if (targetInfo) {
                // 记录威胁关系：info威胁targetInfo
                info.threat.push(targetInfo);
                // 同时记录反向关系：targetInfo被info威胁
                targetInfo.threatenedBy.push(info);
            }
        }
        
        // 处理保护目标，同时记录双向保护关系
        for (const guardPos of guard) {
            const targetInfo = piecesInfo.find(p => p.r === guardPos.r && p.c === guardPos.c);
            if (targetInfo && targetInfo !== info) {
                // 记录保护关系：info保护targetInfo
                info.guard.push(targetInfo);
                // 同时记录反向关系：targetInfo被info保护
                targetInfo.guardedBy.push(info);
            }
        }
        
        // 计算并记录棋子的控制点
        const control = getPieceControl(board, { r: info.r, c: info.c }, info.piece);
        info.control = control;
        
        // 更新boardInfo：将当前棋子的完整信息添加到其控制点的控制者列表中
        control.forEach(pos => {
            // 存储完整的控制者信息：位置、颜色和棋子类型
            boardInfo[pos.r][pos.c].push({
                r: info.r,
                c: info.c,
                color: info.piece.color,
                type: info.piece.type
            });
        });
    }
    
    // 预计算将军状态
    let redIsInCheck = false;
    let blackIsInCheck = false;
    
    // 查找将/帅位置
    let redGeneralInfo = null;
    let blackGeneralInfo = null;
    for (const info of piecesInfo) {
        if (info.piece.type === 'general') {
            if (info.piece.color === 'red') {
                redGeneralInfo = info;
            } else {
                blackGeneralInfo = info;
            }
        }
    }
    
    // 检查红将是否被将军
    if (redGeneralInfo) {
        // 检查敌方棋子是否直接威胁红将
        for (const threatener of redGeneralInfo.threatenedBy) {
            if (threatener.piece.color === 'black') {
                redIsInCheck = true;
                break;
            }
        }
    }
    
    // 检查黑将是否被将军
    if (blackGeneralInfo) {
        // 检查敌方棋子是否直接威胁黑将
        for (const threatener of blackGeneralInfo.threatenedBy) {
            if (threatener.piece.color === 'red') {
                blackIsInCheck = true;
                break;
            }
        }
    }
    
    // 检查飞将情况
    if (redGeneralInfo && blackGeneralInfo) {
        // 将/帅是否在同一列
        if (redGeneralInfo.c === blackGeneralInfo.c) {
            // 检查中间是否有其他棋子
            let hasPieceBetween = false;
            const startR = Math.min(redGeneralInfo.r, blackGeneralInfo.r) + 1;
            const endR = Math.max(redGeneralInfo.r, blackGeneralInfo.r) - 1;
            for (let r = startR; r <= endR; r++) {
                if (board[r][redGeneralInfo.c]) {
                    hasPieceBetween = true;
                    break;
                }
            }
            
            if (!hasPieceBetween) {
                // 飞将情况，红方和黑方都被将军
                redIsInCheck = true;
                blackIsInCheck = true;
            }
        }
    }
    
    // 将将军状态存储到boardInfo中
    boardInfo.redIsInCheck = redIsInCheck;
    boardInfo.blackIsInCheck = blackIsInCheck;
    
    // 将将军状态也存储到每个棋子信息中，供后续AI搜索使用
    piecesInfo.forEach(info => {
        info.boardInfo = boardInfo;
        // 存储将军状态到piecesInfo中，方便访问
        info.redIsInCheck = redIsInCheck;
        info.blackIsInCheck = blackIsInCheck;
    });
};

// 着法排序函数：根据优先级排序着法
// 被将时：吃将子 > 反将 > 其它吃子 > 走将逃逸 > 垫将/其余
// 未被将时：
// 1. 优先处理我方无保护的被单向威胁的棋子执行逃跑着法，如有多个棋子按材料值从高到低排序
// 2. 其次处理我方单向威胁对方无保护棋子的棋子执行吃子着法，如有多个棋子按棋子材料值从高到低排序
// 3. 最后处理不涉及吃和被吃的着法，要求避免移动到被吃的位置
const sortMoves = (moves, board, currentPlayer, piecesInfo, gameStage = 'mid', boardInfo = null) => {
    // 使用传入的gameStage参数，避免重复调用getGamePhase
    
    // 用预计算的被将状态（不能用 boardInfo.checks：那是“谁在将军”，不是“谁被将”）
    const currentIsInCheck = boardInfo
        ? ((currentPlayer === 'red' && boardInfo.redIsInCheck) ||
           (currentPlayer === 'black' && boardInfo.blackIsInCheck))
        : isCheck(board, currentPlayer);

    // 被将时收集正在将军的敌方棋子位置，用于优先吃将子
    let checkerKeys = null;
    if (currentIsInCheck && piecesInfo && piecesInfo.length > 0) {
        const generalInfo = piecesInfo.find(
            p => p.piece && p.piece.type === 'general' && p.piece.color === currentPlayer
        );
        if (generalInfo && generalInfo.threatenedBy) {
            checkerKeys = new Set(
                generalInfo.threatenedBy
                    .filter(t => t.piece && t.piece.color !== currentPlayer)
                    .map(t => `${t.r},${t.c}`)
            );
        }
    }
    
    // 为每个着法计算优先级分数并保存原始索引
    moves.forEach((move, index) => {
        const { from, to } = move;
        const piece = board[from.r][from.c];
        const pieceValue = getMaterialValue(piece, gameStage);

        const targetPiece = board[to.r][to.c];
        const targetPieceValue = targetPiece ? getMaterialValue(targetPiece, gameStage) : 0;
        
        let priority = 4;
        let score = 0;
        
        // 被将：合法着法均已解除将军，按应将手段排序
        if (currentIsInCheck) {
            const capturesChecker = targetPiece && checkerKeys && checkerKeys.has(`${to.r},${to.c}`);
            if (capturesChecker) {
                // 吃掉正在将军的棋子，最高优先
                priority = 0;
                score = 10000 + targetPieceValue;
            } else {
                const nextBoard = board.map(row => [...row]);
                nextBoard[to.r][to.c] = nextBoard[from.r][from.c];
                nextBoard[from.r][from.c] = null;
                const enemyColor = currentPlayer === 'red' ? 'black' : 'red';
                if (isCheck(nextBoard, enemyColor)) {
                    // 解将同时反将
                    priority = 1;
                    score = 5000 + targetPieceValue;
                } else if (targetPiece) {
                    // 其它吃子（含部分垫将吃子）
                    priority = 2;
                    score = targetPieceValue;
                } else if (piece.type === 'general') {
                    // 走将逃逸
                    priority = 3;
                    score = pieceValue;
                } else {
                    // 垫将等其余应将着法
                    priority = 4;
                    score = 0;
                }
            }
        } else {
            // 检查逃跑着法（我方被捉的棋子移动）
            if (boardInfo && boardInfo.threatenedPieces && boardInfo.threatenedPieces.length > 0) {
                const isThreatenedPiece = boardInfo.threatenedPieces.some(p => p.r === from.r && p.c === from.c);
                if (isThreatenedPiece) {
                    // 逃跑着法，优先级第二高
                    priority = 1;
                    // 逃跑分数：我方棋子的材料值
                    score = pieceValue;
                }
                else if (targetPiece) {
                    // 检查是否捉吃着法（我方可吃的棋子）
                    const isCanCapture = boardInfo.canCapture && boardInfo.canCapture.some(p => p.r === to.r && p.c === to.c);
                    if (isCanCapture) {
                        // 捉吃着法，优先级第三高
                        priority = 2;
                        score = targetPieceValue;
                    }
                    else {
                        // 普通吃子着法
                        priority = 3;
                        score = targetPieceValue;
                    }
                }
                else {
                    // 非吃子着法
                    priority = 4;
                    score = 0;
                }
            }
            // 检查捉吃着法（我方可吃的棋子）
            else if (boardInfo && boardInfo.canCapture && boardInfo.canCapture.length > 0) {
                const isCanCapture = boardInfo.canCapture.some(p => p.r === to.r && p.c === to.c);
                if (isCanCapture) {
                    // 捉吃着法，优先级第三高
                    priority = 2;
                    score = targetPieceValue;
                }
                else if (targetPiece) {
                    // 普通吃子着法
                    priority = 3;
                    score = targetPieceValue;
                }
                else {
                    // 非吃子着法
                    priority = 4;
                    score = 0;
                }
            }
            // 没有boardInfo时的fallback逻辑
            else if (targetPiece) {
                // 普通吃子着法
                priority = 3;
                score = targetPieceValue;
            }
            else {
                // 非吃子着法
                priority = 4;
                score = 0;
            }
        }
        
        // 保存优先级、分数和原始索引
        move.priority = priority;
        move.sortScore = score;
        move.originalIndex = index;
    });
    
    // 根据优先级、分数和原始索引排序着法
    moves.sort((a, b) => {
        // 首先按优先级排序，优先级0 > 1 > 2 > 3 > 4
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }
        // 优先级相同时，按分数从高到低排序
        if (a.sortScore !== b.sortScore) {
            return b.sortScore - a.sortScore;
        }
        // 优先级和分数都相同时，按原始索引排序，保持稳定
        return a.originalIndex - b.originalIndex;
    });
    
    return moves;
};

// 处理单个棋子的所有moves，计算机动性、威胁和保护
const processPieceMoves = (board, piecesInfo, info) => {
    const { piece, moves } = info;
    const { baseMoveValue } = EVALUATION_PARAMETERS.mobility;
    
    // 1. 计算机动性：空位置的移动数量
    for (const move of moves) {
        const target = board[move.r][move.c];
        if (!target) {
            // 目标位置为空，计算机动性
            info.mobilityValue += baseMoveValue;
        }
    }
};

// 检查目标位置是否可接受（避免明显送吃/亏换）
// 优化版：接受预计算的boardInfo和piecesInfo，避免重复计算
const isPositionAcceptable = (board, from, to, currentPlayer, boardInfo = null, piecesInfo = null, tryMovePiece = null, gameStage = 'mid') => {
    const movingPiece = tryMovePiece || board[from.r][from.c];
    const targetPiece = board[to.r][to.c];
    const isCapture = targetPiece && targetPiece.color !== currentPlayer;

    // 收集所有棋子信息，只在没有提供时计算
    let localPiecesInfo = piecesInfo;
    if (!localPiecesInfo) {
        localPiecesInfo = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const piece = board[r][c];
                if (piece) {
                    const moves = getValidMoves(board, { r, c });
                    localPiecesInfo.push({
                        piece,
                        r, c, moves,
                        threat: [],
                        threatenedBy: [],
                        guard: [],
                        guardedBy: [],
                        mobilityValue: 0,
                        threatValue: 0,
                        safetyValue: 0,
                        tacticValue: 0
                    });
                }
            }
        }
    }

    // 计算棋子关系和控制信息，只在没有提供时计算
    let localBoardInfo = boardInfo;
    if (!localBoardInfo) {
        localBoardInfo = Array(10).fill(null).map(() => Array(9).fill(null).map(() => []));
        calculatePieceRelations(board, localPiecesInfo, localBoardInfo);
    }

    const controllers = localBoardInfo[to.r][to.c] || [];
    let hasAllyController = false;
    let hasEnemyController = false;

    for (const controller of controllers) {
        // 排除正在移动的棋子本身（走后它不再从原位控制目标）
        if (movingPiece && controller.r === from.r && controller.c === from.c) {
            continue;
        }
        if (controller.color === currentPlayer) {
            hasAllyController = true;
        } else {
            hasEnemyController = true;
        }
    }

    if (isCapture) {
        // 白吃：目标未被敌方保护
        if (!hasEnemyController) {
            return true;
        }
        // 简单 SEE：先得目标分，若会被反吃则再失己方棋子
        const targetValue = getMaterialValue(targetPiece, gameStage);
        const ourValue = getMaterialValue(movingPiece, gameStage);
        let see = targetValue - ourValue;
        // 若有己方继续保护，粗略认为可能再吃回最低价值的敌方保护者
        if (hasAllyController) {
            const enemyGuardValues = controllers
                .filter(c => c.color !== currentPlayer && !(c.r === from.r && c.c === from.c))
                .map(c => {
                    const p = board[c.r][c.c];
                    return p ? getMaterialValue(p, gameStage) : 0;
                })
                .filter(v => v > 0)
                .sort((a, b) => a - b);
            if (enemyGuardValues.length > 0) {
                see += enemyGuardValues[0];
            }
        }
        // 明显亏换（如车换无根兵且会被反吃）则过滤；平换/赚换留给搜索
        return see >= 0;
    }

    // 非吃子：目标仅被敌方控制则视为送吃
    if (controllers.length === 0) {
        return true;
    }
    return !hasEnemyController || hasAllyController;
};

// 计算安全值
// 九宫位置定义：[起始行, 结束行, 起始列, 结束列] - 移到函数外部，避免重复创建
const PALACE_POSITIONS = {
    red: { startRow: 0, endRow: 2, startCol: 3, endCol: 5 }, // 红方九宫（将的位置）
    black: { startRow: 7, endRow: 9, startCol: 3, endCol: 5 }  // 黑方九宫（帅的位置）
};

// 卒林线定义 - 移到函数外部，避免重复创建
const LINELINE_POSITIONS = {
    red: 3,  // 红方卒林线（黑兵需要超过的线）
    black: 6  // 黑方卒林线（红兵需要超过的线）
};

// 从piecesInfo生成位置控制映射表
const buildPositionControlMap = (piecesInfo) => {
    const positionControlMap = new Map();
    
    // 遍历所有棋子，记录每个位置的控制者
    for (const info of piecesInfo) {
        // 检查control属性是否存在且为数组
        if (!info.control || !Array.isArray(info.control)) {
            continue;
        }
        
        // 遍历该棋子的所有控制点
        for (const controlPos of info.control) {
            // 检查controlPos是否有效
            if (!controlPos || typeof controlPos.r !== 'number' || typeof controlPos.c !== 'number') {
                continue;
            }
            
            const key = `${controlPos.r},${controlPos.c}`;
            if (!positionControlMap.has(key)) {
                positionControlMap.set(key, []);
            }
            // 记录控制者的颜色和棋子类型
            positionControlMap.get(key).push({
                color: info.piece.color,
                type: info.piece.type
            });
        }
    }
    
    return positionControlMap;
};

// 计算安全值 - 重构版：基于boardInfo的控制关系
const calculateSafetyValues = (piecesInfo, boardInfo) => {
    // 1. 找到将和帅
    const generalInfo = [];
    piecesInfo.forEach(info => {
        if (info.piece.type === PIECE_TYPES.GENERAL) {
            generalInfo.push(info);
        }
    });
    
    for (const general of generalInfo) {
        const generalColor = general.piece.color;
        const enemyColor = generalColor === 'red' ? 'black' : 'red';
        
        // 检查将帅的控制点是否被敌方棋子控制
        for (const controlPos of general.control) {
            // 获取该控制点的控制者
            const { r, c } = controlPos;
            const positionControllers = boardInfo[r][c];
            
            // 检查是否有敌方棋子控制该位置
            const hasEnemyControl = positionControllers.some(controller => 
                controller.color === enemyColor
            );
            
            // 如果位置有敌方棋子控制，扣50的安全值
            if (hasEnemyControl) {
                general.safetyValue -= 50;
            }
        }
    }
};


// 计算威胁值（基于完整的威胁关系）
// 修改：威胁值应该从搜索发起方的角度计算，而不是从当前行棋方角度
// 添加gameStage参数，避免在循环中重复调用getGamePhase
// 添加boardInfo参数，用于存储威胁类型信息
const calculateThreatValues = (board, piecesInfo, currentPlayer, depth, searchInitiator = null, gameStage = 'mid', boardInfo = null) => {
    // 统计
    if (currentPlayer) {
        perfStats.calculateThreatValuesCount[currentPlayer]++;
    }
    
    // 初始化威胁类型统计信息
    if (boardInfo) {
        boardInfo.checks = [];      // 将军信息
        boardInfo.threatenedPieces = [];  // 被捉的棋子
        boardInfo.canCapture = [];  // 可吃的棋子
    }

    const checkBonus = EVALUATION_PARAMETERS.check.bonus;
    // 同一无根子被多方威胁时只计一次材料威胁，避免重复加分
    const scoredHangingKeys = new Set();
    const checkedGenerals = new Set();
    
    // 遍历所有棋子，计算威胁关系
    for (const info of piecesInfo) {
        const { piece } = info;
        
        // 检查当前棋子是否威胁其他棋子
        for (const threatenedPiece of info.threat) {
            const isAttackerCurrentPlayer = piece.color === currentPlayer;
            
            // 将军：只给小额先手分，绝不按将/帅材料值做 SEE（否则会为将不惜送死）
            const isCheck = threatenedPiece.piece.type === PIECE_TYPES.GENERAL;
            if (isCheck) {
                if (boardInfo) {
                    boardInfo.checks.push({
                        attacker: info,
                        target: threatenedPiece,
                        isCheck: true
                    });
                }
                // 同一将/帅被多方将军时，先手分只加一次
                const generalKey = `${threatenedPiece.r},${threatenedPiece.c}`;
                if (!checkedGenerals.has(generalKey)) {
                    checkedGenerals.add(generalKey);
                    info.threatValue += checkBonus;
                }
                continue;
            }

            const targetValue = getMaterialValue(threatenedPiece.piece, gameStage);
            const hasGuard = threatenedPiece.guardedBy && threatenedPiece.guardedBy.length > 0;
            
            // SEE：仅用于判断交换是否对攻击方有利；威胁分只加在攻击方，避免净分双计
            let sseScore = 0;
            
            if (hasGuard) {
                const attackers = threatenedPiece.threatenedBy
                    .map(attacker => ({
                        ...attacker,
                        value: getMaterialValue(attacker.piece, gameStage)
                    }))
                    .sort((a, b) => a.value - b.value);
                
                const guards = threatenedPiece.guardedBy
                    .map(guard => ({
                        ...guard,
                        value: getMaterialValue(guard.piece, gameStage)
                    }))
                    .sort((a, b) => a.value - b.value);
                
                let exchangeScore = 0;
                let attackerIndex = 0;
                let guardIndex = 0;
                
                while (attackerIndex < attackers.length && guardIndex < guards.length) {
                    if (guardIndex === 0) {
                        exchangeScore += targetValue;
                    }
                    exchangeScore -= attackers[attackerIndex].value;
                    if (attackerIndex + 1 < attackers.length) {
                        exchangeScore += guards[guardIndex].value;
                    }
                    attackerIndex++;
                    guardIndex++;
                }
                sseScore = exchangeScore;
            } else {
                sseScore = targetValue;
            }

            // 只把对攻击方有利的威胁计入 threatValue（单向计入，不做 safety 对称扣分）
            if (!hasGuard) {
                const hangKey = `${threatenedPiece.r},${threatenedPiece.c}`;
                if (!scoredHangingKeys.has(hangKey)) {
                    scoredHangingKeys.add(hangKey);
                    info.threatValue += targetValue;
                }
                if (boardInfo) {
                    if (isAttackerCurrentPlayer) {
                        if (!boardInfo.canCapture.includes(info)) {
                            boardInfo.canCapture.push(info);
                        }
                    } else if (!boardInfo.threatenedPieces.includes(threatenedPiece)) {
                        boardInfo.threatenedPieces.push(threatenedPiece);
                    }
                }
            } else if (sseScore > 0) {
                // 有根子但交换仍赚：折半计入；同一目标只由价值最低的攻击者计分一次
                const hangKey = `g:${threatenedPiece.r},${threatenedPiece.c}`;
                if (!scoredHangingKeys.has(hangKey)) {
                    scoredHangingKeys.add(hangKey);
                    info.threatValue += sseScore * 0.5;
                }
            }
            // sseScore <= 0：亏换/平换，不记威胁分
        }
    }
};

// 帮助关系战术值计算
const calculateAssistValue = (piecesInfo, info) => {
    const { piece, r, c } = info;
    let assistValue = 0;
    
    // 1. 检查是否为己方炮的炮架（加分）
    for (const allyInfo of piecesInfo) {
        if (allyInfo.piece.color === piece.color && allyInfo !== info && allyInfo.piece.type === PIECE_TYPES.CANNON) {
            // 检查炮和当前棋子是否在同一直线上
            if (allyInfo.r === r || allyInfo.c === c) {
                // 检查炮和当前棋子之间是否没有其他棋子
                let hasScreen = true;
                if (allyInfo.r === r) {
                    // 同一行
                    const start = Math.min(allyInfo.c, c) + 1;
                    const end = Math.max(allyInfo.c, c) - 1;
                    for (let col = start; col <= end; col++) {
                        const betweenPiece = piecesInfo.find(p => p.r === r && p.c === col);
                        if (betweenPiece) {
                            hasScreen = false;
                            break;
                        }
                    }
                } else {
                    // 同一列
                    const start = Math.min(allyInfo.r, r) + 1;
                    const end = Math.max(allyInfo.r, r) - 1;
                    for (let row = start; row <= end; row++) {
                        const betweenPiece = piecesInfo.find(p => p.r === row && p.c === c);
                        if (betweenPiece) {
                            hasScreen = false;
                            break;
                        }
                    }
                }
                
                if (hasScreen) {
                    assistValue += EVALUATION_PARAMETERS.assist.cannonScreenValue; // 为己方炮提供炮架，增加战术值
                }
            }
        }
    }
    
    // 2. 检查是否为敌方炮的炮架（扣分）
    for (const enemyInfo of piecesInfo) {
        if (enemyInfo.piece.color !== piece.color && enemyInfo.piece.type === PIECE_TYPES.CANNON) {
            // 检查敌方炮和当前棋子是否在同一直线上
            if (enemyInfo.r === r || enemyInfo.c === c) {
                // 检查敌方炮和当前棋子之间是否没有其他棋子
                let isEnemyScreen = true;
                if (enemyInfo.r === r) {
                    // 同一行
                    const start = Math.min(enemyInfo.c, c) + 1;
                    const end = Math.max(enemyInfo.c, c) - 1;
                    for (let col = start; col <= end; col++) {
                        const betweenPiece = piecesInfo.find(p => p.r === r && p.c === col);
                        if (betweenPiece) {
                            isEnemyScreen = false;
                            break;
                        }
                    }
                } else {
                    // 同一列
                    const start = Math.min(enemyInfo.r, r) + 1;
                    const end = Math.max(enemyInfo.r, r) - 1;
                    for (let row = start; row <= end; row++) {
                        const betweenPiece = piecesInfo.find(p => p.r === row && p.c === c);
                        if (betweenPiece) {
                            isEnemyScreen = false;
                            break;
                        }
                    }
                }
                
                if (isEnemyScreen) {
                    assistValue -= EVALUATION_PARAMETERS.assist.cannonScreenValue; // 为敌方炮提供炮架，减少战术值（扣分）
                }
            }
        }
    }
    
    return assistValue;
};

// 阻挡关系战术值计算
const calculateBlockValue = (board, piecesInfo, info) => {
    const { piece, r, c } = info;
    let blockValue = 0;
    const enemyColor = piece.color === 'red' ? 'black' : 'red';
    
    // 1. 阻挡敌人
    // 1.1 检查是否阻挡对方车的道路
    for (const enemyInfo of piecesInfo) {
        if (enemyInfo.piece.color === enemyColor && enemyInfo.piece.type === PIECE_TYPES.CHARIOT) {
            // 检查车和当前棋子是否在同一直线上
            if (enemyInfo.r === r || enemyInfo.c === c) {
                // 检查两者之间是否没有其它棋子
                let isBlocking = true;
                
                if (enemyInfo.r === r) {
                    // 同一行
                    const start = Math.min(enemyInfo.c, c) + 1;
                    const end = Math.max(enemyInfo.c, c) - 1;
                    for (let col = start; col <= end; col++) {
                        const betweenPiece = piecesInfo.find(p => p.r === r && p.c === col);
                        if (betweenPiece) {
                            isBlocking = false;
                            break;
                        }
                    }
                } else {
                    // 同一列
                    const start = Math.min(enemyInfo.r, r) + 1;
                    const end = Math.max(enemyInfo.r, r) - 1;
                    for (let row = start; row <= end; row++) {
                        const betweenPiece = piecesInfo.find(p => p.r === row && p.c === c);
                        if (betweenPiece) {
                            isBlocking = false;
                            break;
                        }
                    }
                }
                
                if (isBlocking) {
                    // 检查是否阻挡了车的移动
                    blockValue += EVALUATION_PARAMETERS.block.enemyChariotBlockValue;
                }
            }
        }
    }
    
    // 1.2 检查是否别对方马的马腿
    for (const enemyInfo of piecesInfo) {
        if (enemyInfo.piece.color === enemyColor && enemyInfo.piece.type === PIECE_TYPES.HORSE) {
            const horseR = enemyInfo.r;
            const horseC = enemyInfo.c;
            
            // 马腿位置：马的周围8个方向的腿的位置
            const legPositions = [
                { r: horseR + 1, c: horseC }, // 下方腿
                { r: horseR - 1, c: horseC }, // 上方腿
                { r: horseR, c: horseC + 1 }, // 右方腿
                { r: horseR, c: horseC - 1 }  // 左方腿
            ];
            
            // 检查当前棋子是否在马腿位置
            for (const legPos of legPositions) {
                if (legPos.r === r && legPos.c === c) {
                    blockValue += EVALUATION_PARAMETERS.block.enemyHorseBlockValue; // 别马腿，增加战术值
                }
            }
        }
    }
    
    // 1.3 检查是否堵塞对方象的象眼
    for (const enemyInfo of piecesInfo) {
        if (enemyInfo.piece.color === enemyColor && enemyInfo.piece.type === PIECE_TYPES.ELEPHANT) {
            const elephantR = enemyInfo.r;
            const elephantC = enemyInfo.c;
            
            // 象眼位置：象的周围4个方向的象眼位置
            const eyePositions = [
                { r: elephantR + 1, c: elephantC + 1 }, // 右下象眼
                { r: elephantR + 1, c: elephantC - 1 }, // 左下象眼
                { r: elephantR - 1, c: elephantC + 1 }, // 右上象眼
                { r: elephantR - 1, c: elephantC - 1 }  // 左上象眼
            ];
            
            // 检查当前棋子是否在象眼位置
            for (const eyePos of eyePositions) {
                if (eyePos.r === r && eyePos.c === c) {
                    blockValue += EVALUATION_PARAMETERS.block.enemyElephantBlockValue; // 堵塞象眼，增加战术值
                }
            }
        }
    }
    
    // 2. 阻挡己方（扣分）
    // 2.1 检查是否阻挡己方车的道路
    for (const allyInfo of piecesInfo) {
        if (allyInfo.piece.color === piece.color && allyInfo !== info && allyInfo.piece.type === PIECE_TYPES.CHARIOT) {
            // 检查车和当前棋子是否在同一直线上
            if (allyInfo.r === r || allyInfo.c === c) {
                // 检查两者之间是否没有其它棋子
                let isBlocking = true;
                
                if (allyInfo.r === r) {
                    // 同一行
                    const start = Math.min(allyInfo.c, c) + 1;
                    const end = Math.max(allyInfo.c, c) - 1;
                    for (let col = start; col <= end; col++) {
                        const betweenPiece = piecesInfo.find(p => p.r === r && p.c === col);
                        if (betweenPiece) {
                            isBlocking = false;
                            break;
                        }
                    }
                } else {
                    // 同一列
                    const start = Math.min(allyInfo.r, r) + 1;
                    const end = Math.max(allyInfo.r, r) - 1;
                    for (let row = start; row <= end; row++) {
                        const betweenPiece = piecesInfo.find(p => p.r === row && p.c === c);
                        if (betweenPiece) {
                            isBlocking = false;
                            break;
                        }
                    }
                }
                
                if (isBlocking) {
                    // 阻挡己方车道路，扣分
                    blockValue -= EVALUATION_PARAMETERS.block.allyChariotBlockPenalty;
                }
            }
        }
    }
    
    // 2.2 检查是否别己方马的马腿
    for (const allyInfo of piecesInfo) {
        if (allyInfo.piece.color === piece.color && allyInfo !== info && allyInfo.piece.type === PIECE_TYPES.HORSE) {
            const horseR = allyInfo.r;
            const horseC = allyInfo.c;
            
            // 马腿位置：马的周围8个方向的腿的位置
            const legPositions = [
                { r: horseR + 1, c: horseC }, // 下方腿
                { r: horseR - 1, c: horseC }, // 上方腿
                { r: horseR, c: horseC + 1 }, // 右方腿
                { r: horseR, c: horseC - 1 }  // 左方腿
            ];
            
            // 检查当前棋子是否在马腿位置
            for (const legPos of legPositions) {
                if (legPos.r === r && legPos.c === c) {
                    blockValue -= EVALUATION_PARAMETERS.block.allyHorseBlockPenalty; // 别己方马腿，扣分
                }
            }
        }
    }
    
    // 2.3 检查是否堵塞己方象的象眼
    for (const allyInfo of piecesInfo) {
        if (allyInfo.piece.color === piece.color && allyInfo !== info && allyInfo.piece.type === PIECE_TYPES.ELEPHANT) {
            const elephantR = allyInfo.r;
            const elephantC = allyInfo.c;
            
            // 象眼位置：象的周围4个方向的象眼位置
            const eyePositions = [
                { r: elephantR + 1, c: elephantC + 1 }, // 右下象眼
                { r: elephantR + 1, c: elephantC - 1 }, // 左下象眼
                { r: elephantR - 1, c: elephantC + 1 }, // 右上象眼
                { r: elephantR - 1, c: elephantC - 1 }  // 左上象眼
            ];
            
            // 检查当前棋子是否在象眼位置
            for (const eyePos of eyePositions) {
                if (eyePos.r === r && eyePos.c === c) {
                    blockValue -= EVALUATION_PARAMETERS.block.allyElephantBlockPenalty; // 堵塞己方象眼，扣分
                }
            }
        }
    }
    
    return blockValue;
};


// --- Types (Inlined to avoid import issues in Worker) ---
// // type Color - TypeScript type removed for JavaScript compatibility 'red' | 'black';
// // type PieceType - TypeScript type removed for JavaScript compatibility 'general' | 'advisor' | 'elephant' | 'horse' | 'chariot' | 'cannon' | 'soldier';
// // interface Piece - TypeScript interface removed for JavaScript compatibility
// // interface Position - TypeScript interface removed for JavaScript compatibility
// // interface Move - TypeScript interface removed for JavaScript compatibility
// // type Board - TypeScript type removed for JavaScript compatibility (Piece | null)[][];

// --- Opening Book Types ---
// Opening Book Entry - represents possible moves for a position
// interface BookEntry - TypeScript interface removed for JavaScript compatibility

// Individual move in opening book with metadata
// interface BookMove - TypeScript interface removed for JavaScript compatibility

// --- Zobrist Hashing for Opening Book ---
// Each piece type/color/position gets a unique random 53-bit integer
// Uses seeded RNG for deterministic hashing
class ZobristHasher {
    hashTable;  // [row][col][pieceIndex]
    pieceToIndex;

    constructor() {
        this.pieceToIndex = new Map([
            ['red-general', 0],
            ['red-advisor', 1],
            ['red-elephant', 2],
            ['red-horse', 3],
            ['red-chariot', 4],
            ['red-cannon', 5],
            ['red-soldier', 6],
            ['black-general', 7],
            ['black-advisor', 8],
            ['black-elephant', 9],
            ['black-horse', 10],
            ['black-chariot', 11],
            ['black-cannon', 12],
            ['black-soldier', 13],
        ]);

        // Initialize random hash values using seeded RNG (53-bit integers to avoid precision issues)
        this.hashTable = [];
        const MAX_SAFE = 0x1FFFFFFFFFFFFF; // 2^53 - 1
        
        // Simple seeded RNG (LCG - Linear Congruential Generator)
        let seed = 123456789; // Fixed seed for deterministic hashing
        const seededRandom = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };

        for (let r = 0; r < 10; r++) {
            this.hashTable[r] = [];
            for (let c = 0; c < 9; c++) {
                this.hashTable[r][c] = [];
                for (let p = 0; p < 14; p++) {
                    // Generate deterministic 53-bit integer
                    this.hashTable[r][c][p] = Math.floor(seededRandom() * MAX_SAFE);
                }
            }
        }
    }

    /**
     * Compute hash for a board position
     */
    hash(board) {
        let h = 0;
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const piece = board[r][c];
                if (piece) {
                    const key = `${piece.color}-${piece.type}`;
                    const pieceIdx = this.pieceToIndex.get(key);
                    if (pieceIdx !== undefined) {
                        h ^= this.hashTable[r][c][pieceIdx];
                    }
                }
            }
        }
        return h;
    }

    /**
     * Mirror a board horizontally (for symmetry detection)
     */
    mirrorBoard(board) {
        const mirrored = Array(10).fill(null).map(() => Array(9).fill(null));
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                mirrored[r][8 - c] = board[r][c];
            }
        }
        return mirrored;
    }

    /**
     * Mirror a move horizontally
     */
    mirrorMove(move) {
        return {
            from: { r: move.from.r, c: 8 - move.from.c },
            to: { r: move.to.r, c: 8 - move.to.c }
        };
    }

    /**
     * Incrementally update hash after a move (much faster than rehashing)
     */
    updateHash(currentHash, move, movingPiece, capturedPiece ) {
        let newHash = currentHash;

        // Remove piece from source position
        const movingIdx = this.pieceToIndex.get(movingPiece);
        if (movingIdx !== undefined) {
            newHash ^= this.hashTable[move.from.r][move.from.c][movingIdx];
        }

        // Remove captured piece if any
        if (capturedPiece) {
            const capturedIdx = this.pieceToIndex.get(capturedPiece);
            if (capturedIdx !== undefined) {
                newHash ^= this.hashTable[move.to.r][move.to.c][capturedIdx];
            }
        }

        // Add piece to destination
        if (movingIdx !== undefined) {
            newHash ^= this.hashTable[move.to.r][move.to.c][movingIdx];
        }

        return newHash;
    }
}

/**
 * Opening Book Manager
 */
class OpeningBook {
    book;  // Zobrist hash -> moves
    hasher;
    enabled;
    maxPly;  // Maximum ply to use opening book (e.g., 20)

    constructor(maxPly = 12) {
        this.book = new Map();
        this.hasher = new ZobristHasher();
        this.enabled = true;
        this.maxPly = maxPly;
        this.initializeBook();
    }

    /**
     * Initialize with common Chinese Chess openings
     */
    initializeBook() {
        // Add classic Chinese Chess openings manually
        
        /*
        // 1. 中炮过河车对屏风马平炮对车 (Central Cannon vs Screen Horses)
        this.addOpeningLine([
            { from: { r: 7, c: 7 }, to: { r: 7, c: 4 } },  // 1. 炮二平五
            { from: { r: 0, c: 7 }, to: { r: 2, c: 6 } },  // 1... 马8进7
            { from: { r: 9, c: 7 }, to: { r: 7, c: 6 } },  // 2. 马二进三
            { from: { r: 0, c: 8 }, to: { r: 0, c: 7 } },  // 2... 车9平8           
            { from: { r: 9, c: 8 }, to: { r: 9, c: 7 } },  // 3. 车一平二
            { from: { r: 3, c: 6 }, to: { r: 4, c: 6 } },  // 3... 卒7进1
            { from: { r: 9, c: 7 }, to: { r: 3, c: 7 } },  // 4. 车二进六
            { from: { r: 0, c: 1 }, to: { r: 2, c: 2 } },  // 4... 马2进3
            { from: { r: 6, c: 2 }, to: { r: 5, c: 2 } },  // 5. 兵七进一
            { from: { r: 2, c: 7 }, to: { r: 2, c: 8 } },  // 5... 炮8平9
            { from: { r: 3, c: 7 }, to: { r: 3, c: 6 } },  // 6. 车二平三
            { from: { r: 2, c: 8 }, to: { r: 1, c: 8 } },  // 6... 炮9退1          
        ], [85, 85, 95, 90, 90, 85, 85, 80, 85, 85, 85, 85]);

        this.addOpeningLineFromNotation([
            '炮二平五', '马8进7', '马二进三', '车9平8', '车一平二', '卒7进1',
            '车二进六', '马2进3', '兵七进一', '炮8平9', '车二平三', '炮9退1',
            ], [85, 85, 95, 90, 90, 85, 85, 80, 85, 85, 85, 85]);

                this.addOpeningLineFromString([
            '炮二平五 马8进7 马二进三 车9平8 车一平二 卒7进1 车二进六 马2进3 兵七进一 炮8平9 车二平三 炮9退1'
        ], [85, 85, 95, 90, 90, 85, 85, 80, 85, 85, 85, 85]);
        */
    }

    /**
     * Add an opening line to the book
     * @param moves Array of moves representing an opening line
     * @param weights Optional weights for each move (default 100 for all)
     */
    addOpeningLine(moves, weights) {
        // Start with initial board position
        const board = this.createInitialBoard();
        let currentHash = this.hasher.hash(board);

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const weight = weights?.[i] ?? 100;

            // Get or create book entry for this position
            let entry = this.book.get(currentHash);
            if (!entry) {
                entry = { moves: [] };
                this.book.set(currentHash, entry);
            }

            // Add move if not already present
            const existingMove = entry.moves.find(
                m => m.from.r === move.from.r && m.from.c === move.from.c &&
                     m.to.r === move.to.r && m.to.c === move.to.c
            );

            if (!existingMove) {
                entry.moves.push({
                    from: { r: move.from.r, c: move.from.c },
                    to: { r: move.to.r, c: move.to.c },
                    weight: weight
                });
            } else {
                // Update weight if move already exists (take maximum)
                existingMove.weight = Math.max(existingMove.weight, weight);
            }

            // Make the move on the board
            const piece = board[move.from.r][move.from.c];
            const captured = board[move.to.r][move.to.c];
            
            if (!piece) break; // Invalid line

            const pieceKey = `${piece.color}-${piece.type}`;
            const capturedKey = captured ? `${captured.color}-${captured.type}` : undefined;

            // Update hash incrementally
            currentHash = this.hasher.updateHash(currentHash, move, pieceKey, capturedKey);

            // Apply move
            board[move.to.r][move.to.c] = piece;
            board[move.from.r][move.from.c] = null;
        }
    }

    /**
     * Get best move from opening book for current position
     * @param board Current board state
     * @param ply Current ply number (0 = start of game)
     * @returns Move from book, or null if position not in book
     */
    getBookMove(board, ply){
        // Don't use book if disabled or past max ply
        if (!this.enabled || ply >= this.maxPly) {
            console.log('Opening book disabled or past max ply', { enabled: this.enabled, maxPly: this.maxPly, ply: ply });
            return null;
        }
        
        //console.log('Opening book getBookMove called', { ply });
        
        // Try to find move for current position
        const hash = this.hasher.hash(board);
        //console.log('Current position hash:', hash);
        
        let entry = this.book.get(hash);
        //console.log('Entry found for current hash:', entry ? entry.moves.length + ' moves' : 'null');
        if (entry && entry.moves.length > 0) {
            console.log('All possible book moves with weights:', JSON.stringify(entry.moves));
            // Calculate total weight
            const totalWeight = entry.moves.reduce((sum, move) => sum + move.weight, 0);
            console.log('Total weight:', totalWeight);
        }
        
        let mirroredMove = false;

        // If not found, try mirrored position
        if (!entry || entry.moves.length === 0) {
            const mirroredBoard = this.hasher.mirrorBoard(board);
            const mirroredHash = this.hasher.hash(mirroredBoard);
            console.log('No entry found, trying mirrored position:', mirroredHash);
            
            entry = this.book.get(mirroredHash);
            if (entry && entry.moves.length > 0) {
                //console.log('Entry found for mirrored hash:', entry.moves.length + ' moves');
                //console.log('Original mirror moves:', JSON.stringify(entry.moves));
                mirroredMove = true;
            } else {
                //console.log('No entry found for mirrored hash');
            }
        }

        if (!entry || entry.moves.length === 0) {
            //console.log('Opening book move not found for current position');
            return null;
        }

        // Select move based on weights
        const selectedMove = this.selectWeightedMove(entry.moves);
        console.log('Opening book move selected:', selectedMove);
        
        // If we used mirrored position, mirror the move back
        if (selectedMove && mirroredMove) {
            // console.log('Selected mirror move before conversion:', JSON.stringify(selectedMove));
            const mirroredMoveConverted = this.hasher.mirrorMove(selectedMove);
            // console.log('Converted mirror move:', JSON.stringify(mirroredMoveConverted));
            
            // Check if the mirrored move has valid structure
            if (mirroredMoveConverted && mirroredMoveConverted.from && mirroredMoveConverted.to &&
                typeof mirroredMoveConverted.from.r === 'number' && typeof mirroredMoveConverted.from.c === 'number' &&
                typeof mirroredMoveConverted.to.r === 'number' && typeof mirroredMoveConverted.to.c === 'number') {
                return mirroredMoveConverted;
            } else {
                console.log('Mirrored move has invalid structure, returning null');
                return null;
            }
        } else if (selectedMove) {
            // Check if the selected move has valid structure
            if (selectedMove.from && selectedMove.to &&
                typeof selectedMove.from.r === 'number' && typeof selectedMove.from.c === 'number' &&
                typeof selectedMove.to.r === 'number' && typeof selectedMove.to.c === 'number') {
                return selectedMove;
            } else {
                console.log('Selected move has invalid structure, returning null');
                return null;
            }
        }
        
        return null;
    }

    /**
     * Select a move randomly based on weights
     * Higher weight = more likely to be selected
     */
    selectWeightedMove(moves) {
        // Calculate total weight
        const totalWeight = moves.reduce((sum, move) => sum + move.weight, 0);

        // Generate random number
        let random = Math.random() * totalWeight;

        // Select move
        for (const move of moves) {
            random -= move.weight;
            if (random <= 0) {
                return {
                    from: { r: move.from.r, c: move.from.c }, to: { r: move.to.r, c: move.to.c }
                };
            }
        }

        // Fallback (should never reach here)
        return {
            from: { r: moves[0].from.r, c: moves[0].from.c }, to: { r: moves[0].to.r, c: moves[0].to.c }
        };
    }

    /**
     * Helper to create initial board (needed for book initialization)
     */
    createInitialBoard() {
        const board = Array(10).fill(null).map(() => Array(9).fill(null));
        
        // Red pieces (bottom - r=0-2)
        board[0][0] = { type: 'chariot', color: 'red' };
        board[0][1] = { type: 'horse', color: 'red' };
        board[0][2] = { type: 'elephant', color: 'red' };
        board[0][3] = { type: 'advisor', color: 'red' };
        board[0][4] = { type: 'general', color: 'red' };
        board[0][5] = { type: 'advisor', color: 'red' };
        board[0][6] = { type: 'elephant', color: 'red' };
        board[0][7] = { type: 'horse', color: 'red' };
        board[0][8] = { type: 'chariot', color: 'red' };
        board[2][1] = { type: 'cannon', color: 'red' };
        board[2][7] = { type: 'cannon', color: 'red' };
        board[3][0] = { type: 'soldier', color: 'red' };
        board[3][2] = { type: 'soldier', color: 'red' };
        board[3][4] = { type: 'soldier', color: 'red' };
        board[3][6] = { type: 'soldier', color: 'red' };
        board[3][8] = { type: 'soldier', color: 'red' };

        // Black pieces (top - r=7-9)
        board[9][0] = { type: 'chariot', color: 'black' };
        board[9][1] = { type: 'horse', color: 'black' };
        board[9][2] = { type: 'elephant', color: 'black' };
        board[9][3] = { type: 'advisor', color: 'black' };
        board[9][4] = { type: 'general', color: 'black' };
        board[9][5] = { type: 'advisor', color: 'black' };
        board[9][6] = { type: 'elephant', color: 'black' };
        board[9][7] = { type: 'horse', color: 'black' };
        board[9][8] = { type: 'chariot', color: 'black' };
        board[7][1] = { type: 'cannon', color: 'black' };
        board[7][7] = { type: 'cannon', color: 'black' };
        board[6][0] = { type: 'soldier', color: 'black' };
        board[6][2] = { type: 'soldier', color: 'black' };
        board[6][4] = { type: 'soldier', color: 'black' };
        board[6][6] = { type: 'soldier', color: 'black' };
        board[6][8] = { type: 'soldier', color: 'black' };

        return board;
    }

    /**
     * Enable or disable opening book
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    /**
     * Check if opening book is enabled
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Get statistics about the opening book
     */
    getStats() {
        let totalMoves = 0;
        this.book.forEach(entry => {
            totalMoves += entry.moves.length;
        });

        return {
            positions: this.book.size,
            totalMoves
        };
    }

    /**
     * Add opening line from traditional Chinese chess notation
     * @param notation Array of move strings in traditional notation (e.g., ['炮二平五', '马8进7'])
     * @param weights Optional array of weights for each move
     */
    addOpeningLineFromNotation(notation, weights) {
        // Convert traditional notation to coordinate format
        const moves = this.notationToMoves(notation);
        // Add the moves to the opening book
        this.addOpeningLine(moves, weights);
    }

    /**
     * Add opening line from string with space-separated traditional Chinese chess notation
     * @param notationArray Array of strings, each containing space-separated moves (e.g., ['炮二平五 马8进7 车一平二'])
     * @param weights Optional array of weights for each move
     */
    addOpeningLineFromString(notationArray, weights) {
        // Process each string in the array
        if (!notationArray || !Array.isArray(notationArray) || notationArray.length === 0) {
            return;
        }
        notationArray.forEach(notationString => {
            // Split the string by spaces to get individual moves
            const notation = notationString.split(' ').filter(move => move.trim() !== '');
            // Call existing function to add the line
            this.addOpeningLineFromNotation(notation, weights);
        });
    }

    /**
     * Convert coordinate-based moves to traditional Chinese chess notation
     * @param boardHistory Array of board states representing the game history
     * @param moveHistory Array of moves in coordinate format
     * @returns Array of move strings in traditional notation
     */
    movesToNotation(boardHistory, moveHistory) {
        const notation = [];
        let currentColor = 'red'; // Red moves first

        // Type to piece character mapping
        const typeToPiece = {
            'general': { 'red': '帅', 'black': '将' },
            'advisor': { 'red': '仕', 'black': '士' },
            'elephant': { 'red': '相', 'black': '象' },
            'horse': { 'red': '马', 'black': '马' },
            'chariot': { 'red': '车', 'black': '车' },
            'cannon': { 'red': '炮', 'black': '炮' },
            'soldier': { 'red': '兵', 'black': '卒' }
        };

        // Column mapping (coordinate 0-8 to traditional 九-一 for red, 9-1 for black)
        const colToChinese = ['九', '八', '七', '六', '五', '四', '三', '二', '一'];
        const colToArabic = ['9', '8', '7', '6', '5', '4', '3', '2', '1'];

        // Digit to Chinese number mapping for steps
        const digitToChinese = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

        // Helper function to check if there are multiple same-type pieces in the same column
        const hasSameTypeInColumn = (board, pieceType, color, col, excludeRow) => {
            let count = 0;
            for (let r = 0; r < 10; r++) {
                const piece = board[r][col];
                if (r === excludeRow) continue;
                if (piece && piece.type === pieceType && piece.color === color) {
                    count++;
                }
            }
            return count > 0;
        };

        // Helper function to determine front/back marker
        const getFrontBackMarker = (board, pieceType, color, col, currentRow) => {
            const sameTypePieces = [];
            for (let r = 0; r < 10; r++) {
                const piece = board[r][col];
                if (piece && piece.type === pieceType && piece.color === color) {
                    sameTypePieces.push(r);
                }
            }
            if (sameTypePieces.length <= 1) return '';
            if (color === 'red') {
                // 红方：敌方在顶部（r=7-9），r值越大越靠近敌方，是"前"
                const sortedRows = [...sameTypePieces].sort((a, b) => b - a); // Higher rows first = closer to opponent
                return sortedRows[0] === currentRow ? '前' : '后';
            } else {
                // 黑方：敌方在底部（r=0-2），r值越小越靠近敌方，是"前"
                const sortedRows = [...sameTypePieces].sort((a, b) => a - b); // Lower rows first = closer to opponent
                return sortedRows[0] === currentRow ? '前' : '后';
            }
        };

        // Process each move
        for (let i = 0; i < moveHistory.length; i++) {
            const move = moveHistory[i];
            const boardBefore = boardHistory[i];
            const piece = boardBefore[move.from.r][move.from.c];
            
            if (!piece) {
                console.error('No piece found at from position:', move.from);
                continue;
            }

            const pieceType = piece.type;
            const pieceChar = typeToPiece[pieceType][piece.color];
            const isRed = piece.color === 'red';
            
            // Check if there are multiple same-type pieces in the same column
            const hasDuplicate = hasSameTypeInColumn(boardBefore, pieceType, piece.color, move.from.c, move.from.r);
            // Get front/back marker if needed
            const positionMarker = hasDuplicate ? getFrontBackMarker(boardBefore, pieceType, piece.color, move.from.c, move.from.r) : '';
            
            // Determine notation based on piece type and move direction
            let notationStr;
            
            if (pieceType === 'horse' || pieceType === 'advisor' || pieceType === 'elephant') {
                // Diagonal moving pieces - only use 进/退, record target column
                if (isRed) {
                    const fromCol = colToChinese[move.from.c] || '';
                    const toCol = colToChinese[move.to.c] || '';
                    // 红方：敌方在顶部，向上（r增大）是进，向下（r减小）是退
                    const direction = move.to.r > move.from.r ? '进' : '退';
                    notationStr = `${positionMarker}${pieceChar}${fromCol}${direction}${toCol}`;
                } else {
                    // 黑方从右往左是1-9，需要反转列映射
                    const fromCol = colToArabic[8 - move.from.c] || '';
                    const toCol = colToArabic[8 - move.to.c] || '';
                    // 黑方：敌方在底部（r=0），向下（r减小）是进，向上（r增大）是退
                    const direction = move.to.r < move.from.r ? '进' : '退';
                    notationStr = `${positionMarker}${pieceChar}${fromCol}${direction}${toCol}`;
                }
            } else if (pieceType === 'general' || pieceType === 'chariot' || pieceType === 'cannon' || pieceType === 'soldier') {
                // Straight moving pieces - 进/退/平
                if (move.from.c === move.to.c) {
                    // Vertical move - 进/退
                    const steps = Math.abs(move.to.r - move.from.r);
                    // 进是靠近敌方的方向，退是远离敌方的方向
                    // 红方：敌方在顶部，向上（r增大）是进，向下（r减小）是退
                    // 黑方：敌方在底部，向下（r减小）是进，向上（r增大）是退
                    const direction = (isRed ? move.to.r > move.from.r : move.to.r < move.from.r) ? '进' : '退';
                    
                    if (isRed) {
                        const fromCol = colToChinese[move.from.c];
                        // Ensure steps is a valid number between 1-9
                        const validSteps = Math.max(1, Math.min(9, Math.round(steps || 1)));
                        notationStr = `${positionMarker}${pieceChar}${fromCol}${direction}${digitToChinese[validSteps] || ''}`;
                    } else {
                        // 黑方从右往左是1-9，需要反转列映射
                        const fromCol = colToArabic[8 - move.from.c];
                        // Ensure steps is a valid number
                        const validSteps = Math.round(steps || 1);
                        notationStr = `${positionMarker}${pieceChar}${fromCol}${direction}${validSteps}`;
                    }
                } else {
                    // Horizontal move - 平
                    if (isRed) {
                        const fromCol = colToChinese[move.from.c] || '';
                        const toCol = colToChinese[move.to.c] || '';
                        notationStr = `${positionMarker}${pieceChar}${fromCol}平${toCol}`;
                    } else {
                        // 黑方从右往左是1-9，需要反转列映射
                        const fromCol = colToArabic[8 - move.from.c] || '';
                        const toCol = colToArabic[8 - move.to.c] || '';
                        notationStr = `${positionMarker}${pieceChar}${fromCol}平${toCol}`;
                    }
                }
            } else {
                console.error('Unknown piece type:', pieceType);
                continue;
            }
            
            notation.push(notationStr);
            
            // Switch color for next move
            currentColor = currentColor === 'red' ? 'black' : 'red';
        }
        
        return notation;
    }

    /**
     * Convert traditional Chinese chess notation to coordinate moves
     * @param notation Array of move strings in traditional notation
     * @returns Array of moves in coordinate format
     */
    notationToMoves(notation, initialBoard = null) {
        // 确保notation是数组且不为空
        if (!notation || !Array.isArray(notation) || notation.length === 0) {
            return [];
        }
        const moves = [];
        let currentColor = 'red'; // Red moves first

        // Piece character to type mapping
        const pieceMap = {
            '将': 'general', '帅': 'general',
            '士': 'advisor', '仕': 'advisor',
            '象': 'elephant', '相': 'elephant',
            '马': 'horse',
            '车': 'chariot',
            '炮': 'cannon',
            '卒': 'soldier', '兵': 'soldier'
        };

        // Column mapping (traditional notation uses 1-9 from right to left)
        const colMap = {
            '一': 8, '1': 8,
            '二': 7, '2': 7,
            '三': 6, '3': 6,
            '四': 5, '4': 5,
            '五': 4, '5': 4,
            '六': 3, '6': 3,
            '七': 2, '7': 2,
            '八': 1, '8': 1,
            '九': 0, '9': 0
        };

        // Chinese number to digit mapping
        const chineseNumberMap = {
            '一': 1, '1': 1,
            '二': 2, '2': 2,
            '三': 3, '3': 3,
            '四': 4, '4': 4,
            '五': 5, '5': 5,
            '六': 6, '6': 6,
            '七': 7, '7': 7,
            '八': 8, '8': 8,
            '九': 9, '9': 9
        };

        // Initial positions of pieces (red and black)
        // 修复：与新坐标系统保持一致，红方在底部（r=0-2），黑方在顶部（r=7-9）
        const defaultInitialPositions = {
            'red-general': { r: 0, c: 4 },
            'red-advisor': [{ r: 0, c: 3 }, { r: 0, c: 5 }],
            'red-elephant': [{ r: 0, c: 2 }, { r: 0, c: 6 }],
            'red-horse': [{ r: 0, c: 1 }, { r: 0, c: 7 }],
            'red-chariot': [{ r: 0, c: 0 }, { r: 0, c: 8 }],
            'red-cannon': [{ r: 2, c: 1 }, { r: 2, c: 7 }],
            'red-soldier': [{ r: 3, c: 0 }, { r: 3, c: 2 }, { r: 3, c: 4 }, { r: 3, c: 6 }, { r: 3, c: 8 }],
            'black-general': { r: 9, c: 4 },
            'black-advisor': [{ r: 9, c: 3 }, { r: 9, c: 5 }],
            'black-elephant': [{ r: 9, c: 2 }, { r: 9, c: 6 }],
            'black-horse': [{ r: 9, c: 1 }, { r: 9, c: 7 }],
            'black-chariot': [{ r: 9, c: 0 }, { r: 9, c: 8 }],
            'black-cannon': [{ r: 7, c: 1 }, { r: 7, c: 7 }],
            'black-soldier': [{ r: 6, c: 0 }, { r: 6, c: 2 }, { r: 6, c: 4 }, { r: 6, c: 6 }, { r: 6, c: 8 }]
        };

        // Track piece positions as moves are made
        let piecePositions = JSON.parse(JSON.stringify(defaultInitialPositions));
        
        // If initial board is provided, initialize piece positions from it
        if (initialBoard) {
            // Reset piece positions based on initial board
            piecePositions = {
                'red-general': { r: -1, c: -1 },
                'red-advisor': [],
                'red-elephant': [],
                'red-horse': [],
                'red-chariot': [],
                'red-cannon': [],
                'red-soldier': [],
                'black-general': { r: -1, c: -1 },
                'black-advisor': [],
                'black-elephant': [],
                'black-horse': [],
                'black-chariot': [],
                'black-cannon': [],
                'black-soldier': []
            };
            
            // Populate piece positions from initial board
            for (let r = 0; r < 10; r++) {
                for (let c = 0; c < 9; c++) {
                    const piece = initialBoard[r][c];
                    if (piece) {
                        const key = `${piece.color}-${piece.type}`;
                        if (piece.type === 'general') {
                            piecePositions[key] = { r, c };
                        } else {
                            piecePositions[key].push({ r, c });
                        }
                    }
                }
            }
        }

        // Helper function to find piece position
        const findPiecePosition = (pieceType, color, col, direction, board, frontBackMarker = null) => {
            const key = `${color}-${pieceType}`;
            const positions = piecePositions[key];

            // Check if positions exist and are valid
            if (!positions) {
                console.error('No positions found for piece:', key);
                return null;
            }

            if (pieceType === 'general') {
                return positions;
            }

            // Find pieces on the specified column
            const candidates = positions.filter(pos => pos.c === col);

            if (candidates.length === 0) {
                console.error('No candidates found for piece:', key, 'on column:', col);
                // Additional debug info for cannon
                if (pieceType === 'cannon' && color === 'black') {
                    console.log('DEBUG: Candidates after filter:', candidates);
                }
                return null;
            }

            if (candidates.length === 1) {
                return candidates[0];
            }

            // If front/back marker is provided, use it to determine the piece
            if (frontBackMarker === '前') {
                // 前炮：靠近敌方的棋子
                // 红方：r值较大的更靠近敌方（前）
                // 黑方：r值较小的更靠近敌方（前）
                return color === 'red' ? 
                    candidates.reduce((prev, curr) => prev.r > curr.r ? prev : curr, candidates[0]) :
                    candidates.reduce((prev, curr) => prev.r < curr.r ? prev : curr, candidates[0]);
            } else if (frontBackMarker === '后') {
                // 后炮：靠近己方的棋子
                // 红方：r值较小的更靠近己方（后）
                // 黑方：r值较大的更靠近己方（后）
                return color === 'red' ? 
                    candidates.reduce((prev, curr) => prev.r < curr.r ? prev : curr, candidates[0]) :
                    candidates.reduce((prev, curr) => prev.r > curr.r ? prev : curr, candidates[0]);
            }

            // If multiple pieces on the same column and no marker, determine based on direction
            // 对于同一列的棋子，通过比较r值来区分
            if (direction === '进') {
                // 进是向敌方方向移动，所以选择更靠近己方的棋子（后）
                return color === 'red' ? 
                    candidates.reduce((prev, curr) => prev.r < curr.r ? prev : curr, candidates[0]) :
                    candidates.reduce((prev, curr) => prev.r > curr.r ? prev : curr, candidates[0]);
            } else if (direction === '退') {
                // 退是向己方方向移动，所以选择更靠近敌方的棋子（前）
                return color === 'red' ? 
                    candidates.reduce((prev, curr) => prev.r > curr.r ? prev : curr, candidates[0]) :
                    candidates.reduce((prev, curr) => prev.r < curr.r ? prev : curr, candidates[0]);
            }

            return candidates[0]; // Default to first if direction is '平' and no marker
        };

        // Helper function to update piece position
        const updatePiecePosition = (pieceType, color, oldPos, newPos) => {
            const key = `${color}-${pieceType}`;
            const positions = piecePositions[key];

            // Check if positions exist and are valid
            if (!positions) {
                console.error('❌ ERROR: No positions found for piece:', key);
                return;
            }

            if (pieceType === 'general') {
                positions.r = newPos.r;
                positions.c = newPos.c;
                return;
            }

            const index = positions.findIndex(pos => pos.r === oldPos.r && pos.c === oldPos.c);
            if (index !== -1) {
                positions[index].r = newPos.r;
                positions[index].c = newPos.c;
            } else {
                console.error('❌ ERROR: Could not find piece position to update:', oldPos, 'in', positions);
            }
        };

        // Helper function to check if position is valid
        const isValidPos = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;

        // Helper function to get horse moves
        const getHorseMoves = (pos, color) => {
            if (!pos) return [];
            const moves = [];
            const { r, c } = pos;
            const directions = [
                { dr: -2, dc: -1 }, { dr: -2, dc: 1 },
                { dr: -1, dc: -2 }, { dr: -1, dc: 2 },
                { dr: 1, dc: -2 }, { dr: 1, dc: 2 },
                { dr: 2, dc: -1 }, { dr: 2, dc: 1 }
            ];

            // Check if the horse can move in the direction
            const canMove = (dr, dc, blockedR, blockedC) => {
                if (!isValidPos(r + blockedR, c + blockedC)) return false;
                return true;
            };

            directions.forEach(({ dr, dc }, index) => {
                const blockedR = dr > 0 ? 1 : dr < 0 ? -1 : 0;
                const blockedC = dc > 0 ? 1 : dc < 0 ? -1 : 0;
                
                // Check if the path is blocked
                if ((index < 2 || index >= 6) && blockedR !== 0) {
                    // Vertical blocked
                    if (!canMove(dr, dc, blockedR, 0)) return;
                } else if (blockedC !== 0) {
                    // Horizontal blocked
                    if (!canMove(dr, dc, 0, blockedC)) return;
                }

                const newR = r + dr;
                const newC = c + dc;
                if (isValidPos(newR, newC)) {
                    moves.push({ r: newR, c: newC });
                }
            });

            return moves;
        };

        // Helper function to get elephant moves
        const getElephantMoves = (pos, color) => {
            if (!pos) return [];
            const moves = [];
            const { r, c } = pos;
            const directions = [
                { dr: -2, dc: -2 }, { dr: -2, dc: 2 },
                { dr: 2, dc: -2 }, { dr: 2, dc: 2 }
            ];

            // Elephant's territory - red elephants can only be in r<=4, black elephants in r>=5
            const isInTerritory = (r) => {
                return color === 'red' ? r <= 4 : r >= 5;
            };

            directions.forEach(({ dr, dc }) => {
                const midR = r + dr / 2;
                const midC = c + dc / 2;
                const newR = r + dr;
                const newC = c + dc;

                // Check if mid position is empty and new position is valid
                if (isValidPos(midR, midC) && isValidPos(newR, newC) && isInTerritory(newR)) {
                    moves.push({ r: newR, c: newC });
                }
            });

            return moves;
        };

        // Helper function to get advisor moves
        const getAdvisorMoves = (pos, color) => {
            if (!pos) return [];
            const moves = [];
            const { r, c } = pos;
            const directions = [
                { dr: -1, dc: -1 }, { dr: -1, dc: 1 },
                { dr: 1, dc: -1 }, { dr: 1, dc: 1 }
            ];

            // Advisor's territory (palace) - red advisors in r=0-2,c=3-5, black advisors in r=7-9,c=3-5
            const isInPalace = (r, c) => {
                const rRange = color === 'red' ? [0, 2] : [7, 9];
                return r >= rRange[0] && r <= rRange[1] && c >= 3 && c <= 5;
            };

            directions.forEach(({ dr, dc }) => {
                const newR = r + dr;
                const newC = c + dc;
                if (isValidPos(newR, newC) && isInPalace(newR, newC)) {
                    moves.push({ r: newR, c: newC });
                }
            });

            return moves;
        };

        // Create a temporary board to track moves
        let tempBoard = this.createInitialBoard();
        
        // Ensure tempBoard is properly initialized
        if (!tempBoard || tempBoard.length !== 10) {
            console.error('Invalid board initialization');
            return [];
        }
        
        // Verify all rows have 9 columns
        for (let i = 0; i < 10; i++) {
            if (!tempBoard[i] || tempBoard[i].length !== 9) {
                tempBoard[i] = Array(9).fill(null);
            }
        }

        console.log('Total moves:', notation.length);
        notation.forEach(moveNotation => {


            
            // Parse the move notation - keep last group optional
            const regex = /([前后])?([将帅士仕象相马车炮兵卒])([一二三四五六七八九123456789])([进退平])([一二三四五六七八九123456789])?/;
            const match = moveNotation.match(regex);

            if (!match) {
                console.error('Invalid move notation:', moveNotation);
                return;
            }

            const [, frontBackMarker, pieceChar, fromColNotation, direction, toColOrStepNotation] = match;
            const pieceType = pieceMap[pieceChar];
            
            // Get column mapping based on current color (black sees columns mirrored)
            let fromCol = colMap[fromColNotation];
            if (currentColor === 'black') {
                // Mirror the column for black (from black's perspective)
                fromCol = 8 - fromCol;
            }

            // Find the current position of the piece
            const fromPos = findPiecePosition(pieceType, currentColor, fromCol, direction, tempBoard, frontBackMarker);

            if (!fromPos) {
                console.error('Could not find piece position for move:', moveNotation);
                return;
            }

            let toPos;

            if (direction === '平') {
                // Horizontal movement
                let toCol = colMap[toColOrStepNotation];
                if (toCol === undefined) {
                    console.error('Invalid target column notation:', toColOrStepNotation, 'for move:', moveNotation);
                    return;
                }
                
                // Mirror the column for black when moving horizontally
                if (currentColor === 'black') {
                    toCol = 8 - toCol;
                }
                
                toPos = { r: fromPos.r, c: toCol };
            } else {
                // Vertical or diagonal movement
                const steps = chineseNumberMap[toColOrStepNotation];
                  
                if (steps === undefined) {
                    console.error('Invalid step count:', toColOrStepNotation, 'for move:', moveNotation);
                    return;
                }

                if (pieceType === 'horse') {
                    // Horse moves in L-shape
                    const possibleMoves = getHorseMoves(fromPos, currentColor);
                    // Parse target column from notation
                    const targetColNotation = toColOrStepNotation;
                    let targetCol = colMap[targetColNotation];
                    if (targetCol === undefined) {
                        console.error('Invalid target column notation for horse:', targetColNotation, 'in move:', moveNotation);
                        return;
                    }
                    
                    // Mirror the column for black
                    if (currentColor === 'black') {
                        targetCol = 8 - targetCol;
                    }
                    
                    // Find the move that matches both direction and target column
                    toPos = possibleMoves.find(move => {
                        // Check direction (row)
                        // 红方进是r增大（向黑方方向），退是r减小（向红方方向）
                        // 黑方进是r减小（向红方方向），退是r增大（向黑方方向）
                        const directionMatch = direction === '进' ? 
                            (currentColor === 'red' ? move.r > fromPos.r : move.r < fromPos.r) :
                            (currentColor === 'red' ? move.r < fromPos.r : move.r > fromPos.r);
                        // Check column
                        const columnMatch = move.c === targetCol;
                        return directionMatch && columnMatch;
                    });
                } else if (pieceType === 'elephant') {
                    // Elephant moves diagonally 2 steps
                    const possibleMoves = getElephantMoves(fromPos, currentColor);
                    // Parse target column from notation
                    const targetColNotation = toColOrStepNotation;
                    let targetCol = colMap[targetColNotation];
                    if (targetCol === undefined) {
                        console.error('Invalid target column notation for elephant:', targetColNotation, 'in move:', moveNotation);
                        return;
                    }
                    
                    // Mirror the column for black
                    if (currentColor === 'black') {
                        targetCol = 8 - targetCol;
                    }
                    
                    // Find the move that matches both direction and target column
                    toPos = possibleMoves.find(move => {
                        // Check direction (row)
                        // 红方进是r增大（向黑方方向），退是r减小（向红方方向）
                        // 黑方进是r减小（向红方方向），退是r增大（向黑方方向）
                        const directionMatch = direction === '进' ? 
                            (currentColor === 'red' ? move.r > fromPos.r : move.r < fromPos.r) :
                            (currentColor === 'red' ? move.r < fromPos.r : move.r > fromPos.r);
                        // Check column
                        const columnMatch = move.c === targetCol;
                        return directionMatch && columnMatch;
                    });
                } else if (pieceType === 'advisor') {
                    // Advisor moves diagonally 1 step
                    const possibleMoves = getAdvisorMoves(fromPos, currentColor);
                    // Parse target column from notation
                    const targetColNotation = toColOrStepNotation;
                    let targetCol = colMap[targetColNotation];
                    if (targetCol === undefined) {
                        console.error('Invalid target column notation for advisor:', targetColNotation, 'in move:', moveNotation);
                        return;
                    }
                    
                    // Mirror the column for black
                    if (currentColor === 'black') {
                        targetCol = 8 - targetCol;
                    }
                    
                    // Find the move that matches both direction and target column
                    toPos = possibleMoves.find(move => {
                        // Check direction (row)
                        // 红方进是r增大（向黑方方向），退是r减小（向红方方向）
                        // 黑方进是r减小（向红方方向），退是r增大（向黑方方向）
                        const directionMatch = direction === '进' ? 
                            (currentColor === 'red' ? move.r > fromPos.r : move.r < fromPos.r) :
                            (currentColor === 'red' ? move.r < fromPos.r : move.r > fromPos.r);
                        // Check column
                        const columnMatch = move.c === targetCol;
                        return directionMatch && columnMatch;
                    });
                } else {
                    // Straight line movement (chariot, cannon, soldier)
                    // 红方进是r增大（向黑方方向），退是r减小（向红方方向）
                    // 黑方进是r减小（向红方方向），退是r增大（向黑方方向）
                    const step = direction === '进' ? (currentColor === 'red' ? 1 : -1) * steps :
                                                   (currentColor === 'red' ? -1 : 1) * steps;
                    const newR = fromPos.r + step;
                    if (newR < 0 || newR >= 10) {
                        console.error('Invalid row position after move:', newR, 'for move:', moveNotation);
                        return;
                    }
                    toPos = { r: newR, c: fromPos.c };
                }
            }

            if (!toPos) {
                console.error('Could not determine target position for move:', moveNotation);
                return;
            }

            // Add the move to the list
            moves.push({ from: { r: fromPos.r, c: fromPos.c }, to: { r: toPos.r, c: toPos.c } });

            // Check if there's a captured piece
            const capturedPiece = tempBoard[toPos.r][toPos.c];
            
            // If there's a captured piece, remove it from piecePositions
            if (capturedPiece) {
                const capturedKey = `${capturedPiece.color}-${capturedPiece.type}`;
                const capturedPositions = piecePositions[capturedKey];
                
                if (capturedPositions) {
                    // 将/帅不会被吃掉，所以只处理其他棋子
                    if (capturedPiece.type !== 'general') {
                        // Remove the captured position from the array
                        if (Array.isArray(capturedPositions)) {
                            const updatedPositions = capturedPositions.filter(pos => 
                                pos && (pos.r !== toPos.r || pos.c !== toPos.c)
                            );
                            piecePositions[capturedKey] = updatedPositions;
                            
                            // Verify removal was successful
                            const stillExists = updatedPositions.some(pos => 
                                pos && pos.r === toPos.r && pos.c === toPos.c
                            );
                            if (stillExists) {
                                console.error('❌ ERROR: Captured piece still exists in piecePositions!');
                            } else {
                                console.log('✅ SUCCESS: Captured piece removed from piecePositions');
                            }
                        } else {
                            console.error('❌ ERROR: Unexpected non-array positions for piece:', capturedKey);
                        }
                    }
                } else {
                    console.error('❌ ERROR: No positions found for captured piece:', capturedKey);
                }
            }
            
            // Verify the captured piece has been removed
            if (capturedPiece) {
                const capturedKey = `${capturedPiece.color}-${capturedPiece.type}`;
                const finalPositions = piecePositions[capturedKey];
                if (Array.isArray(finalPositions)) {
                    const stillExists = finalPositions.some(pos => 
                        pos && pos.r === toPos.r && pos.c === toPos.c
                    );
                    if (stillExists) {
                        console.error('ERROR: Captured piece still exists in piecePositions:', capturedPiece, 'at', toPos);
                    } else {
                        console.log('SUCCESS: Captured piece removed from piecePositions');
                    }
                }
            }
            
            // Make the move on the temporary board first before updating piece positions
            if (isValidPos(fromPos.r, fromPos.c) && isValidPos(toPos.r, toPos.c) && 
                tempBoard[fromPos.r] && tempBoard[toPos.r]) {
                const piece = tempBoard[fromPos.r][fromPos.c];
                tempBoard[toPos.r][toPos.c] = piece;
                tempBoard[fromPos.r][fromPos.c] = null;
            } else {
                console.error('❌ ERROR: Invalid positions for move:', moveNotation, fromPos, toPos);
            }
            
            // Update the piece position in piecePositions
            updatePiecePosition(pieceType, currentColor, fromPos, toPos);
                        
            // Switch color for next move
            currentColor = currentColor === 'red' ? 'black' : 'red';
        });

        return moves;
    }
}

// --- Constants ---

// Initialize Opening Book
const openingBook = new OpeningBook(12);

const PIECE_VALUES = {
  general: 10000,     // 将/帅
  chariot: 900,       // 车
  cannon: 450,        // 炮
  horse: 400,         // 马
  elephant: 200,      // 象/相
  advisor: 200,       // 士/仕
  soldier: 100,       // 兵/卒
};

// --- Piece-Square Tables ---
const PST_SOLDIER = [
  [10, 15, 20, 25, 25, 25, 20, 15, 10],
  [10, 15, 20, 25, 25, 25, 20, 15, 10],
  [10, 15, 20, 25, 25, 25, 20, 15, 10],
  [10, 15, 25, 30, 30, 30, 25, 15, 10],
  [5, 10, 20, 25, 25, 25, 20, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0]
];
const PST_CHARIOT = [
  [5, 10, 10, 10, 10, 10, 10, 10, 5],
  [10, 15, 20, 20, 20, 20, 20, 15, 10],
  [10, 15, 20, 20, 20, 20, 20, 15, 10],
  [10, 15, 20, 20, 20, 20, 20, 15, 10],
  [10, 15, 20, 20, 20, 20, 20, 15, 10],
  [10, 12, 15, 15, 15, 15, 15, 12, 10],
  [10, 12, 15, 15, 15, 15, 15, 12, 10],
  [5, 10, 12, 10, 10, 10, 12, 10, 5],
  [10, 10, 10, 10, 10, 10, 10, 10, 10],
  [0, 10, 5, 10, 5, 10, 5, 10, 0]
];
const PST_HORSE = [
  [0, -5, 0, 0, 0, 0, 0, -5, 0],
  [0, 5, 15, 10, 10, 10, 15, 5, 0],
  [5, 5, 20, 25, 25, 25, 20, 5, 5],
  [5, 10, 20, 25, 25, 25, 20, 10, 5],
  [0, 5, 15, 20, 20, 20, 15, 5, 0],
  [0, 5, 15, 20, 20, 20, 15, 5, 0],
  [0, 5, 10, 15, 15, 15, 10, 5, 0],
  [0, 0, 5, 5, 5, 5, 5, 0, 0],
  [0, -5, 0, 5, 5, 5, 0, -5, 0],
  [0, -10, -5, 0, 0, 0, -5, -10, 0]
];
const PST_CANNON = [
  [0, 0, 5, 10, 10, 10, 5, 0, 0],
  [0, 5, 15, 10, 10, 10, 15, 5, 0],
  [0, 5, 15, 25, 25, 25, 15, 5, 0],
  [0, 5, 10, 15, 15, 15, 10, 5, 0],
  [0, 5, 5, 5, 5, 5, 5, 5, 0],
  [0, 5, 5, 5, 5, 5, 5, 5, 0],
  [0, 5, 5, 5, 5, 5, 5, 5, 0],
  [5, 15, 20, 30, 30, 30, 20, 15, 5], 
  [0, 5, 5, 10, 10, 10, 5, 5, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0]
];
const PST_DEFENSE = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 20, 30, 20, 0, 0, 0]
];

const getPSTValue = (type, color, r, c) => {
  const rowIdx = color === 'red' ? r : (9 - r);
  let table = [];
  switch (type) {
    case 'soldier': table = PST_SOLDIER; break;
    case 'chariot': table = PST_CHARIOT; break;
    case 'horse': table = PST_HORSE; break;
    case 'cannon': table = PST_CANNON; break;
    default: table = PST_DEFENSE; break; 
  }
  return table[rowIdx]?.[c] || 0;
};

const isValidPos = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

// 获取棋子的威胁目标和保护目标
const getPieceTargets = (board, pos, piece) => {
  const threat = [];           // 当前棋子威胁的敌方棋子
  const guard = [];       // 当前棋子保护的己方棋子
  const { r, c } = pos;
  const isRed = piece.color === 'red';

  const addIfValid = (tr, tc) => {
    if (isValidPos(tr, tc)) {
        const target = board[tr][tc];
        if (target) {
            if (target.color !== piece.color) {
                // 敌方棋子，加入威胁列表
                threat.push({ r: tr, c: tc });
            } else {
                // 己方棋子，加入保护列表，将帅不需要事后的保护
                if (target.type != 'general') {
                    guard.push({ r: tr, c: tc });
                }
            }
        }
    }
  };
  


  switch (piece.type) {
    case 'general': 
      [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        if (nc >= 3 && nc <= 5) {
          if (isRed && nr >= 0 && nr <= 2) addIfValid(nr, nc);
          else if (!isRed && nr >= 7 && nr <= 9) addIfValid(nr, nc);
        }
      });
      break;
    case 'advisor':
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        if (nc >= 3 && nc <= 5) {
          if (isRed && nr >= 0 && nr <= 2) addIfValid(nr, nc);
          else if (!isRed && nr >= 7 && nr <= 9) addIfValid(nr, nc);
        }
      });
      break;
    case 'elephant':
      [[2, 2], [2, -2], [-2, 2], [-2, -2]].forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        const eyeR = r + dr / 2, eyeC = c + dc / 2;
        if (isValidPos(nr, nc) && board[eyeR][eyeC] === null) {
          if (isRed && nr <= 4) addIfValid(nr, nc); 
          else if (!isRed && nr >= 5) addIfValid(nr, nc);
        }
      });
      break;
    case 'horse':
      [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]].forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        const legR = r + (Math.abs(dr) === 2 ? Math.sign(dr) : 0);
        const legC = c + (Math.abs(dc) === 2 ? Math.sign(dc) : 0);
        if (isValidPos(legR, legC) && board[legR][legC] === null) {
          addIfValid(nr, nc);
        }
      });
      break;
    case 'chariot':
      [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
        let nr = r + dr, nc = c + dc;
        while (isValidPos(nr, nc)) {
          if (board[nr][nc] === null) {
            // 空位置，不做处理
          } else {
            addIfValid(nr, nc);
            break;
          }
          nr += dr; nc += dc;
        }
      });
      break;
    case 'cannon':
      [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
        let nr = r + dr, nc = c + dc;
        let screenFound = false;
        while (isValidPos(nr, nc)) {
          if (!screenFound) {
            if (board[nr][nc] === null) {
              // 空位置，不做处理
            } else {
              screenFound = true;
            }
          } else {
            if (board[nr][nc] !== null) {
              addIfValid(nr, nc);
              break;
            }
          }
          nr += dr; nc += dc;
        }
      });
      break;
    case 'soldier': {
      // 红方兵初始位置在r=3，向前走是r增大（向下）；黑方兵初始位置在r=6，向前走是r减小（向上）
      const forward = isRed ? 1 : -1;
      // 红方兵过河条件是r >= 5，黑方兵过河条件是r <= 4
      // 河界位于r=4和r=5之间，红方兵需要走到r=5才能过河，黑方兵需要走到r=4才能过河
      const crossedRiver = isRed ? r >= 5 : r <= 4;
      addIfValid(r + forward, c);
      if (crossedRiver) {
        addIfValid(r, c - 1);
        addIfValid(r, c + 1);
      }
      break;
    }
  }
  return { threat, guard };
};

const getPieceMoves = (board, pos, piece) => {
  const moves = [];
  const { r, c } = pos;
  const isRed = piece.color === 'red';

  const addIfValid = (tr, tc) => {
    if (isValidPos(tr, tc)) {
        const target = board[tr][tc];
        if (!target || target.color !== piece.color) {
            moves.push({ r: tr, c: tc });
        }
    }
  };

  switch (piece.type) {
    case 'general': 
      [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        if (nc >= 3 && nc <= 5) {
          if (isRed && nr >= 0 && nr <= 2) addIfValid(nr, nc);
          else if (!isRed && nr >= 7 && nr <= 9) addIfValid(nr, nc);
        }
      });
      break;
    case 'advisor':
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        if (nc >= 3 && nc <= 5) {
          if (isRed && nr >= 0 && nr <= 2) addIfValid(nr, nc);
          else if (!isRed && nr >= 7 && nr <= 9) addIfValid(nr, nc);
        }
      });
      break;
    case 'elephant':
      [[2, 2], [2, -2], [-2, 2], [-2, -2]].forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        const eyeR = r + dr / 2, eyeC = c + dc / 2;
        if (isValidPos(nr, nc) && board[eyeR][eyeC] === null) {
          if (isRed && nr <= 4) addIfValid(nr, nc); 
          else if (!isRed && nr >= 5) addIfValid(nr, nc);
        }
      });
      break;
    case 'horse':
      [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]].forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        const legR = r + (Math.abs(dr) === 2 ? Math.sign(dr) : 0);
        const legC = c + (Math.abs(dc) === 2 ? Math.sign(dc) : 0);
        if (isValidPos(legR, legC) && board[legR][legC] === null) {
          addIfValid(nr, nc);
        }
      });
      break;
    case 'chariot':
      [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
        let nr = r + dr, nc = c + dc;
        while (isValidPos(nr, nc)) {
          if (board[nr][nc] === null) {
            moves.push({ r: nr, c: nc });
          } else {
            if (board[nr][nc].color !== piece.color) moves.push({ r: nr, c: nc });
            break;
          }
          nr += dr; nc += dc;
        }
      });
      break;
    case 'cannon':
      [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
        let nr = r + dr, nc = c + dc;
        let screenFound = false;
        while (isValidPos(nr, nc)) {
          if (!screenFound) {
            if (board[nr][nc] === null) {
              moves.push({ r: nr, c: nc });
            } else {
              screenFound = true;
            }
          } else {
            if (board[nr][nc] !== null) {
              if (board[nr][nc].color !== piece.color) moves.push({ r: nr, c: nc });
              break;
            }
          }
          nr += dr; nc += dc;
        }
      });
      break;
    case 'soldier': {
      // 红方兵初始位置在r=3，向前走是r增大（向下）；黑方兵初始位置在r=6，向前走是r减小（向上）
      const forward = isRed ? 1 : -1;
      // 红方兵过河条件是r >= 5，黑方兵过河条件是r <= 4
      // 河界位于r=4和r=5之间，红方兵需要走到r=5才能过河，黑方兵需要走到r=4才能过河
      const crossedRiver = isRed ? r >= 5 : r <= 4;
      addIfValid(r + forward, c);
      if (crossedRiver) {
        addIfValid(r, c - 1);
        addIfValid(r, c + 1);
      }
      break;
    }
  }
  return moves;
};

// 获取棋子的控制点
const getPieceControl = (board, pos, piece) => {
  const control = [];
  const { r, c } = pos;
  const isRed = piece.color === 'red';

  const addIfValid = (tr, tc) => {
    if (isValidPos(tr, tc)) {
        control.push({ r: tr, c: tc });
    }
  };

  // 对于非炮棋子，控制点只包括其可以打到的空位置，即如果敌方棋子进入这些点将被攻击
  if (piece.type !== 'cannon') {
    // 获取所有可能的移动位置，然后过滤掉有棋子的位置
    const moves = getPieceMoves(board, pos, piece);
    moves.forEach(move => {
      // 只添加空位置作为控制点
      if (board[move.r][move.c] === null) {
        control.push(move);
      }
    });
  } else {
    // 对于炮棋子，需要特殊计算控制点，控制点只包括其可以打到的空位置，即如果敌方棋子进入这些点将被攻击
    // 炮能控制的是第1个炮台之后（不含炮台）第2个炮台之前（不含炮台）的所有空位置
    // 如果没有第2个炮台那么就是第1个炮台之后（不含炮台）的所有空位置
    [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
      let nr = r + dr, nc = c + dc;
      let screenFoundCount = 0;
      
      while (isValidPos(nr, nc) && screenFoundCount < 2) {
        const currentPiece = board[nr][nc];
        
        if (currentPiece !== null) {
          // 找到一个炮台，增加计数
          screenFoundCount++;
        } else if (screenFoundCount === 1) {
          // 第1个炮台之后，第2个炮台之前的空位置，添加到控制点
          addIfValid(nr, nc);
        }
        
        nr += dr; nc += dc;
      }
    });
  }

  return control;
};

const isFlyingGeneral = (board) => {
  let redG = null;
  let blackG = null;
  for(let r=0; r<ROWS; r++) {
      for(let c=3; c<=5; c++) {
          const p = board[r][c];
          if (p?.type === 'general') {
              if (p.color === 'red') redG = {r, c};
              else blackG = {r, c};
          }
      }
  }
  if (!redG || !blackG || redG.c !== blackG.c) return false;
  
  // 确保循环方向正确，从较小的r到较大的r
  const startR = Math.min(blackG.r, redG.r) + 1;
  const endR = Math.max(blackG.r, redG.r) - 1;
  
  for (let r = startR; r <= endR; r++) {
    if (board[r][redG.c] !== null) return false;
  }
  return true;
};

const isCheck = (board, color, piecesInfo = null, boardInfo = null) => {
    // 优先使用预计算的将军状态
    if (boardInfo) {
        return color === 'red' ? boardInfo.redIsInCheck : boardInfo.blackIsInCheck;
    }
    
    // 如果有piecesInfo，也可以从中获取将军状态
    if (piecesInfo && piecesInfo.length > 0) {
        return color === 'red' ? piecesInfo[0].redIsInCheck : piecesInfo[0].blackIsInCheck;
    }
    
    // 没有预计算结果时，执行原始计算
    // 优化后的isCheck函数，避免重复调用getPieceMoves
    let generalPos = null;
    for(let r=0; r<ROWS; r++) {
        for(let c=0; c<COLS; c++) { 
            const p = board[r][c];
            if (p && p.type === 'general' && p.color === color) {
                generalPos = {r, c};
                break;
            }
        }
        if (generalPos) break;
    }
    
    if (!generalPos) return true;

    const enemyColor = color === 'red' ? 'black' : 'red';
    const { r: gr, c: gc } = generalPos;
    
    // 检查直线攻击（车、将）
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dr, dc] of directions) {
        let nr = gr + dr;
        let nc = gc + dc;
        
        while (isValidPos(nr, nc)) {
            const p = board[nr][nc];
            if (p) {
                if (p.color === enemyColor) {
                    if ((p.type === 'chariot' || p.type === 'general')) {
                        return true;
                    }
                }
                break;
            }
            nr += dr;
            nc += dc;
        }
    }
    
    // 专门检查炮的攻击：敌方炮和我方将在一条线，中间隔着一个任意棋子
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const p = board[r][c];
            if (p && p.color === enemyColor && p.type === 'cannon') {
                // 检查炮和将是否在同一直线上
                if (r === gr || c === gc) {
                    // 同一直线上，计算中间的棋子数量
                    let screenCount = 0;
                    
                    if (r === gr) {
                        // 同一行
                        const startCol = Math.min(c, gc);
                        const endCol = Math.max(c, gc);
                        
                        for (let col = startCol + 1; col < endCol; col++) {
                            if (board[r][col] !== null) {
                                screenCount++;
                            }
                        }
                    } else {
                        // 同一列
                        const startRow = Math.min(r, gr);
                        const endRow = Math.max(r, gr);
                        
                        for (let row = startRow + 1; row < endRow; row++) {
                            if (board[row][c] !== null) {
                                screenCount++;
                            }
                        }
                    }
                    
                    // 炮需要一个炮架才能攻击
                    if (screenCount === 1) {
                        return true;
                    }
                }
            }
        }
    }
    
    // 检查斜线攻击（马、士、象）
    // 检查马的攻击
    const horseMoves = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
    for (const [dr, dc] of horseMoves) {
        const nr = gr + dr;
        const nc = gc + dc;
        if (isValidPos(nr, nc)) {
            // 检查马腿
            const legR = gr + (Math.abs(dr) === 2 ? Math.sign(dr) : 0);
            const legC = gc + (Math.abs(dc) === 2 ? Math.sign(dc) : 0);
            if (board[legR][legC] === null) {
                const p = board[nr][nc];
                if (p && p.color === enemyColor && p.type === 'horse') {
                    return true;
                }
            }
        }
    }
    
    // 检查士的攻击（只在九宫内）
    const advisorMoves = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dr, dc] of advisorMoves) {
        const nr = gr + dr;
        const nc = gc + dc;
        if (isValidPos(nr, nc) && 
            ((color === 'red' && nr >= 0 && nr <= 2) || (color === 'black' && nr >= 7 && nr <= 9)) &&
            nc >= 3 && nc <= 5) {
            const p = board[nr][nc];
            if (p && p.color === enemyColor && p.type === 'advisor') {
                return true;
            }
        }
    }
    
    // 检查兵的攻击（从将位置反推敌兵来源）
    // 红兵向前 +1，黑兵向前 -1；正前方攻击始终有效，左右仅过河兵可攻击
    const enemyForward = enemyColor === 'red' ? 1 : -1;
    const forwardFromR = gr - enemyForward;
    if (isValidPos(forwardFromR, gc)) {
        const p = board[forwardFromR][gc];
        if (p && p.color === enemyColor && p.type === 'soldier') {
            return true;
        }
    }
    for (const dc of [1, -1]) {
        const nc = gc + dc;
        if (isValidPos(gr, nc)) {
            const p = board[gr][nc];
            if (p && p.color === enemyColor && p.type === 'soldier') {
                const crossedRiver = enemyColor === 'red' ? gr >= 5 : gr <= 4;
                if (crossedRiver) {
                    return true;
                }
            }
        }
    }
    
    return false;
};

// 修复：每次检查走法时克隆棋盘，避免修改原始对象
const getValidMoves = (board, pos) => {
  const piece = board[pos.r][pos.c];
  if (!piece) return [];
  
  const pseudoMoves = getPieceMoves(board, pos, piece);
  const validMoves = [];
  
  for (const to of pseudoMoves) {
    // 克隆棋盘，避免修改原始对象
    const clonedBoard = board.map(row => [...row]);
    
    // 修改克隆后的棋盘
    clonedBoard[to.r][to.c] = clonedBoard[pos.r][pos.c];
    clonedBoard[pos.r][pos.c] = null;
    
    // 检查走法是否合法
    let isValid = true;
    if (isFlyingGeneral(clonedBoard)) {
      isValid = false;
    } else if (isCheck(clonedBoard, piece.color)) {
      isValid = false;
    }
    
    if (isValid) {
      validMoves.push(to);
    }
  }
  
  return validMoves;
};

const isValidPlacement = (type, color, r, c) => {
    const isRed = color === 'red';
    switch(type) {
        case 'general':
            // 帅将只能在九宫中心的一条线上
            if (c < 3 || c > 5) return false;
            if (isRed) return r >= 0 && r <= 2;
            else return r >= 7 && r <= 9;
        case 'advisor':
            // 士只能在九宫的5个点之一
            const validAdvisorPositions = {
                red: [[0, 3], [0, 5], [1, 4], [2, 3], [2, 5]],
                black: [[7, 3], [7, 5], [8, 4], [9, 3], [9, 5]]
            };
            return validAdvisorPositions[isRed ? 'red' : 'black'].some(pos => pos[0] === r && pos[1] === c);
        case 'elephant':
            // 相只能在己方半场的7个点之一
            const validElephantPositions = {
                red: [[0, 2], [0, 6], [2, 0], [2, 4], [2, 8], [4, 2], [4, 6]],
                black: [[5, 2], [5, 6], [7, 0], [7, 4], [7, 8], [9, 2], [9, 6]]
            };
            return validElephantPositions[isRed ? 'red' : 'black'].some(pos => pos[0] === r && pos[1] === c);
        case 'soldier':
            // 兵的位置限制：过河前只能在偶数列，过河后可以在任何列
            // 红方兵过河条件是r >= 5，黑方兵过河条件是r <= 4
            const crossedRiver = isRed ? r >= 5 : r <= 4;
            
            if (!crossedRiver) {
                // 过河前只能在偶数列（c=0,2,4,6,8）
                if (![0, 2, 4, 6, 8].includes(c)) return false;
            }
            
            // 兵的位置限制：过河前只能在兵位和兵位前方，过河后敌方半场都合法
            const validSoldierPositions = {
                red: {
                    // 红方初始兵位：r=3, c=0,2,4,6,8
                    initial: [[3, 0], [3, 2], [3, 4], [3, 6], [3, 8]],
                    // 红方兵位前方：r=4, c=0,2,4,6,8
                    forward: [[4, 0], [4, 2], [4, 4], [4, 6], [4, 8]],
                    // 红方过河线：r>=5
                    crossedRiver: r >= 5
                },
                black: {
                    // 黑方初始兵位：r=6, c=0,2,4,6,8
                    initial: [[6, 0], [6, 2], [6, 4], [6, 6], [6, 8]],
                    // 黑方兵位前方：r=5, c=0,2,4,6,8
                    forward: [[5, 0], [5, 2], [5, 4], [5, 6], [5, 8]],
                    // 黑方过河线：r<=4
                    crossedRiver: r <= 4
                }
            };
            
            const soldierInfo = validSoldierPositions[isRed ? 'red' : 'black'];
            const isInitialPos = soldierInfo.initial.some(pos => pos[0] === r && pos[1] === c);
            const isForwardPos = soldierInfo.forward.some(pos => pos[0] === r && pos[1] === c);
            
            if (soldierInfo.crossedRiver) {
                // 过河后敌方半场都合法
                return true;
            } else {
                // 过河前只能在兵位和兵位前方
                return isInitialPos || isForwardPos;
            }
        default:
            return true;
    }
};

const checkGameState = (board, turn, piecesInfo = null, boardInfo = null) => {
    // 优先使用预计算的gameState
    if (boardInfo && boardInfo.gameState) {
        return boardInfo.gameState;
    }
    
    // 没有预计算结果时，执行原始计算
    let hasMoves = false;
    for(let r=0; r<ROWS; r++) {
        for(let c=0; c<COLS; c++) {
            if (board[r][c]?.color === turn) {
                if (getValidMoves(board, {r,c}).length > 0) {
                    hasMoves = true;
                    break;
                }
            }
        }
        if (hasMoves) break;
    }

    if (hasMoves) return { status: 'playing' };

    const inCheck = isCheck(board, turn, piecesInfo, boardInfo);
    const opponent = turn === 'red' ? 'black' : 'red';
    
    if (inCheck) {
        return { status: 'checkmate', winner: opponent };
    } else {
        return { status: 'stalemate', winner: opponent };
    }
};



// 增强的游戏阶段识别
const getGamePhase = (board) => {
  /*
  const pieceCount = countPieces(board);
  
  if (pieceCount <= 8) return 'endgame';
  if (pieceCount <= 16) return 'middlegame';
  return 'opening';
  */
  return 'opening';
};

// 动态权重计算
const calculateDynamicWeights = (phase) => {
  switch (phase) {
    case 'opening':
      return { material: 8, position: 2, tactic: 6, safety: 4, mobility: 7, threat: 3 };
    case 'middlegame':
      return { material: 6, position: 9, tactic: 7, safety: 6, mobility: 8, threat: 7 };
    case 'endgame':
      return { material: 9, position: 7, tactic: 2, safety: 8, mobility: 4, threat: 9 };
    default:
      return { material: 8, position: 5, tactic: 5, safety: 6, mobility: 5, threat: 5 };
  }
};

// 计算棋子总数
const countPieces = (board) => {
  let count = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) count++;
    }
  }
  return count;
};

// 实例化ZobristHasher
const zobristHasher = new ZobristHasher();

// 置换表实现
class TranspositionTable {
    constructor(size = Math.pow(2, 24)) {
        this.table = new Map();
        this.size = size;
        this.hasher = zobristHasher;
        // 统计信息
        this.stats = {
            hits: 0,
            misses: 0,
            exactHits: 0,
            lowerboundHits: 0,
            upperboundHits: 0,
            stores: 0,
            lruEvictions: 0,
            clears: 0
        };
    }
    
    store(hash, depth, value, flag, bestMove = null) {
        if (this.table.size >= this.size) {
            // 简单的LRU策略：移除第一个元素
            const firstKey = this.table.keys().next().value;
            this.table.delete(firstKey);
            this.stats.lruEvictions++;
        }
        this.table.set(hash, { depth, value, flag, bestMove });
        this.stats.stores++;
    }
    
    retrieve(hash) {
        const entry = this.table.get(hash) || null;
        if (entry) {
            this.stats.hits++;
            // 统计不同类型的命中
            switch (entry.flag) {
                case 'exact':
                    this.stats.exactHits++;
                    break;
                case 'lowerbound':
                    this.stats.lowerboundHits++;
                    break;
                case 'upperbound':
                    this.stats.upperboundHits++;
                    break;
            }
        } else {
            this.stats.misses++;
        }
        return entry;
    }
    
    clear() {
        this.table.clear();
        this.stats.clears++;
    }
    
    // 获取统计信息并计算命中率
    getStats() {
        const totalAccesses = this.stats.hits + this.stats.misses;
        const hitRate = totalAccesses > 0 ? (this.stats.hits / totalAccesses * 100).toFixed(2) : 0;
        return {
            ...this.stats,
            totalAccesses,
            hitRate,
            currentSize: this.table.size,
            maxSize: this.size,
            fillPercentage: (this.table.size / this.size * 100).toFixed(2)
        };
    }
    
    // 重置统计信息
    resetStats() {
        this.stats = {
            hits: 0,
            misses: 0,
            exactHits: 0,
            lowerboundHits: 0,
            upperboundHits: 0,
            stores: 0,
            lruEvictions: 0,
            clears: 0
        };
    }
}

// 性能统计
let perfStats = {
    evaluateBoardCount: { red: 0, black: 0 },
    prepareSearchInfoCount: { red: 0, black: 0 },
    calculateThreatValuesCount: { red: 0, black: 0 },
    alphaBetaCalls: 0,  // 总调用次数
    nodesSearched: {}, // 按深度统计搜索的节点数
    movesGenerated: {}, // 按深度统计生成的走法数
    cutoffs: {}, // 按深度统计剪枝次数
    startTime: Date.now()
};

// 重置统计（每次搜索开始时调用）
const resetPerfStats = () => {
    perfStats.evaluateBoardCount = { red: 0, black: 0 };
    perfStats.prepareSearchInfoCount = { red: 0, black: 0 };
    perfStats.calculateThreatValuesCount = { red: 0, black: 0 };
    perfStats.alphaBetaCalls = 0;
    perfStats.nodesSearched = {};
    perfStats.movesGenerated = {};
    perfStats.cutoffs = {};
    perfStats.startTime = Date.now();
};

// 打印统计信息
const logPerfStats = (currentPlayer) => {
    const elapsed = Date.now() - perfStats.startTime;
    console.log(`📊 性能统计 (${currentPlayer}) - ${elapsed}ms:`);
    console.log(`   evaluateBoard: red=${perfStats.evaluateBoardCount.red}, black=${perfStats.evaluateBoardCount.black}`);
    console.log(`   prepareSearchInfo: red=${perfStats.prepareSearchInfoCount.red}, black=${perfStats.prepareSearchInfoCount.black}`);
    console.log(`   calculateThreatValues: red=${perfStats.calculateThreatValuesCount.red}, black=${perfStats.calculateThreatValuesCount.black}`);
    console.log(`   alphaBeta调用次数: ${perfStats.alphaBetaCalls}`);
    
    // 打印按深度统计的节点数、走法数、剪枝数
    const depths = Object.keys(perfStats.nodesSearched).sort((a, b) => a - b);
    if (depths.length > 0) {
        console.log('   按深度统计:');
        for (const d of depths) {
            console.log(`     深度${d}: 节点=${perfStats.nodesSearched[d]}, 走法=${perfStats.movesGenerated[d] || 0}, 剪枝=${perfStats.cutoffs[d] || 0}`);
        }
    }
};

const transpositionTable = new TranspositionTable();

// Worker message handling
if (typeof self !== 'undefined') {
    self.onmessage = function(e) {
    const { type, payload } = e.data;
    
    switch (type) {            
        case 'SEARCH': {
            const { board: searchBoard, turn: searchTurn, depth: searchDepth, randomness: searchRandomness, gameId, openingBookEnabled: searchOpeningBookEnabled = true, ply: searchPly = 0, enableTimeLimit: searchEnableTimeLimit = false } = payload;
            // Set opening book enabled status
            openingBook.setEnabled(searchOpeningBookEnabled);
            // 记录搜索开始时间
            const startTime = performance.now();
            // 执行搜索
            const bestSearchMove = getBestMove(searchBoard, searchTurn, searchDepth, searchRandomness, searchPly, searchEnableTimeLimit);
            // 记录搜索结束时间并计算思考时间
            const endTime = performance.now();
            const thinkingTime = endTime - startTime;
            
            // 检查是否来自开局库
            const bookMoveSearch = openingBook.getBookMove(searchBoard, searchPly);
            const fromBookSearch = !!bookMoveSearch && JSON.stringify(bookMoveSearch) === JSON.stringify(bestSearchMove.bestMove);
            
            // 添加性能统计日志
            logPerfStats(searchTurn);
            
            // 添加思考时间日志
            console.log(`Search completed in ${Math.round(thinkingTime)}ms, gameId=${gameId}, bestMove=${JSON.stringify(bestSearchMove.bestMove)}, secondBestMove=${JSON.stringify(bestSearchMove.secondBestMove)}, fromBook=${fromBookSearch}`);
            // 发送搜索结果和思考时间
            self.postMessage({ 
                type: 'SEARCH_COMPLETE', 
                payload: { 
                    bestMove: bestSearchMove.bestMove, 
                    secondBestMove: bestSearchMove.secondBestMove, 
                    gameId, 
                    fromBook: fromBookSearch, 
                    thinkingTime: Math.round(thinkingTime), // 四舍五入到毫秒
                    moveSequence: bestSearchMove.moveSequence,
                    secondMoveSequence: bestSearchMove.secondMoveSequence,
                    bestMoveScore: bestSearchMove.bestMoveScore,
                    secondBestMoveScore: bestSearchMove.secondBestMoveScore,
                    allMovesWithScores: bestSearchMove.allMovesWithScores || []
                } 
            });
            break;
        }
        case 'getValidMoves': {
            const { board: vmBoard, pos: vmPos } = payload;
            const validMoves = getValidMoves(vmBoard, vmPos);
            self.postMessage({
                type: 'validMoves',
                moves: validMoves
            });
            break;
        }
            
        case 'getPieceRelations': {
            const { board: prBoard, pos: prPos } = payload;
            const piece = prBoard[prPos.r][prPos.c];
            
            // 调用evaluateBoard获取完整的棋子信息和boardInfo
            const phase = getGamePhase(prBoard);
            const gameStage = phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';
            const boardEvaluation = evaluateBoard(prBoard, false, null, 0, null, gameStage);
            const piecesInfo = boardEvaluation.piecesInfo;
            const boardInfo = boardEvaluation.boardInfo;
            
            // Get the current position's controllers from boardInfo
            const controllers = boardInfo[prPos.r][prPos.c] || [];
            
            let relations = {
                threat: [], 
                threatenedBy: [], 
                guard: [], 
                guardedBy: [], 
                control: [],
                controllers: controllers // 添加控制者信息，现在是位置数组 [{r,c}] 
            };
            
            // 如果点击的是棋子，返回该棋子的关系信息
            if (piece) {
                // Find the current piece info
                const currentPieceInfo = piecesInfo.find(p => p.r === prPos.r && p.c === prPos.c);
                
                if (currentPieceInfo) {
                    // Extract relations
                    const threat = currentPieceInfo.threat.map(threatPiece => ({ r: threatPiece.r, c: threatPiece.c }));
                    const threatenedBy = currentPieceInfo.threatenedBy.map(threatenedByPiece => ({ r: threatenedByPiece.r, c: threatenedByPiece.c }));
                    const guard = currentPieceInfo.guard.map(guardPiece => ({ r: guardPiece.r, c: guardPiece.c }));
                    const guardedBy = currentPieceInfo.guardedBy.map(guardedByPiece => ({ r: guardedByPiece.r, c: guardedByPiece.c }));
                    const control = currentPieceInfo.control.map(controlPos => ({ r: controlPos.r, c: controlPos.c }));
                    
                    relations = {
                        threat, 
                        threatenedBy, 
                        guard, 
                        guardedBy, 
                        control,
                        controllers
                    };
                }
            }
            
            self.postMessage({
                type: 'pieceRelations',
                relations: relations
            });
            break;
        }
            
        case 'checkGameState': {
            const { board: cgsBoard, turn: cgsTurn } = payload;
            const gameState = checkGameState(cgsBoard, cgsTurn);
            self.postMessage({
                type: 'gameState',
                state: gameState
            });
            break;
        }
            
        case 'evaluateBoard': {
            const { board: evalBoard, turn: evalTurn, isReplay = false, depth = 1 } = payload;
            // 打印接收的参数
            //console.log('evaluateBoard called with:', { turn: evalTurn, isReplay, depth });
            const phase = getGamePhase(evalBoard);
            const gameStage = phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';
            const detailedEval = evaluateBoard(evalBoard, isReplay, evalTurn, depth, evalTurn, gameStage);
            self.postMessage({
                type: 'detailedEvaluation',
                evaluation: detailedEval
            });
            break;
        }

        case 'evaluatePiece': {
            const { board: pieceEvalBoard, pos: pieceEvalPos, turn } = payload;
            const piece = pieceEvalBoard[pieceEvalPos.r][pieceEvalPos.c];
            
            if (!piece) {
                self.postMessage({
                    type: 'pieceEvaluation',
                    evaluation: {
                        material: 0,
                        position: 0,
                        mobility: 0,
                        threat: 0,
                        safety: 0,
                        tactic: 0
                    }
                });
                return;
            }
            else {
                // 主动调用evaluateBoard获取完整的评估信息
                // 获取当前游戏阶段
                const phase = getGamePhase(pieceEvalBoard);
                const gameStage = phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';
                const boardEvaluation = evaluateBoard(pieceEvalBoard, false, turn, 0, turn, gameStage);
                
                // 从evaluateBoard的返回值中找到当前棋子的信息
                currentPieceInfo = boardEvaluation.piecesInfo.find(
                    p => p.r === pieceEvalPos.r && p.c === pieceEvalPos.c
                );
                
                if (currentPieceInfo) {
                    // 应用权重并返回单个棋子的评估值
                    const evaluation = {
                        material: currentPieceInfo.materialValue * VALUE_WEIGHTS.material,
                        position: currentPieceInfo.positionValue * VALUE_WEIGHTS.position,
                        mobility: currentPieceInfo.mobilityValue * VALUE_WEIGHTS.mobility,
                        threat: currentPieceInfo.threatValue * VALUE_WEIGHTS.threat,
                        safety: currentPieceInfo.safetyValue * VALUE_WEIGHTS.safety,
                        tactic: currentPieceInfo.tacticValue * VALUE_WEIGHTS.tactic
                    };
                    
                    self.postMessage({
                        type: 'pieceEvaluation',
                        evaluation: evaluation
                    });
                } else {
                    // 如果仍然找不到棋子信息，返回默认值
                    self.postMessage({
                        type: 'pieceEvaluation',
                        evaluation: {
                            material: 0,
                            position: 0,
                            mobility: 0,
                            threat: 0,
                            safety: 0,
                            tactic: 0
                        }
                    });
                }
                return;
            }
        }
            
        case 'isCheck': {
            const { board: cBoard, color: cColor } = payload;
            const inCheck = isCheck(cBoard, cColor);
            self.postMessage({
                type: 'check',
                isCheck: inCheck
            });
            break;
        }
            
        case 'isValidPlacement': {
            const { type: ipType, color: ipColor, r, c } = payload;
            const validPlacement = isValidPlacement(ipType, ipColor, r, c);
            self.postMessage({
                type: 'validPlacement',
                isValid: validPlacement
            });
            break;
        }
            
        case 'addOpeningLineFromString': {
            const { moves, weights } = payload;
            // Add the opening line to the opening book
            openingBook.addOpeningLineFromString([moves], weights);
            // Send confirmation
            self.postMessage({ 
                type: 'openingLineAdded', 
                success: true 
            });
            break;
        }
            
        case 'movesToNotation': {
            const { boardHistory, moveHistory } = payload;
            const notation = openingBook.movesToNotation(boardHistory, moveHistory);
            self.postMessage({ 
                type: 'notation', 
                notation: notation 
            });
            break;
        }
            
        case 'notationToMoves': {
            const { notation: notationString, initialBoard } = payload;
            const movesFromNotation = openingBook.notationToMoves(notationString, initialBoard);
            self.postMessage({ 
                type: 'moves', 
                moves: movesFromNotation 
            });
            break;
        }
            
        case 'setValueWeights': {
            VALUE_WEIGHTS = { ...VALUE_WEIGHTS, ...payload };
            console.log('Updated VALUE_WEIGHTS:', VALUE_WEIGHTS);
            break;
        }
    }
};

    // Override console.log to send messages back to main thread
    const originalConsoleLog = console.log;
    console.log = function(...args) {
        // Send to main thread
        self.postMessage({
            type: 'log',
            data: args.join(' ')
        });
        
        // Also log to worker console
        originalConsoleLog.apply(console, args);
    };
}

// 迭代加深搜索实现
const iterativeDeepening = (board, turn, maxDepth = 4, timeLimit = 5000, enableTimeLimit = false) => {
  // 重置性能统计
  resetPerfStats();
  
  const startTime = Date.now();
  let bestMove = null;
  let secondBestMove = null;

  // 清空置换表
  transpositionTable.resetStats();
  transpositionTable.clear();
  
  // 第一步：获取当前游戏阶段
  const phase = getGamePhase(board);
  // 将游戏阶段转换为材料值计算所需的格式
  const gameStage = phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';

  // 使用evaluateBoard获取完整的评估信息（包括piecesInfo和boardInfo）
  const rootEvalResult = evaluateBoard(board, false, turn, 0, turn, gameStage);
  const rootPiecesInfo = rootEvalResult.piecesInfo;
  const rootBoardInfo = rootEvalResult.boardInfo;

  // 收集所有根节点走法；未被将时过滤送吃，被将时保留全部合法应将着法
  let rootMoves = [];
  const rootInCheck = (turn === 'red' && rootBoardInfo.redIsInCheck) ||
                      (turn === 'black' && rootBoardInfo.blackIsInCheck);
  
  // 收集根节点走法，使用预计算的boardInfo和piecesInfo
  //console.log(`开始收集根节点走法，当前玩家: ${turn}`);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]?.color === turn) {
        const piece = board[r][c];
        const validDestinations = getValidMoves(board, { r, c });
        //console.log(`棋子(${r},${c}) ${piece.type} 有 ${validDestinations.length} 个有效移动`);
        validDestinations.forEach(to => {
          // 被将时不得用送吃过滤丢掉唯一出路；否则检查目标是否可接受
          const isAcceptable = rootInCheck || isPositionAcceptable(board, { r, c }, to, turn, rootBoardInfo, rootPiecesInfo, piece, gameStage);
          //console.log(`移动 (${r},${c}) -> (${to.r},${to.c}) 是否安全: ${isAcceptable}`);
          if (isAcceptable) {
            rootMoves.push({ from: {r,c}, to, score: 0 });
            //console.log(`添加安全移动: (${r},${c}) -> (${to.r},${to.c})`);
          }
        });
      }
    }
  }
  //console.log(`根节点走法收集完成，共收集到 ${rootMoves.length} 个安全移动`);

  // 对根节点着法进行排序，传递gameStage和boardInfo避免重复计算
  rootMoves = sortMoves(rootMoves, board, turn, rootPiecesInfo, gameStage, rootBoardInfo);
    
  let depth = maxDepth;  
  // 检查时间限制
  if (enableTimeLimit && Date.now() - startTime > timeLimit) {
    console.log(`Iterative Deepening stopped at depth ${depth-1} due to time limit`);
  }
  console.log(`Starting depth ${depth} search | turn: ${turn}, maxDepth: ${maxDepth}, timeLimit: ${timeLimit}ms, enableTimeLimit: ${enableTimeLimit}`);
  
  
  // 对每个根节点走法进行alpha-beta搜索
  for (const item of rootMoves) {
    const nextBoard = board.map(row => [...row]);
    nextBoard[item.to.r][item.to.c] = nextBoard[item.from.r][item.from.c];
    nextBoard[item.from.r][item.from.c] = null;
    
    // 检查当前局面是否为捉子局面且已重复4次以上
    const nextHash = zobristHasher.hash(nextBoard);
    // 计算下一个行棋玩家，基于当前turn
    const nextTurn = turn === 'red' ? 'black' : 'red';
    
    // 正确的minimax逻辑：
    // 1. 搜索发起方是turn，AI为turn寻找最优走法
    // 2. turn走完一步后，轮到对手(nextTurn)走棋
    // 3. maximizing参数：当前玩家是否是搜索发起方
    //    - 如果是，maximizing = true（最大化自己的分数）
    //    - 如果否，maximizing = false（最小化对手的分数）
    // 4. 传递turn作为searchInitiator，确保评估始终从turn角度计算
    
    const maximizing = false;
    const alphaBetaResult = alphaBeta(nextBoard, depth - 1, -Infinity, Infinity, maximizing, nextTurn, depth, turn, gameStage);
    const score = alphaBetaResult.value;
    item.score = score;
    item.moveSequence = [{ from: item.from, to: item.to }, ...alphaBetaResult.moveSequence];
  }
    
    // 按分数排序 - 由于score已经是净胜分（当前玩家-对手），所以双方都应选择分数最大的走法
    rootMoves.sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) < 1e-6) {
            // 分数相同，根据胜负情况比较序列长度
            // 胜利分数为正，失败分数为负
            if (a.score > 0) {
                // 都是胜利，选择序列更短的
                return (a.moveSequence?.length || 0) - (b.moveSequence?.length || 0);
            } else if (a.score < 0) {
                // 都是失败，选择序列更长的
                return (b.moveSequence?.length || 0) - (a.moveSequence?.length || 0);
            } else {
                return 0;
            }
        }
        return scoreDiff;
    });
    
    // 更新最优走法
    if (rootMoves.length > 0) {
      bestMove = rootMoves[0]; // rootMoves元素直接是move对象，没有.move属性
      secondBestMove = rootMoves.length > 1 ? rootMoves[1] : null;
    }
  
  // 获取并打印置换表统计信息
  const ttStats = transpositionTable.getStats();

  /*
  console.log('\n置换表使用统计信息:');
  console.log(`   访问总数: ${ttStats.totalAccesses}`);
  console.log(`   命中次数: ${ttStats.hits} (${ttStats.hitRate}%)`);
  console.log(`   - Exact命中: ${ttStats.exactHits}`);
  console.log(`   - Lowerbound命中: ${ttStats.lowerboundHits}`);
  console.log(`   - Upperbound命中: ${ttStats.upperboundHits}`);
  console.log(`   未命中次数: ${ttStats.misses}`);
  console.log(`   存储次数: ${ttStats.stores}`);
  console.log(`   LRU驱逐次数: ${ttStats.lruEvictions}`);
  console.log(`   表填充率: ${ttStats.currentSize}/${ttStats.maxSize} (${ttStats.fillPercentage}%)`);
  */
  // 找出最优着法序列和次优着法序列
  let bestMoveSequence = [];
  let secondMoveSequence = [];
  if (rootMoves.length > 0) {
    bestMoveSequence = rootMoves[0].moveSequence || [];
  }
  if (rootMoves.length > 1) {
    secondMoveSequence = rootMoves[1].moveSequence || [];
  }
  
  return { bestMove, secondBestMove, rootMoves, searchTime: Date.now() - startTime, ttStats, moveSequence: bestMoveSequence, secondMoveSequence };
};

// 修复：alphaBeta函数需要一个额外的参数来标识搜索发起方，确保评估始终从发起方角度计算
const alphaBeta = (b, d, alpha, beta, maximizing, currentPlayer, searchDepth = 0, searchInitiator = currentPlayer, gameStage = 'mid') => {
    // maximizing表示当前玩家是否正在最大化自己的分数
    // currentPlayer表示当前行棋玩家的颜色
    // searchInitiator表示搜索发起方，评估值始终从发起方角度计算

    // 性能统计
    perfStats.alphaBetaCalls++;
    if (!perfStats.nodesSearched[d]) perfStats.nodesSearched[d] = 0;
    perfStats.nodesSearched[d]++;

    let piecesInfo, boardInfo, evalResult;

    // 叶节点：调用完整的evaluateBoard
    if (d === 0) {
        evalResult = evaluateBoard(b, false, searchInitiator, searchDepth, searchInitiator, gameStage);
        piecesInfo = evalResult.piecesInfo;
        boardInfo = evalResult.boardInfo;

        // 叶节点评估：始终从搜索发起方角度计算评估值
        const evalPlayer = searchInitiator;
        const opponent = evalPlayer === 'red' ? 'black' : 'red';
        // 计算净胜分：发起方的总分减去对方的总分
        const netScore = evalResult[evalPlayer].total - evalResult[opponent].total;
        return { value: netScore, moveSequence: [] };
    }

    // 非叶节点：使用轻量级的prepareSearchInfo
    const searchInfo = prepareSearchInfo(b, currentPlayer, gameStage);
    piecesInfo = searchInfo.piecesInfo;
    boardInfo = searchInfo.boardInfo;
    
    // 检查游戏状态，使用boardInfo中的预计算结果
    if (boardInfo.gameState && boardInfo.gameState.status !== 'playing') {
        const gameState = boardInfo.gameState;
        // 游戏结束，从搜索发起方角度评估
        if (gameState.status === 'checkmate' || gameState.status === 'stalemate') {
            // 如果搜索发起方是获胜者，返回正分；否则返回负分
            const isInitiatorWinner = gameState.winner === searchInitiator;
            const baseScore = isInitiatorWinner ? 100000 : -100000;
            const stepsFromRoot = searchDepth - d; // 从根节点到当前节点的步数
            const adjustedScore = baseScore + (isInitiatorWinner ? d : stepsFromRoot);
            return { value: adjustedScore, moveSequence: [] };
        }
        return { value: 0, moveSequence: [] };
    }
    /*
    // 尝试从置换表中获取缓存的结果
    const hash = zobristHasher.hash(b);
    const ttEntry = transpositionTable.retrieve(hash);
    if (ttEntry && ttEntry.depth >= d) {
        if (ttEntry.flag === 'exact') {
            return ttEntry.value;
        } else if (ttEntry.flag === 'lowerbound' && ttEntry.value >= beta) {
            return beta;
        } else if (ttEntry.flag === 'upperbound' && ttEntry.value <= alpha) {
            return alpha;
        }
    }
    */
   



    if (d === 0) {
        // 叶节点评估：始终从搜索发起方角度计算评估值
        const evalPlayer = searchInitiator;
        const opponent = evalPlayer === 'red' ? 'black' : 'red';
        // 计算净胜分：发起方的总分减去对方的总分
        const netScore = evalResult[evalPlayer].total - evalResult[opponent].total;
        return { value: netScore, moveSequence: [] };
    }

    // 非叶节点，使用已获取的piecesInfo和boardInfo
    const abPiecesInfo = piecesInfo;
    const abBoardInfo = boardInfo;

    // 优化：只生成当前玩家的棋子的走法，避免不必要的遍历
    let moves = [];
    // 当前玩家颜色与currentPlayer保持一致
    const currentPlayerColor = currentPlayer;
    
    // 预先获取所有当前玩家的棋子位置，避免遍历整个棋盘
    const playerPieces = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (b[r][c]?.color === currentPlayerColor) {
          playerPieces.push({ r, c, piece: b[r][c] });
        }
      }
    }
    
    // 只遍历当前玩家的棋子生成走法；被将时保留全部合法应将着法，否则过滤送吃
    const abInCheck = (currentPlayerColor === 'red' && abBoardInfo.redIsInCheck) ||
                      (currentPlayerColor === 'black' && abBoardInfo.blackIsInCheck);
    for (const { r, c, piece } of playerPieces) {
      const validDestinations = getValidMoves(b, { r, c });
      validDestinations.forEach(to => {
         if (abInCheck || isPositionAcceptable(b, { r, c }, to, currentPlayerColor, abBoardInfo, abPiecesInfo, piece, gameStage)) {
           moves.push({ from: {r,c}, to, score: 0 });
         }
      });
    }
    
    // 处理空moves数组，避免返回Infinity
    if (moves.length === 0) {
        // 使用boardInfo中的预计算gameState
        const gameState = abBoardInfo.gameState;
        if (gameState && (gameState.status === 'checkmate' || gameState.status === 'stalemate')) {
            // 如果搜索发起方是获胜者，返回正分；否则返回负分
            const isInitiatorWinner = gameState.winner === searchInitiator;
            const baseScore = isInitiatorWinner ? 100000 : -100000;
            const stepsFromRoot = searchDepth - d; // 从根节点到当前节点的步数
            const adjustedScore = baseScore + (isInitiatorWinner ? d : stepsFromRoot);
            return { value: adjustedScore, moveSequence: [] };
        }
        return { value: 0, moveSequence: [] };
    }

    // 统计生成的走法数
    if (!perfStats.movesGenerated[d]) perfStats.movesGenerated[d] = 0;
    perfStats.movesGenerated[d] += moves.length;

    // 计算威胁信息用于排序（只有排序需要这些信息）
    calculateThreatValues(b, abPiecesInfo, currentPlayer, d, searchInitiator, gameStage, abBoardInfo);
    
    // 对着法进行排序，传递gameStage和boardInfo避免重复计算
    moves = sortMoves(moves, b, currentPlayerColor, abPiecesInfo, gameStage, abBoardInfo);
    
    if (maximizing) {
      let maxEval = -Infinity;
      let bestMove = null;
      let bestMoveSequence = [];
      for (const move of moves) {
        const nextBoard = b.map(row => [...row]);
        nextBoard[move.to.r][move.to.c] = nextBoard[move.from.r][move.from.c];
        nextBoard[move.from.r][move.from.c] = null;
        // 下一个行棋的玩家是当前玩家的对手
        const nextPlayer = currentPlayer === 'red' ? 'black' : 'red';
        // 递归调用时保持searchInitiator不变，确保评估始终从发起方角度计算
        const nextMaximizing = nextPlayer === searchInitiator;
        const result = alphaBeta(nextBoard, d - 1, alpha, beta, nextMaximizing, nextPlayer, searchDepth, searchInitiator, gameStage);
        if (result.value > maxEval) {
          maxEval = result.value;
          bestMove = move;
          bestMoveSequence = [move, ...result.moveSequence];
        }
        alpha = Math.max(alpha, result.value);
        if (beta <= alpha) {
            // 统计剪枝
            if (!perfStats.cutoffs[d]) perfStats.cutoffs[d] = 0;
            perfStats.cutoffs[d]++;
            break;
        }
      }
      /*
      // 存储到置换表
      const hash = zobristHasher.hash(b);
      let flag;
      if (maxEval <= alpha) {
        flag = 'upperbound';
      } else if (maxEval >= beta) {
        flag = 'lowerbound';
      } else {
        flag = 'exact';
      }
      transpositionTable.store(hash, d, maxEval, flag, bestMove);
      */
      return { value: maxEval, moveSequence: bestMoveSequence };
    } else {
      let minEval = Infinity;
      let bestMove = null;
      let bestMoveSequence = [];
      for (const move of moves) {
        const nextBoard = b.map(row => [...row]);
        nextBoard[move.to.r][move.to.c] = nextBoard[move.from.r][move.from.c];
        nextBoard[move.from.r][move.from.c] = null;
        // 下一个行棋的玩家是当前玩家的对手
        const nextPlayer = currentPlayer === 'red' ? 'black' : 'red';
        // 递归调用时保持searchInitiator不变，确保评估始终从发起方角度计算
        const nextMaximizing = nextPlayer === searchInitiator;
        const result = alphaBeta(nextBoard, d - 1, alpha, beta, nextMaximizing, nextPlayer, searchDepth, searchInitiator, gameStage);
        if (result.value < minEval) {
          minEval = result.value;
          bestMove = move;
          bestMoveSequence = [move, ...result.moveSequence];
        }
        beta = Math.min(beta, result.value);
        if (beta <= alpha) {
            // 统计剪枝
            if (!perfStats.cutoffs[d]) perfStats.cutoffs[d] = 0;
            perfStats.cutoffs[d]++;
            break;
        }
      }
      /*
      // 存储到置换表
      const hash = zobristHasher.hash(b);
      let flag;
      if (minEval <= alpha) {
        flag = 'upperbound';
      } else if (minEval >= beta) {
        flag = 'lowerbound';
      } else {
        flag = 'exact';
      }
      transpositionTable.store(hash, d, minEval, flag, bestMove);
      */
      return { value: minEval, moveSequence: bestMoveSequence };
    }
};

const getBestMove = (board, turn, depth = 4, randomness = 0, ply = 0, enableTimeLimit = false) => {
  let bestMove = null;
  let secondBestMove = null;
  let rootMoves = [];
  let bestMoveSequence = [];

  // First try to get move from opening book
  const bookMove = openingBook.getBookMove(board, ply);
  
  if (bookMove) {
    // Check if bookMove is valid for current board
    if (bookMove.from && bookMove.to && 
        typeof bookMove.from.r === 'number' && typeof bookMove.from.c === 'number' &&
        typeof bookMove.to.r === 'number' && typeof bookMove.to.c === 'number') {
      
      const movingPiece = board[bookMove.from.r][bookMove.from.c];
      
      if (movingPiece && movingPiece.color === turn) {
        // Verify move is valid
        const validDestinations = getValidMoves(board, bookMove.from);
        const isValid = validDestinations.some(dest => dest.r === bookMove.to.r && dest.c === bookMove.to.c);
        
        if (isValid) {
          return { bestMove: bookMove, secondBestMove: null, moveSequence: [], secondMoveSequence: [], bestMoveScore: 0, secondBestMoveScore: 0, allMovesWithScores: [] };
        }
      }
    }
  }

  // 使用迭代加深搜索获取最优走法
  //console.log(`开始迭代加深搜索，深度: ${depth}`);
  const { bestMove: idBestMove, secondBestMove: idSecondBestMove, rootMoves: idRootMoves, searchTime, moveSequence: idMoveSequence, secondMoveSequence: idSecondMoveSequence } = iterativeDeepening(board, turn, depth, 5000, enableTimeLimit);
  
  // 初始化rootMoves
  rootMoves = idRootMoves;
  //console.log(`迭代加深搜索完成，返回的bestMove: ${JSON.stringify(idBestMove)}, secondBestMove: ${JSON.stringify(idSecondBestMove)}, rootMoves数量: ${rootMoves.length}`);

  // 从rootMoves中获取最优走法和次优走法
  bestMove = idBestMove;
  secondBestMove = idSecondBestMove;
  bestMoveSequence = idMoveSequence;
  secondMoveSequence = idSecondMoveSequence;

  // 获取最优和次优着法的净胜分
  let bestMoveScore = 0;
  let secondBestMoveScore = 0;
  if (rootMoves.length > 0) {
    bestMoveScore = rootMoves[0].score;
  }
  if (rootMoves.length > 1) {
    secondBestMoveScore = rootMoves[1].score;
  }
  
  // 返回所有着法的分数信息（用于Analysis功能）
  const allMovesWithScores = rootMoves.map(moveInfo => ({
    // 提取moveInfo中的move属性
    move: {
      from: moveInfo.from,
      to: moveInfo.to
    },
    score: moveInfo.score,
    moveSequence: moveInfo.moveSequence || []
  }));
  
  return { bestMove, secondBestMove, moveSequence: bestMoveSequence, secondMoveSequence, bestMoveScore, secondBestMoveScore, allMovesWithScores };
};

// --- WORKER LISTENER (统一消息处理) ---
