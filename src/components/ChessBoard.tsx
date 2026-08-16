
import React, { useEffect, useRef, useState } from 'react';
import { Board, Color, Move, Position, PieceType } from '../domain/types';
import { Skin, PieceMaterial } from '../ui/types';
import { ChessPiece } from './ChessPiece';
import { BoardStaticLayer, toBoardSVG } from './BoardStaticLayer';

interface ChessBoardProps {
  board: Board;
  onSelect: (pos: Position) => void;
  onMove: (to: Position) => void;
  onRightClick?: (pos: Position) => void;
  selectedPos: Position | null;
  validMoves: Position[];
  turn: Color;
  lastMove: Move | null;
  hintMove: Move | null;
  flip?: boolean;
  isSetupMode?: boolean;
  skin?: Skin;
  material?: PieceMaterial;
  playerColor?: Color; // 添加玩家颜色属性
  boardBgColor?: string; // 自定义棋盘背景颜色
  boardLineColor?: string; // 自定义棋盘线条颜色
  coordinateStyle?: 'chinese' | 'western'; // 坐标系统样式
  onDragStart?: (e: React.DragEvent, pos: Position) => void;
  onDrop?: (e: React.DragEvent, pos: Position) => void;
  pieceRelations?: {
    threat: Position[]; // 当前棋子威胁的敌方棋子位置
    threatenedBy: Position[]; // 威胁当前棋子的敌方棋子位置
    guard: Position[]; // 当前棋子保护的友方棋子位置
    guardedBy: Position[]; // 保护当前棋子的友方棋子位置
    control?: Position[]; // 当前棋子控制的位置
    controllers?: Position[]; // 控制当前位置的棋子位置
  };
  moveAnimation?: {
    from: Position;
    to: Position;
    id: number;
    piece: any; // 保存起始位置的棋子信息
  } | null;
  // 棋子评估值
  pieceEval?: {
    material: number;
    position: number;
    mobility: number;
    threat: number;
    safety: number;
  } | null;
  // 是否处于将军状态
  isCheck?: boolean;
  // 隐藏最优着法（红色实线箭头）
  hiddenBestMove?: Move | null;
  // 次优着法（红色虚线箭头）
  suboptimalMove?: Move | null;
}

export const CELL_SIZE = 50;
export const BOARD_OFFSET = 50; // Exported for App animation calculation
const WIDTH = CELL_SIZE * 8 + BOARD_OFFSET * 2;
const HEIGHT = CELL_SIZE * 9 + BOARD_OFFSET * 2;

export const SKINS: Record<Skin, { 
    boardBg: string, 
    containerBg: string, 
    border: string, 
    grid: string, 
    coord: string, 
    river: string, 
    texture?: string 
}> = {
    'stone-board': {
        boardBg: "#f0f0f0",
        containerBg: "#d0d0d0",
        border: "#a0a0a0",
        grid: "#808080",
        coord: "#606060",
        river: "#707070",
        texture: "stone"
    },
    'wood-board': {
        boardBg: "#5B4B00",
        containerBg: "#654321",
        border: "#3d2817",
        grid: "#DAA520",
        coord: "#DAA520",
        river: "#DAA520",
        texture: "wood"
    },

    'paper-board': {
        boardBg: "#D8C9A8",
        containerBg: "#D8C9A8",
        border: "#8B6B42",
        grid: "#005AB5",
        coord: "#005AB5",
        river: "#005AB5",
        texture: "paper"
    },
    'glass-board': {
        boardBg: "#70DBDB",
        containerBg: "#70DBDB",
        border: "#70DBDB",
        grid: "#589362",
        coord: "#589362",
        river: "#589362",
        texture: "glass"
    }
};

export const ChessBoard: React.FC<ChessBoardProps> = React.memo(({ 
    board, onSelect, onMove, onRightClick, selectedPos, validMoves, turn, lastMove, hintMove, flip = false,
    isSetupMode = false, skin = 'wood-board', material = 'wood', playerColor = 'red', 
    boardBgColor, boardLineColor, coordinateStyle = 'chinese', onDragStart, onDrop, pieceRelations, moveAnimation, pieceEval, isCheck = false,
    hiddenBestMove = null, suboptimalMove = null
}) => {

  // 添加CSS动画样式到文档头部 - 只在组件挂载时执行一次
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      /* 直接使用内联样式控制动画，简化CSS */
      .chess-move-element {
        position: absolute;
        width: 50px;
        height: 50px;
        z-index: 1000;
        pointer-events: none;
      }
      
      /* 选中棋子的放大高亮效果 */
      .selected-piece {
        transform: scale(1.15);
        transform-origin: center;
        transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        filter: drop-shadow(0 0 10px rgba(255, 255, 0, 0.8));
        z-index: 20;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // 手机窄屏：按容器宽度等比缩小整盘（含行棋动画坐标系），避免边线棋子被裁成一半
  const boardViewportRef = useRef<HTMLDivElement>(null);
  const moveAnimElRef = useRef<HTMLDivElement>(null);
  const [boardScale, setBoardScale] = useState(1);

  useEffect(() => {
    const el = boardViewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const updateScale = () => {
      const style = window.getComputedStyle(el);
      const padX =
        (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      // clientWidth 含 padding；棋盘可用宽度需扣除，否则描边仍可能顶满裁切
      const available = el.clientWidth - padX;
      if (available <= 0) return;
      setBoardScale(Math.min(1, available / WIDTH));
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const currentSkin = SKINS[skin] || SKINS['wood-board']; // 保护机制，使用默认皮肤
  // 使用自定义颜色或皮肤颜色
  const bgColor = boardBgColor || currentSkin.boardBg;
  const lineColor = boardLineColor || currentSkin.grid;

  const toSVG = (r: number, c: number) => toBoardSVG(r, c, flip);

  // 行棋位移动画：必须等首帧画在起点后再改 transform，否则手机会「先瞬移到终点→退回→再播」
  useEffect(() => {
    const el = moveAnimElRef.current;
    if (!el || !moveAnimation) return;

    const from = toSVG(moveAnimation.from.r, moveAnimation.from.c);
    const to = toSVG(moveAnimation.to.r, moveAnimation.to.c);
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;

    let raf2 = 0;
    el.style.transition = 'none';
    el.style.transform = 'translate(0px, 0px)';

    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveAnimation?.id, flip]);

  const handleClick = (r: number, c: number) => {
    if (isSetupMode) {
      // Setup模式下，调用onSelect来显示棋子分数和关系信息
      onSelect({ r, c });
      return;
    }
    if (validMoves.some(vm => vm.r === r && vm.c === c)) {
      onMove({ r, c });
      return;
    }
    // 无论是点击有棋子的位置还是空位置，都调用onSelect
    // 点击空位置时，用于显示该位置的控制者
    onSelect({ r, c });
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (isSetupMode) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }
  };

  const renderIndicators = () => {
    const indicators = [];
    if (hintMove && !isSetupMode) {
            const from = toSVG(hintMove.from.r, hintMove.from.c);
            const to = toSVG(hintMove.to.r, hintMove.to.c);
            indicators.push(<line key="hint-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#ef4444" strokeWidth="3" opacity="0.8" className="animate-pulse" markerEnd="url(#arrowhead)" />);
            indicators.push(<circle key="hint-target" cx={to.x} cy={to.y} r={18} fill="none" stroke="#ef4444" strokeWidth="3" className="animate-pulse" opacity="1" />);
            indicators.push(<circle key="hint-target-outer" cx={to.x} cy={to.y} r={24} fill="none" stroke="#ef4444" strokeWidth="2" opacity="0.8" />);
        }
        if (lastMove && !isSetupMode) {
            const from = toSVG(lastMove.from.r, lastMove.from.c);
            const to = toSVG(lastMove.to.r, lastMove.to.c);
            // 添加从起始位置到终止位置的蓝色实线，带箭头
            indicators.push(<line key="lm-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#3b82f6" strokeWidth="3" opacity="0.6" pointerEvents="none" markerEnd="url(#arrowhead-blue)" />);
        // 起始位置：蓝色填充 + 双层圆圈（实线）
        indicators.push(<circle key="lm-from-fill" cx={from.x} cy={from.y} r={18} fill="rgba(59, 130, 246, 0.3)" pointerEvents="none" />);
        indicators.push(<circle key="lm-from-inner" cx={from.x} cy={from.y} r={18} fill="none" stroke="#3b82f6" strokeWidth="3" opacity="0.8" pointerEvents="none" />);
        indicators.push(<circle key="lm-from-outer" cx={from.x} cy={from.y} r={24} fill="none" stroke="#3b82f6" strokeWidth="2" opacity="0.6" pointerEvents="none" />);
        // 终止位置：蓝色填充 + 双层圆圈（实线）
        indicators.push(<circle key="lm-to-fill" cx={to.x} cy={to.y} r={18} fill="rgba(59, 130, 246, 0.3)" pointerEvents="none" />);
        indicators.push(<circle key="lm-to-inner" cx={to.x} cy={to.y} r={18} fill="none" stroke="#3b82f6" strokeWidth="3" opacity="0.8" pointerEvents="none" />);
        indicators.push(<circle key="lm-to-outer" cx={to.x} cy={to.y} r={24} fill="none" stroke="#3b82f6" strokeWidth="2" opacity="0.6" pointerEvents="none" />);
    }
    if (selectedPos) {
        const { x, y } = toSVG(selectedPos.r, selectedPos.c);
        // 静态选框：避免 animate-pulse 持续重绘带动 glass/棋子滤镜
        indicators.push(<rect key="selected" x={x - CELL_SIZE/2 + 1} y={y - CELL_SIZE/2 + 1} width={CELL_SIZE - 2} height={CELL_SIZE - 2} fill="none" stroke="#22c55e" strokeWidth="3" rx={4} pointerEvents="none" />);
        
        // 渲染棋子评估值提示框
        if (pieceEval) {
            // 计算提示框位置：
            // 1. 提示框中心位于棋子中心和棋盘中心的连线上
            // 2. 离棋子更近一些
            const centerX = WIDTH / 2;
            const centerY = HEIGHT / 2;
            const dx = centerX - x;
            const dy = centerY - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            let tooltipCenterX, tooltipCenterY;
            
            if (dist === 0) {
                // 棋子位于棋盘中心，默认将提示框放在上方
                tooltipCenterX = x;
                tooltipCenterY = y - 100;
            } else {
                // 单位向量，指向棋盘中心
                const nx = dx / dist;
                const ny = dy / dist;
                // 提示框中心距离棋子中心的距离（调整此值可控制提示框与棋子的远近）
                const distanceFromPiece = 80;
                tooltipCenterX = x + nx * distanceFromPiece;
                tooltipCenterY = y + ny * distanceFromPiece;
            }
            
            // 计算提示框左上角坐标（提示框大小为160x130）
            let tooltipX = tooltipCenterX - 80;
            let tooltipY = tooltipCenterY - 65;
            
            // 确保提示框在棋盘范围内
            tooltipX = Math.max(10, Math.min(tooltipX, WIDTH - 170));
            tooltipY = Math.max(10, Math.min(tooltipY, HEIGHT - 140));
            
            indicators.push(
                <g key="piece-eval-tooltip" pointerEvents="none" style={{ zIndex: 1000 }}>
                    {/* 半透明背景 - 更透明一些 */}
                    <rect 
                        x={tooltipX} 
                        y={tooltipY} 
                        width={160} 
                        height={130} 
                        rx={8} 
                        fill="rgba(17, 24, 39, 0.8)" 
                        stroke="#4b5563" 
                        strokeWidth="1" 
                        opacity="0.8"
                    />
                    {/* 评估值列表 - 去掉标题和分隔线 */}
                    {/* Material */}
                    <text 
                        x={tooltipX + 20} 
                        y={tooltipY + 35} 
                        textAnchor="start" 
                        fill="#d1d5db" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        Material:
                    </text>
                    <text 
                        x={tooltipX + 145} 
                        y={tooltipY + 35} 
                        textAnchor="end" 
                        fill="#60a5fa" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        {pieceEval.material.toFixed(2)}
                    </text>
                    
                    {/* Position */}
                    <text 
                        x={tooltipX + 20} 
                        y={tooltipY + 53} 
                        textAnchor="start" 
                        fill="#d1d5db" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        Position:
                    </text>
                    <text 
                        x={tooltipX + 145} 
                        y={tooltipY + 53} 
                        textAnchor="end" 
                        fill="#34d399" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        {pieceEval.position.toFixed(2)}
                    </text>
                    
                    {/* Mobility */}
                    <text 
                        x={tooltipX + 20} 
                        y={tooltipY + 71} 
                        textAnchor="start" 
                        fill="#d1d5db" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        Mobility:
                    </text>
                    <text 
                        x={tooltipX + 145} 
                        y={tooltipY + 71} 
                        textAnchor="end" 
                        fill="#fbbf24" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        {pieceEval.mobility.toFixed(2)}
                    </text>
                    
                    {/* Threat */}
                    <text 
                        x={tooltipX + 20} 
                        y={tooltipY + 89} 
                        textAnchor="start" 
                        fill="#d1d5db" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        Threat:
                    </text>
                    <text 
                        x={tooltipX + 145} 
                        y={tooltipY + 89} 
                        textAnchor="end" 
                        fill="#f87171" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        {pieceEval.threat.toFixed(2)}
                    </text>
                    
                    {/* Safety */}
                    <text 
                        x={tooltipX + 20} 
                        y={tooltipY + 107} 
                        textAnchor="start" 
                        fill="#d1d5db" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        Safety:
                    </text>
                    <text 
                        x={tooltipX + 145} 
                        y={tooltipY + 107} 
                        textAnchor="end" 
                        fill="#a78bfa" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        {pieceEval.safety.toFixed(2)}
                    </text>
                    
                </g>
            );
        }
    }
    if (!isSetupMode) {
        validMoves.forEach(vm => {
            const { x, y } = toSVG(vm.r, vm.c);
            const isCapture = board[vm.r][vm.c] !== null;
            indicators.push(<circle key={`vm-${vm.r}-${vm.c}`} cx={x} cy={y} r={isCapture ? 12 : 6} fill={isCapture ? "rgba(255, 0, 0, 0.4)" : "rgba(0, 128, 0, 0.4)"} stroke={isCapture ? "rgba(255,0,0,0.6)" : "none"} strokeWidth={isCapture ? 2 : 0} pointerEvents="none" />);
        });
    }
    
    // 渲染棋子关系指示器
    if (pieceRelations) {
        // 判断当前是点击棋子还是空位置
        // 点击棋子时会有威胁或保护关系或控制关系，点击空位置时只有控制器关系
        const hasPieceRelations = pieceRelations.threat.length > 0 || 
                                  pieceRelations.threatenedBy.length > 0 || 
                                  pieceRelations.guard.length > 0 || 
                                  pieceRelations.guardedBy.length > 0 ||
                                  (pieceRelations.control && pieceRelations.control.length > 0);
        const isPieceClick = hasPieceRelations;
        
        // 点击棋子时，显示该棋子的威胁、保护和控制关系
        if (isPieceClick) {
            // 红色：当前棋子威胁的敌方棋子（威胁者）
            pieceRelations.threat.forEach(pos => {
                const { x, y } = toSVG(pos.r, pos.c);
                indicators.push(<rect key={`threat-${pos.r}-${pos.c}`} x={x - CELL_SIZE/2} y={y - CELL_SIZE/2} width={CELL_SIZE} height={CELL_SIZE} fill="rgba(239, 68, 68, 0.4)" stroke="#ef4444" strokeWidth="4" opacity="0.8" pointerEvents="none" />);
            });
            
            // 黄色：威胁当前棋子的敌方棋子（被威胁者）
            pieceRelations.threatenedBy.forEach(pos => {
                const { x, y } = toSVG(pos.r, pos.c);
                indicators.push(<rect key={`threatenedBy-${pos.r}-${pos.c}`} x={x - CELL_SIZE/2} y={y - CELL_SIZE/2} width={CELL_SIZE} height={CELL_SIZE} fill="rgba(234, 179, 8, 0.4)" stroke="#eab308" strokeWidth="4" opacity="0.8" pointerEvents="none" />);
            });
            
            // 绿色：当前棋子保护的友方棋子（保护者）
            pieceRelations.guard.forEach(pos => {
                const { x, y } = toSVG(pos.r, pos.c);
                indicators.push(<rect key={`guard-${pos.r}-${pos.c}`} x={x - CELL_SIZE/2} y={y - CELL_SIZE/2} width={CELL_SIZE} height={CELL_SIZE} fill="rgba(34, 197, 94, 0.4)" stroke="#22c55e" strokeWidth="4" opacity="0.8" pointerEvents="none" />);
            });
            
            // 蓝色：保护当前棋子的友方棋子（被保护者）
            pieceRelations.guardedBy.forEach(pos => {
                const { x, y } = toSVG(pos.r, pos.c);
                indicators.push(<rect key={`guardedBy-${pos.r}-${pos.c}`} x={x - CELL_SIZE/2} y={y - CELL_SIZE/2} width={CELL_SIZE} height={CELL_SIZE} fill="rgba(59, 130, 246, 0.4)" stroke="#3b82f6" strokeWidth="4" opacity="0.8" pointerEvents="none" />);
            });
            
            // 紫色：当前棋子控制的位置（等边菱形）
            if (pieceRelations.control) {
                pieceRelations.control.forEach(pos => {
                    const { x, y } = toSVG(pos.r, pos.c);
                    // 菱形的对角线长度
                    const diagonal = CELL_SIZE / 2;
                    // 四个顶点的坐标（等边菱形）
                    const points = [
                        `${x},${y - diagonal / 2}`,  // 顶部顶点
                        `${x + diagonal / 2},${y}`,  // 右侧顶点
                        `${x},${y + diagonal / 2}`,  // 底部顶点
                        `${x - diagonal / 2},${y}`   // 左侧顶点
                    ].join(' ');
                    indicators.push(<polygon key={`control-${pos.r}-${pos.c}`} points={points} fill="rgba(168, 85, 247, 0.6)" stroke="#a855f7" strokeWidth="2" opacity="0.8" pointerEvents="none" />);
                });
            }
        } 
        // 点击空位置时，只显示控制该位置的棋子
        else if (pieceRelations.controllers && pieceRelations.controllers.length > 0) {
            // 粉色：当前位置的控制者（高亮显示控制该位置的棋子）
            pieceRelations.controllers.forEach(pos => {
                const { x, y } = toSVG(pos.r, pos.c);
                indicators.push(<rect key={`controller-${pos.r}-${pos.c}`} x={x - CELL_SIZE/2} y={y - CELL_SIZE/2} width={CELL_SIZE} height={CELL_SIZE} fill="rgba(244, 114, 182, 0.4)" stroke="#f472b6" strokeWidth="4" opacity="0.8" pointerEvents="none" />);
            });
        }
    }
    
    // 渲染隐藏最优着法（红色实线箭头）
    if (hiddenBestMove && !isSetupMode) {
        const from = toSVG(hiddenBestMove.from.r, hiddenBestMove.from.c);
        const to = toSVG(hiddenBestMove.to.r, hiddenBestMove.to.c);
        indicators.push(<line key="hidden-best-move" x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#ef4444" strokeWidth="3" opacity="0.8" pointerEvents="none" markerEnd="url(#arrowhead)" />);
    }
    
    // 渲染次优着法（红色虚线箭头）
    if (suboptimalMove && !isSetupMode) {
        const from = toSVG(suboptimalMove.from.r, suboptimalMove.from.c);
        const to = toSVG(suboptimalMove.to.r, suboptimalMove.to.c);
        indicators.push(<line key="suboptimal-move" x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#ef4444" strokeWidth="3" strokeDasharray="5,5" opacity="0.8" pointerEvents="none" markerEnd="url(#arrowhead-dashed-red)" />);
    }
    
    return indicators;
  }

  const renderPieces = () => {
    const pieces = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const piece = board[r][c];
        const { x, y } = toSVG(r, c);
        
        // Click/Drag Zones (Transparent Rect for easier interaction)
        const interactRect = (
             <rect 
                key={`interact-${r}-${c}`} 
                x={x - CELL_SIZE/2} 
                y={y - CELL_SIZE/2} 
                width={CELL_SIZE} 
                height={CELL_SIZE} 
                fill="transparent" 
                onClick={(e) => { e.stopPropagation(); handleClick(r, c); }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    if (isSetupMode && onRightClick) {
                        onRightClick({r, c});
                    }
                }}
                onDragOver={handleDragOver}
                onDrop={(e) => isSetupMode && onDrop && onDrop(e, {r, c})}
             />
        );

        if (piece) {
          // 判断是否是选中的棋子
          const isSelected = selectedPos && selectedPos.r === r && selectedPos.c === c;
          
          // 判断是否是正在移动的棋子
          const isMovingFrom = moveAnimation && moveAnimation.from.r === r && moveAnimation.from.c === c;
          const isMovingTo = moveAnimation && moveAnimation.to.r === r && moveAnimation.to.c === c;
          const isMoving = isMovingFrom || isMovingTo;
          
          // 计算选中状态下的缩放比例
          const scale = isSelected ? 1.15 : 1;
          
          // 计算移动动画的偏移量
          let translateX = 0;
          let translateY = 0;
          let animationTransition = 'transform 0.3s linear';
          
          // 动画期间棋盘已是新局面：目标格有子但由浮层棋子播放位移，故隐藏目标格实体子
          const shouldHide = !!(moveAnimation && isMovingTo);
          
          // 计算最终的变换矩阵：先平移到正确位置，再缩放
          const transform = `translate(${x}, ${y}) scale(${scale})`;
          
          // 检测当前棋子是否是被将军的将/帅
          // 当isCheck为true，且棋子是将/帅，且颜色与当前turn颜色相同时，该将/帅处于被将军状态
          const isGeneral = piece.type === 'general';
          const isInCheck = isGeneral && isCheck && piece.color === turn;
          
          // 正常渲染所有棋子
          pieces.push(
            <g 
              key={`p-${r}-${c}`}
              transform={transform}
              onClick={(e) => { e.stopPropagation(); handleClick(r, c); }}
              onContextMenu={(e) => {
                  e.preventDefault();
                  if (isSetupMode && onRightClick) {
                      onRightClick({r, c});
                  }
              }}
              className={`${isSetupMode ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
              style={{
                  zIndex: isSelected ? 20 : isMoving ? 15 : 1,
                  // 被将闪动时不要挂 CSS transition:transform，否则会冲掉子节点的 shake
                  // 选中态避免额外 CSS drop-shadow（整盘 SVG 重滤镜很贵），用绿色选框提示即可
                  transition: isInCheck || isSelected ? undefined : animationTransition,
                  transformOrigin: 'center',
                  transformBox: 'fill-box', // 确保变换原点相对于元素本身计算
                  filter: 'url(#dropShadow)',
                  opacity: shouldHide ? 0 : 1 // 隐藏动画期间目标位置的棋子
              }}
              {...({ draggable: isSetupMode } as any)}
                onDragStart={(e) => isSetupMode && onDragStart && onDragStart(e, {r, c})}
                onDragOver={handleDragOver}
                onDrop={(e) => isSetupMode && onDrop && onDrop(e, {r, c})}
            >
              <ChessPiece 
                type={piece.type} 
                color={piece.color} 
                size={50} 
                material={material} 
                playerColor={playerColor} 
                isInCheck={isInCheck}
              />
            </g>
          );
        } else {
           pieces.push(interactRect);
        }
      }
    }
    
    return pieces;
  };

  const frameBorderColor = isSetupMode ? '#0f766e' : currentSkin.border;

  return (
    // 左右各留 6px，避免描边 box-shadow 在窄屏被 overflow-x 裁切
    <div ref={boardViewportRef} className="w-full max-w-[512px] mx-auto px-[6px] box-border">
      <div
        className="relative mx-auto"
        style={{
          width: WIDTH * boardScale,
          height: HEIGHT * boardScale,
        }}
      >
      <div
        className="relative rounded-lg transition-colors duration-300"
        style={{
            width: WIDTH,
            height: HEIGHT,
            backgroundColor: currentSkin.containerBg,
            // 用 box-shadow 描边，避免 border 增加布局宽度导致手机端更易裁切
            boxShadow: `0 0 0 6px ${frameBorderColor}, 0 25px 50px -12px rgba(0,0,0,0.35)`,
            transform: `scale(${boardScale})`,
            transformOrigin: 'top left',
            // 选中放大 / 阴影允许溢出描边，不再 overflow:hidden 裁棋子
            overflow: 'visible',
        }}
      >
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block"
        style={{ background: bgColor, overflow: 'visible' }}
      >
        <defs>
            {/* 箭头标记定义 */}
            <marker
                id="arrowhead"
                markerWidth="6"
                markerHeight="6"
                refX="4"
                refY="2"
                orient="auto"
                markerUnits="strokeWidth"
            >
                <polygon points="0 0, 5 2, 0 4" fill="#ef4444" stroke="#ef4444" strokeWidth="1" />
            </marker>
            
            <marker
                id="arrowhead-blue"
                markerWidth="6"
                markerHeight="6"
                refX="4"
                refY="2"
                orient="auto"
                markerUnits="strokeWidth"
            >
                <polygon points="0 0, 5 2, 0 4" fill="#3b82f6" stroke="#3b82f6" strokeWidth="1" />
            </marker>
            
            {/* 红色虚线箭头标记 - 用于次优着法 */}
            <marker
                id="arrowhead-dashed-red"
                markerWidth="6"
                markerHeight="6"
                refX="4"
                refY="2"
                orient="auto"
                markerUnits="strokeWidth"
            >
                <polygon points="0 0, 5 2, 0 4" fill="#ef4444" stroke="#ef4444" strokeWidth="1" />
            </marker>
            
            <radialGradient id="pieceGradient" cx="30%" cy="30%" r="70%" fx="40%" fy="40%">
                <stop offset="0%" stopColor="#ffecd2" />
                <stop offset="100%" stopColor="#e0c090" />
            </radialGradient>
            <filter id="dropShadow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
                <feOffset dx="2" dy="3" result="offsetblur" />
                <feComponentTransfer><feFuncA type="linear" slope="0.3" /></feComponentTransfer>
                <feMerge><feMergeNode in="offsetblur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            
        </defs>
        <BoardStaticLayer
          flip={flip}
          coordinateStyle={coordinateStyle}
          bgColor={bgColor}
          lineColor={lineColor}
          coordColor={currentSkin.coord}
          riverColor={currentSkin.river}
          texture={!boardBgColor ? currentSkin.texture : undefined}
        />
        {renderPieces()}
        {renderIndicators()}
      </svg>
      
      {/* 行棋动画层：起点定位 + useEffect 双 rAF 后再 transition 到终点 */}
      {moveAnimation && moveAnimation.piece && (
        <div
          key={`anim-${moveAnimation.id}`}
          ref={moveAnimElRef}
          className="chess-move-element"
          style={{
            left: `${toSVG(moveAnimation.from.r, moveAnimation.from.c).x - CELL_SIZE / 2}px`,
            top: `${toSVG(moveAnimation.from.r, moveAnimation.from.c).y - CELL_SIZE / 2}px`,
            position: 'absolute',
            width: `${CELL_SIZE}px`,
            height: `${CELL_SIZE}px`,
            zIndex: 1000,
            pointerEvents: 'none',
            transform: 'translate(0px, 0px)',
            transformOrigin: 'center',
          }}
        >
          <svg width={CELL_SIZE} height={CELL_SIZE} viewBox="0 0 50 50" style={{ overflow: 'visible' }}>
            <g transform="translate(25, 25)">
              <ChessPiece 
                type={moveAnimation.piece.type} 
                color={moveAnimation.piece.color} 
                size={50} 
                material={material} 
                playerColor={playerColor} 
              />
            </g>
          </svg>
        </div>
      )}
    </div>
      </div>
    </div>
  );
});
