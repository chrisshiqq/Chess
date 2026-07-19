
import React, { useEffect } from 'react';
import { Board, Color, Move, Position, PieceType, Skin, PieceMaterial } from '../types';
import { ChessPiece } from './ChessPiece';

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
    tactic: number;
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

const CHINESE_NUMS = ["九","八","七","六","五","四","三","二","一"];
const ARABIC_NUMS = ["1","2","3","4","5","6","7","8","9"];
//const WESTERN_LETTERS = ["a","b","c","d","e","f","g","h","i"];
const WESTERN_LETTERS = ["0","1","2","3","4","5","6","7","8"];
const WESTERN_NUMBERS = ["0","1","2","3","4","5","6","7","8","9"];

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
        grid: "#116de5ff",
        coord: "#116de5ff",
        river: "#116de5ff",
        texture: "glass"
    }
};

export const ChessBoard: React.FC<ChessBoardProps> = ({ 
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

  const currentSkin = SKINS[skin] || SKINS['wood-board']; // 保护机制，使用默认皮肤
  // 使用自定义颜色或皮肤颜色
  const bgColor = boardBgColor || currentSkin.boardBg;
  const lineColor = boardLineColor || currentSkin.grid;

  // Helper to convert logic coords to SVG coords
  // 修复：实现完整的垂直和水平镜像，当flip为true时
  const toSVG = (r: number, c: number) => ({
    x: (flip ? (8 - c) : c) * CELL_SIZE + BOARD_OFFSET,
    y: (flip ? r : (9 - r)) * CELL_SIZE + BOARD_OFFSET
  });

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

  const renderCoordinates = () => {
      const coords = [];
      
      if (coordinateStyle === 'chinese') {
        // 中式坐标系统
        // 修复：中文数字跟着红色棋子，阿拉伯数字跟着黑色棋子
        for (let c = 0; c < 9; c++) {
          // 中文数字（红方）：跟随红棋位置
          const redPos = toSVG(0, c);
          coords.push(
              <text 
                  key={`coord-red-${c}`} 
                  x={redPos.x} 
                  y={flip ? redPos.y - 35 : redPos.y + 30} 
                  textAnchor="middle" 
                  fontSize="18" 
                  fill={currentSkin.coord} 
                  fontWeight="bold" 
                  fontFamily="serif"
              >
                  {CHINESE_NUMS[c]}
              </text>
          );

          // 阿拉伯数字（黑方）：跟随黑棋位置
          const blackPos = toSVG(9, c);
          coords.push(
              <text 
                  key={`coord-black-${c}`} 
                  x={blackPos.x} 
                  y={flip ? blackPos.y + 30 : blackPos.y - 35} 
                  textAnchor="middle" 
                  fontSize="16" 
                  fill={currentSkin.coord} 
                  fontWeight="bold"
              >
                  {ARABIC_NUMS[c]}
              </text>
          );
        }
      } else {
        // 西式坐标系统 - 始终以红方视角为基准
        // 红方左下角始终显示a0，右上角始终显示i9
        // 无论棋盘是否翻转，坐标系统保持不变且始终显示在棋盘外部
        
        // 计算固定位置，确保坐标始终显示在棋盘外部
        // 不使用toSVG的翻转逻辑，而是自己计算位置
        const calculateFixedPosition = (r: number, c: number, type: 'top' | 'bottom' | 'left' | 'right') => {
          // 基础坐标计算，不考虑flip
          const baseX = BOARD_OFFSET;
          const baseY = BOARD_OFFSET;
          
          // 计算实际显示的行列（考虑flip）
          const displayR = flip ? 9 - r : r;
          const displayC = flip ? 8 - c : c;
          
          // 计算坐标中心点
          const centerX = baseX + displayC * CELL_SIZE;
          const centerY = baseY + displayR * CELL_SIZE;
          
          // 根据类型调整位置，确保显示在棋盘外部
          switch (type) {
            case 'top':
              return { x: centerX, y: baseY - 30 };
            case 'bottom':
              return { x: centerX, y: baseY + 9 * CELL_SIZE + 35 };
            case 'left':
              return { x: baseX - 30, y: centerY + 8 };
            case 'right':
              return { x: baseX + 8 * CELL_SIZE + 30, y: centerY + 8 };
            default:
              return { x: centerX, y: centerY };
          }
        };
        
        // 横向字母坐标 (A-I)
        // 始终以红方视角为基准，左侧A，右侧I
        for (let c = 0; c < 9; c++) {
          // 红方视角的列：0=A, 1=B, ..., 8=I
          
          // 底部坐标（红方侧）- 固定显示在棋盘底部外部
          const bottomPos = calculateFixedPosition(9, c, 'bottom');
          coords.push(
              <text 
                  key={`coord-bottom-${c}`} 
                  x={bottomPos.x} 
                  y={bottomPos.y} 
                  textAnchor="middle" 
                  fontSize="16" 
                  fill={currentSkin.coord} 
                  fontWeight="bold"
              >
                  {WESTERN_LETTERS[c]}
              </text>
          );

          // 顶部坐标（黑方侧）- 固定显示在棋盘顶部外部
          const topPos = calculateFixedPosition(0, c, 'top');
          coords.push(
              <text 
                  key={`coord-top-${c}`} 
                  x={topPos.x} 
                  y={topPos.y} 
                  textAnchor="middle" 
                  fontSize="16" 
                  fill={currentSkin.coord} 
                  fontWeight="bold"
              >
                  {WESTERN_LETTERS[c]}
              </text>
          );
        }
        
        // 纵向数字坐标 (0-9)
        // 始终以红方视角为基准，下方0，上方9
        for (let r = 0; r < 10; r++) {
          // 红方视角的行：底部0，顶部9
          // 根据r计算红方视角的行号
          // r=9（红方侧底部）→ 0
          // r=0（黑方侧顶部）→ 9
          const redViewRow = 9 - r;
          
          // 左侧坐标 - 固定显示在棋盘左侧外部
          const leftPos = calculateFixedPosition(r, 0, 'left');
          coords.push(
              <text 
                  key={`coord-left-${r}`} 
                  x={leftPos.x} 
                  y={leftPos.y} 
                  textAnchor="middle" 
                  fontSize="16" 
                  fill={currentSkin.coord} 
                  fontWeight="bold"
              >
                  {WESTERN_NUMBERS[redViewRow]}
              </text>
          );

          // 右侧坐标 - 固定显示在棋盘右侧外部
          const rightPos = calculateFixedPosition(r, 8, 'right');
          coords.push(
              <text 
                  key={`coord-right-${r}`} 
                  x={rightPos.x} 
                  y={rightPos.y} 
                  textAnchor="middle" 
                  fontSize="16" 
                  fill={currentSkin.coord} 
                  fontWeight="bold"
              >
                  {WESTERN_NUMBERS[redViewRow]}
              </text>
          );
        }
      }
      
      return coords;
  }

  const renderRiverText = () => {
      // 分界线中心点
      const centerY = toSVG(4.5, 4).y;
      const centerX = toSVG(4.5, 4).x;
      
      // 字符横向间距（楚河和汉界两组文字之间的距离）
      const horizontalSpacing = 100;
      
      // 根据翻转状态决定哪边显示哪组文字
      const leftSide = flip ? '楚河' : '汉界';
      const rightSide = flip ? '汉界' : '楚河';
      
      // 文字颜色和样式 - 根据皮肤调整
      const textColor = currentSkin.river;
      // 宣纸棋盘使用毛笔字体和更粗的笔画
      const fontFamily = "serif";
      const fontSize = "32";
      const fontWeight = "bold";
      const textOpacity = "0.7";
      
      return (
        <>
            {/* 左侧文字 - 都向左旋转（逆时针90度） */}
            <text 
                x={centerX - horizontalSpacing - 10} 
                y={centerY} 
                textAnchor="middle" 
                fill={textColor} 
                opacity={textOpacity} 
                fontSize={fontSize} 
                fontWeight={fontWeight} 
                fontFamily={fontFamily} 
                style={currentSkin.texture === 'paper' ? {textShadow: '2px 2px 3px rgba(0,0,0,0.2)', stroke: textColor, strokeWidth: '0.5'} : {textShadow: 'none'}}
                transform={`rotate(-90, ${centerX - horizontalSpacing - 10}, ${centerY})`}
            >
                {leftSide === '楚河' ? '楚' : '漢'}
            </text>
            <text 
                x={centerX - horizontalSpacing + 25} 
                y={centerY} 
                textAnchor="middle" 
                fill={textColor} 
                opacity={textOpacity} 
                fontSize={fontSize} 
                fontWeight={fontWeight} 
                fontFamily={fontFamily} 
                style={currentSkin.texture === 'paper' ? {textShadow: '2px 2px 3px rgba(0,0,0,0.2)', stroke: textColor, strokeWidth: '0.5'} : {textShadow: 'none'}}
                transform={`rotate(-90, ${centerX - horizontalSpacing + 25}, ${centerY})`}
            >
                {leftSide === '楚河' ? '河' : '界'}
            </text>
            
            {/* 右侧文字 - 都向右旋转（顺时针90度） */}
            <text 
                x={centerX + horizontalSpacing - 25} 
                y={centerY} 
                textAnchor="middle" 
                fill={textColor} 
                opacity={textOpacity} 
                fontSize={fontSize} 
                fontWeight={fontWeight} 
                fontFamily={fontFamily} 
                style={currentSkin.texture === 'paper' ? {textShadow: '2px 2px 3px rgba(0,0,0,0.2)', stroke: textColor, strokeWidth: '0.5'} : {textShadow: 'none'}}
                transform={`rotate(90, ${centerX + horizontalSpacing - 25}, ${centerY})`}
            >
                {rightSide === '楚河' ? '河' : '界'}
            </text>
            <text 
                x={centerX + horizontalSpacing + 10} 
                y={centerY} 
                textAnchor="middle" 
                fill={textColor} 
                opacity={textOpacity} 
                fontSize={fontSize} 
                fontWeight={fontWeight} 
                fontFamily={fontFamily} 
                style={currentSkin.texture === 'paper' ? {textShadow: '2px 2px 3px rgba(0,0,0,0.2)', stroke: textColor, strokeWidth: '0.5'} : {textShadow: 'none'}}
                transform={`rotate(90, ${centerX + horizontalSpacing + 10}, ${centerY})`}
            >
                {rightSide === '楚河' ? '楚' : '漢'}
            </text>
        </>
      );
  };

  // 渲染炮位和兵位的特殊十字标记
  const renderPositionMarkers = (r: number, c: number) => {
    const markers = [];
    const { x, y } = toSVG(r, c);
    const markerSize = 6; // 十字标记的大小
    const offset = 4; // 距离交叉点的偏移
    
    // 判断是否在边界上，避免标记超出边界
    const hasTop = r > 0;
    const hasBottom = r < 9;
    const hasLeft = c > 0;
    const hasRight = c < 8;
    
    // 左上角
    if (hasTop && hasLeft) {
      // 向上的线条 - 如果不是棋盘顶部行则绘制
      if (r > 0) {
        markers.push(
          <line key={`marker-${r}-${c}-tl-v`} 
                x1={x - offset} y1={y - offset} 
                x2={x - offset} 
                y2={y - offset - markerSize} 
                stroke={lineColor} strokeWidth="2" />
        );
      }
      // 向左的线条 - 如果不是棋盘最左列则绘制
      if (c > 0) {
        markers.push(
          <line key={`marker-${r}-${c}-tl-h`} 
                x1={x - offset} y1={y - offset} 
                x2={x - offset - markerSize} 
                y2={y - offset} 
                stroke={lineColor} strokeWidth="2" />
        );
      }
    }
    
    // 右上角
    if (hasTop && hasRight) {
      // 向上的线条 - 如果不是棋盘顶部行则绘制
      if (r > 0) {
        markers.push(
          <line key={`marker-${r}-${c}-tr-v`} 
                x1={x + offset} y1={y - offset} 
                x2={x + offset} 
                y2={y - offset - markerSize} 

                stroke={lineColor} strokeWidth="2" />
        );
      }
      // 向右的线条 - 如果不是棋盘最右列则绘制
      if (c < 8) {
        markers.push(
          <line key={`marker-${r}-${c}-tr-h`} 
                x1={x + offset} y1={y - offset} 
                x2={x + offset + markerSize} 
                y2={y - offset} 
                stroke={lineColor} strokeWidth="2" />
        );
      }
    }
    
    // 左下角
    if (hasBottom && hasLeft) {
      // 向下的线条 - 如果不是棋盘底部行则绘制
      if (r < 9) {
        markers.push(
          <line key={`marker-${r}-${c}-bl-v`} 
                x1={x - offset} y1={y + offset} 
                x2={x - offset} 
                y2={y + offset + markerSize} 
                stroke={lineColor} strokeWidth="2" />
        );
      }
      // 向左的线条 - 如果不是棋盘最左列则绘制
      if (c > 0) {
        markers.push(
          <line key={`marker-${r}-${c}-bl-h`} 
                x1={x - offset} y1={y + offset} 
                x2={x - offset - markerSize} 
                y2={y + offset} 
                stroke={currentSkin.grid} strokeWidth="2" />
        );
      }
    }
    
    // 右下角
    if (hasBottom && hasRight) {
      // 向下的线条 - 如果不是棋盘底部行则绘制
      if (r < 9) {
        markers.push(
          <line key={`marker-${r}-${c}-br-v`} 
                x1={x + offset} y1={y + offset} 
                x2={x + offset} 
                y2={y + offset + markerSize} 
                stroke={currentSkin.grid} strokeWidth="2" />
        );
      }
      // 向右的线条 - 如果不是棋盘最右列则绘制
      if (c < 8) {
        markers.push(
          <line key={`marker-${r}-${c}-br-h`} 
                x1={x + offset} y1={y + offset} 
                x2={x + offset + markerSize} 
                y2={y + offset} 
                stroke={currentSkin.grid} strokeWidth="2" />
        );
      }
    }
    
    return markers;
  };

  const renderGrid = () => {
    const gridElements = [];

    const lineWidth = "2";
    const borderWidth = "3";
    
    // 凹效果相关参数
    const shadowWidth = "1";
    const shadowColor = "rgba(0, 0, 0, 0.3)";
    const highlightColor = lineColor;
    
    // 渲染格子（9行8列，去掉河界）
    for (let r = 0; r < 9; r++) {
      // 跳过河界行（第4行）
      if (r === 4) continue;
      
      for (let c = 0; c < 8; c++) {
        // 计算格子左上角坐标
        // 直接计算格子左上角坐标，不使用toSVG函数，避免翻转时的坐标转换问题
        // 确保无论是否翻转，格子都从左上角开始绘制
        // 修复：使用直接计算代替toSVG函数，避免y坐标问题
        const baseX = BOARD_OFFSET;
        const baseY = BOARD_OFFSET;
        
        // 计算实际显示的行列（考虑flip）
        const displayR = flip ? 8 - r : r;
        const displayC = flip ? 8 - (c + 1) : c;
        
        // 计算格子左上角坐标
        const rectX = baseX + displayC * CELL_SIZE;
        const rectY = baseY + displayR * CELL_SIZE;

        // 为每个格子添加褶皱效果类名
        const gridClass = "grid-cell";
        
        // 格子填充颜色：仅对glass-board皮肤生效
        let fillColor = "transparent";
        
        if (currentSkin.texture === 'glass') {      
          // 红方格子：1-4行（索引0-3）
          if (r >= 0 && r <= 3) {
            // 左上角开始，每隔一个格子用灰色填充
            if ((r + c) % 2 === 0) {
              fillColor = "#faf7f7ff";
            }
            else
            {
              fillColor = "#246525ff";
            }
          }
          // 黑方格子：6-9行（索引5-8）
          else if (r >= 5 && r <= 8) {
            // 右下角开始，每隔一个格子用灰色填充
            if ((r + c) % 2 === 1) {
              fillColor = "#faf7f7ff";
            }
            else
            {
              fillColor = "#246525ff";
            }
          }
        }
        
        // 渲染格子
        gridElements.push(
          <rect
            key={`grid-${r}-${c}`}
            x={rectX}
            y={rectY}
            width={CELL_SIZE}
            height={CELL_SIZE}
            fill={fillColor}
            stroke="none"
            className={gridClass}
            // 可以在这里添加褶皱效果，比如filter或pattern
          />
        );
        // 渲染格子的4条边，确保棋线显示在格子上方
        // 使用双线条技术实现凹效果：先绘制深色阴影线，再绘制浅色高光线
        
        // 上边框 - 先绘制下阴影，再绘制上高光
        gridElements.push(
          <line
            key={`edge-${r}-${c}-top-shadow`}
            x1={rectX}
            y1={rectY + 1}
            x2={rectX + CELL_SIZE}
            y2={rectY + 1}
            stroke={shadowColor}
            strokeWidth={shadowWidth}
          />
        );
        gridElements.push(
          <line
            key={`edge-${r}-${c}-top`}
            x1={rectX}
            y1={rectY}
            x2={rectX + CELL_SIZE}
            y2={rectY}
            stroke={highlightColor}
            strokeWidth={lineWidth}
          />
        );
        
        // 右边框 - 先绘制左阴影，再绘制右高光
        gridElements.push(
          <line
            key={`edge-${r}-${c}-right-shadow`}
            x1={rectX + CELL_SIZE - 1}
            y1={rectY}
            x2={rectX + CELL_SIZE - 1}
            y2={rectY + CELL_SIZE}
            stroke={shadowColor}
            strokeWidth={shadowWidth}
          />
        );
        gridElements.push(
          <line
            key={`edge-${r}-${c}-right`}
            x1={rectX + CELL_SIZE}
            y1={rectY}
            x2={rectX + CELL_SIZE}
            y2={rectY + CELL_SIZE}
            stroke={highlightColor}
            strokeWidth={lineWidth}
          />
        );
        
        // 下边框 - 先绘制上阴影，再绘制下高光
        gridElements.push(
          <line
            key={`edge-${r}-${c}-bottom-shadow`}
            x1={rectX}
            y1={rectY + CELL_SIZE - 1}
            x2={rectX + CELL_SIZE}
            y2={rectY + CELL_SIZE - 1}
            stroke={shadowColor}
            strokeWidth={shadowWidth}
          />
        );
        gridElements.push(
          <line
            key={`edge-${r}-${c}-bottom`}
            x1={rectX}
            y1={rectY + CELL_SIZE}
            x2={rectX + CELL_SIZE}
            y2={rectY + CELL_SIZE}
            stroke={highlightColor}
            strokeWidth={lineWidth}
          />
        );
        
        // 左边框 - 先绘制右阴影，再绘制左高光
        gridElements.push(
          <line
            key={`edge-${r}-${c}-left-shadow`}
            x1={rectX + 1}
            y1={rectY}
            x2={rectX + 1}
            y2={rectY + CELL_SIZE}
            stroke={shadowColor}
            strokeWidth={shadowWidth}
          />
        );
        gridElements.push(
          <line
            key={`edge-${r}-${c}-left`}
            x1={rectX}
            y1={rectY}
            x2={rectX}
            y2={rectY + CELL_SIZE}
            stroke={highlightColor}
            strokeWidth={lineWidth}
          />
        );
      }
    }
    
    // 渲染河界矩形 - 正确覆盖第4行和第5行之间的区域
    // 河界位于第4行底部和第5行顶部之间，高度为1个单元格
    // 直接计算河界位置，不使用toSVG函数，避免翻转时位置错误
    const riverY = BOARD_OFFSET + CELL_SIZE * 4;
    const riverHeight = CELL_SIZE;
    const riverLeft = BOARD_OFFSET;
    const riverWidth = CELL_SIZE * 8;
    gridElements.push(
      <rect
        key="river"
        x={riverLeft}
        y={riverY}
        width={riverWidth}
        height={riverHeight}
        fill='transparent'
        stroke="none"
      />
    );

    // 棋盘边框
    const tl = toSVG(0,0); const bl = toSVG(9,0);
    gridElements.push(<line key="b-left" x1={tl.x} y1={tl.y} x2={bl.x} y2={bl.y} stroke={lineColor} strokeWidth={borderWidth} />);
    const tr = toSVG(0,8); const br = toSVG(9,8);
    gridElements.push(<line key="b-right" x1={tr.x} y1={tr.y} x2={br.x} y2={br.y} stroke={lineColor} strokeWidth={borderWidth} />);

    // 九宫斜线
    gridElements.push(<line key="p-b-1" x1={toSVG(0,3).x} y1={toSVG(0,3).y} x2={toSVG(2,5).x} y2={toSVG(2,5).y} stroke={lineColor} strokeWidth={borderWidth} strokeDasharray="5,5" />);
    gridElements.push(<line key="p-b-2" x1={toSVG(0,5).x} y1={toSVG(0,5).y} x2={toSVG(2,3).x} y2={toSVG(2,3).y} stroke={lineColor} strokeWidth={borderWidth} strokeDasharray="5,5" />);
    gridElements.push(<line key="p-r-1" x1={toSVG(9,3).x} y1={toSVG(9,3).y} x2={toSVG(7,5).x} y2={toSVG(7,5).y} stroke={lineColor} strokeWidth={borderWidth} strokeDasharray="5,5" />);
    gridElements.push(<line key="p-r-2" x1={toSVG(9,5).x} y1={toSVG(9,5).y} x2={toSVG(7,3).x} y2={toSVG(7,3).y} stroke={lineColor} strokeWidth={borderWidth} strokeDasharray="5,5" />);

    // 炮位标记（第2行和第7行的第1列和第7列）
    gridElements.push(...renderPositionMarkers(2, 1)); // 黑方左炮位
    gridElements.push(...renderPositionMarkers(2, 7)); // 黑方右炮位
    gridElements.push(...renderPositionMarkers(7, 1)); // 红方左炮位
    gridElements.push(...renderPositionMarkers(7, 7)); // 红方右炮位
    
    // 兵位标记（第3行和第6行的第0、2、4、6、8列）
    gridElements.push(...renderPositionMarkers(3, 0)); // 黑方兵位
    gridElements.push(...renderPositionMarkers(3, 2));
    gridElements.push(...renderPositionMarkers(3, 4));
    gridElements.push(...renderPositionMarkers(3, 6));
    gridElements.push(...renderPositionMarkers(3, 8));
    gridElements.push(...renderPositionMarkers(6, 0)); // 红方兵位
    gridElements.push(...renderPositionMarkers(6, 2));
    gridElements.push(...renderPositionMarkers(6, 4));
    gridElements.push(...renderPositionMarkers(6, 6));
    gridElements.push(...renderPositionMarkers(6, 8));

    return gridElements;
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
        indicators.push(<rect key="selected" x={x - CELL_SIZE/2 + 1} y={y - CELL_SIZE/2 + 1} width={CELL_SIZE - 2} height={CELL_SIZE - 2} fill="none" stroke="#22c55e" strokeWidth="3" rx={4} className="animate-pulse" pointerEvents="none" />);
        
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
                    
                    {/* Tactic */}
                    <text 
                        x={tooltipX + 20} 
                        y={tooltipY + 125} 
                        textAnchor="start" 
                        fill="#d1d5db" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        Tactic:
                    </text>
                    <text 
                        x={tooltipX + 145} 
                        y={tooltipY + 125} 
                        textAnchor="end" 
                        fill="#6ee7b7" 
                        fontSize="10" 
                        fontWeight="bold"
                    >
                        {pieceEval.tactic.toFixed(2)}
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
          
          // 在动画期间：
          // 1. 保留起始位置的棋子显示（不隐藏）
          // 2. 隐藏目标位置的棋子，因为动画元素会显示移动的棋子
          // 3. 只有当棋子是起始位置且不是目标位置时，才应用动画偏移
          const shouldHide = moveAnimation && isMovingTo;
          
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
                  transition: isInCheck ? undefined : animationTransition,
                  transformOrigin: 'center',
                  transformBox: 'fill-box', // 确保变换原点相对于元素本身计算
                  filter: isSelected ? 'drop-shadow(0 0 10px rgba(255, 255, 0, 0.8))' : 'url(#dropShadow)',
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

  return (
    <div 
        className="relative shadow-2xl rounded-lg overflow-hidden transition-all duration-300 border-8"
        style={{ 
            backgroundColor: currentSkin.containerBg, 
            borderColor: isSetupMode ? '#0f766e' : currentSkin.border // Teal for setup, skin border otherwise
        }}
    >
      <svg width={WIDTH} height={HEIGHT} className="block" style={{ background: bgColor }}>
        <defs>
            {/* 聚光灯效果 - 中间亮边角暗，加强对比度 */}
            <radialGradient id="spotlight" cx="50%" cy="50%" r="60%">
                <stop offset="0%" stopColor="white" stopOpacity="0.3" />
                <stop offset="40%" stopColor="white" stopOpacity="0.1" />
                <stop offset="70%" stopColor="black" stopOpacity="0.1" />
                <stop offset="100%" stopColor="black" stopOpacity="0.3" />
            </radialGradient>
            
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
            
            {/* 大理石纹理 - 增强花纹效果，添加灰色和褐色脉络 */}
            {currentSkin.texture === 'stone' && (
                <filter id="stoneTexture" x="0%" y="0%" width="100%" height="100%">
                    {/* 主脉络 - 灰色大理石纹路 */}
                    <feTurbulence 
                        type="fractalNoise" 
                        baseFrequency="0.015 0.035" 
                        numOctaves="6" 
                        seed="100"
                        result="mainVeins"
                    />
                    <feColorMatrix 
                        in="mainVeins"
                        type="matrix"
                        values="0.6 0.6 0.6 0 0
                                0.6 0.6 0.6 0 0
                                0.6 0.6 0.6 0 0
                                0   0   0   1 0"
                        result="grayVeins"
                    />
                    <feComponentTransfer in="grayVeins" result="grayContrast">
                        <feFuncR type="linear" slope="2.5" intercept="-0.6" />
                        <feFuncG type="linear" slope="2.5" intercept="-0.6" />
                        <feFuncB type="linear" slope="2.5" intercept="-0.6" />
                        <feFuncA type="discrete" tableValues="0 0.25 0.4 0.3 0.2" />
                    </feComponentTransfer>
                    
                    {/* 次脉络 - 褐色斑纹 */}
                    <feTurbulence 
                        type="turbulence" 
                        baseFrequency="0.025 0.02" 
                        numOctaves="4" 
                        seed="150"
                        result="brownSpots"
                    />
                    <feColorMatrix 
                        in="brownSpots"
                        type="matrix"
                        values="0.8 0.4 0.2 0 0
                                0.6 0.3 0.15 0 0
                                0.4 0.2 0.1 0 0
                                0   0   0   1 0"
                        result="brownColor"
                    />
                    <feComponentTransfer in="brownColor" result="brownContrast">
                        <feFuncR type="linear" slope="2.0" intercept="-0.5" />
                        <feFuncG type="linear" slope="2.0" intercept="-0.5" />
                        <feFuncB type="linear" slope="2.0" intercept="-0.5" />
                        <feFuncA type="discrete" tableValues="0 0.15 0.25 0.15" />
                    </feComponentTransfer>
                    
                    {/* 细脉络 - 细密的裂纹 */}
                    <feTurbulence 
                        type="fractalNoise" 
                        baseFrequency="0.08 0.1" 
                        numOctaves="3" 
                        seed="200"
                        result="fineLines"
                    />
                    <feColorMatrix 
                        in="fineLines"
                        type="saturate" 
                        values="0"
                        result="fineGray"
                    />
                    <feComponentTransfer in="fineGray" result="fineContrast">
                        <feFuncR type="linear" slope="3.0" intercept="-1.0" />
                        <feFuncG type="linear" slope="3.0" intercept="-1.0" />
                        <feFuncB type="linear" slope="3.0" intercept="-1.0" />
                        <feFuncA type="discrete" tableValues="0 0.1 0.15 0.1" />
                    </feComponentTransfer>
                    
                    {/* 合并所有纹理层 */}
                    <feBlend mode="multiply" in="grayContrast" in2="SourceGraphic" result="layer1" />
                    <feBlend mode="multiply" in="brownContrast" in2="layer1" result="layer2" />
                    <feBlend mode="darken" in="fineContrast" in2="layer2" result="final" />
                    <feComposite operator="in" in="final" in2="SourceGraphic" />
                </filter>
            )}
            
            {/* 木纹纹理 - 高横向频率模拟木材纹理 */}
            {currentSkin.texture === 'wood' && (
                <filter id="woodTexture" x="0%" y="0%" width="100%" height="100%">
                    <feTurbulence 
                        type="fractalNoise" 
                        baseFrequency="0.01 0.1" 
                        numOctaves="8" 
                        seed="50"
                        result="woodNoise"
                    />
                    <feColorMatrix 
                        in="woodNoise"
                        type="saturate" 
                        values="0.4"
                        result="woodColor"
                    />
                    <feComponentTransfer in="woodColor" result="woodContrast">
                        <feFuncR type="linear" slope="2.0" intercept="-0.5" />
                        <feFuncG type="linear" slope="2.0" intercept="-0.5" />
                        <feFuncB type="linear" slope="2.0" intercept="-0.5" />
                        <feFuncA type="discrete" tableValues="0 0.2 0.3 0.25" />
                    </feComponentTransfer>
                    <feBlend mode="multiply" in="woodContrast" in2="SourceGraphic" result="blend" />
                    <feComposite operator="in" in="blend" in2="SourceGraphic" />
                </filter>
            )}
            

                     
            
            {/* 宣纸纹理 - 仿古宣纸效果，有折叠痕迹和纤维质感 */}
            {currentSkin.texture === 'paper' && (
                <>
                    <filter id="paperTexture" x="0%" y="0%" width="100%" height="100%">
                        {/* 宣纸底色纹理 - 浅绿发黄的纤维质感 */}
                        <feTurbulence 
                            type="fractalNoise" 
                            baseFrequency="0.8 0.6" 
                            numOctaves="4" 
                            seed="100"
                            result="paperNoise"
                        />
                        <feColorMatrix 
                            in="paperNoise"
                            type="matrix"
                            values="0.95 0.8 0.6 0 0
                                    0.9 0.75 0.5 0 0
                                    0.85 0.7 0.4 0 0
                                    0   0   0   1 0"
                            result="paperColor"
                        />
                        <feComponentTransfer in="paperColor" result="paperContrast">
                            <feFuncR type="linear" slope="1.2" intercept="0.1" />
                            <feFuncG type="linear" slope="1.2" intercept="0.1" />
                            <feFuncB type="linear" slope="1.2" intercept="0.1" />
                            <feFuncA type="discrete" tableValues="0 0.05 0.08 0.06" />
                        </feComponentTransfer>
                        
                        {/* 折叠痕迹效果 */}
                        <feTurbulence 
                            type="fractalNoise" 
                            baseFrequency="0.02 0.01" 
                            numOctaves="3" 
                            seed="200"
                            result="foldLines"
                        />
                        <feColorMatrix 
                            in="foldLines"
                            type="saturate" 
                            values="0"
                            result="foldGray"
                        />
                        <feComponentTransfer in="foldGray" result="foldContrast">
                            <feFuncR type="linear" slope="2.0" intercept="-0.5" />
                            <feFuncG type="linear" slope="2.0" intercept="-0.5" />
                            <feFuncB type="linear" slope="2.0" intercept="-0.5" />
                            <feFuncA type="discrete" tableValues="0 0.15 0.2 0.1" />
                        </feComponentTransfer>
                        
                        {/* 合并纹理 */}
                        <feBlend mode="multiply" in="paperContrast" in2="SourceGraphic" result="baseLayer" />
                        <feBlend mode="overlay" in="foldContrast" in2="baseLayer" result="finalTexture" />
                        <feComposite operator="in" in="finalTexture" in2="SourceGraphic" />
                    </filter>
                    
                    {/* 宣纸边缘做旧效果 */}
                    <filter id="paperEdge" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="8" result="blur" />
                        <feColorMatrix 
                            type="matrix" 
                            values="0.8 0.6 0.4 0 0
                                    0.7 0.5 0.3 0 0
                                    0.6 0.4 0.2 0 0
                                    0   0   0   0.3 0" 
                            result="agedEdge"
                        />
                        <feComposite operator="over" in="agedEdge" in2="SourceGraphic" />
                    </filter>
                </>
            )}
            
            {/* 玻璃纹理 - 透明反光效果，模拟茶色玻璃板 */}
            {currentSkin.texture === 'glass' && (
                <filter id="glassTexture" x="-50%" y="-50%" width="200%" height="200%">
                    {/* 基础茶色玻璃底色 */}
                    <feFlood floodColor="#70DBDB" floodOpacity="0.7" result="glassBase" />
                    
                    {/* 添加高光和反光效果 */}
                    <feTurbulence 
                        type="fractalNoise" 
                        baseFrequency="0.5 0.3" 
                        numOctaves="1" 
                        seed="300"
                        result="glassNoise"
                    />
                    <feColorMatrix 
                        in="glassNoise"
                        type="matrix"
                        values="0.2 0.1 0 0 0                                
                                0.15 0.1 0 0 0
                                0.1 0.05 0 0 0
                                0   0   0 1 0"
                        result="glassTint"
                    />
                    
                    {/* 亮度和对比度调整 */}
                    <feComponentTransfer in="glassTint" result="glassContrast">
                        <feFuncR type="linear" slope="1.2" intercept="0.05" />
                        <feFuncG type="linear" slope="1.2" intercept="0.05" />
                        <feFuncB type="linear" slope="1.2" intercept="0.05" />
                        <feFuncA type="discrete" tableValues="0 0.3 0.5 0.4" />
                    </feComponentTransfer>
                    
                    {/* 添加光泽和反射效果 */}
                    <feGaussianBlur in="glassContrast" stdDeviation="0.5" result="glassBlur" />
                    <feSpecularLighting in="glassBlur" surfaceScale="2" specularConstant="1" specularExponent="20" lightingColor="#ffffff" result="specular">
                        <feDistantLight azimuth="45" elevation="60" />
                    </feSpecularLighting>
                    
                    {/* 合并所有效果 */}
                    <feBlend mode="multiply" in="glassBase" in2="SourceGraphic" result="baseLayer" />
                    <feBlend mode="screen" in="specular" in2="baseLayer" result="glassEffect" />
                    <feComposite operator="in" in="glassEffect" in2="SourceGraphic" />
                </filter>
            )}
        </defs>
        
        {/* 背景纹理层 */}
        <rect 
            x="0" 
            y="0" 
            width={WIDTH} 
            height={HEIGHT} 
            fill={isSetupMode ? bgColor : bgColor}
            fillOpacity="1"
            filter={!boardBgColor && currentSkin.texture ? `url(#${currentSkin.texture}Texture)` : undefined}
        />
        
        {/* 聚光灯效果层 - 置于背景之上，增强可见度 */}
        <rect 
            x="0" 
            y="0" 
            width={WIDTH} 
            height={HEIGHT} 
            fill="url(#spotlight)"
            opacity="0.8"
        />
        

        
        {/* 茶色玻璃棋盘特殊效果 - 反光和高光效果，只在刻度线以外出现 */}
        {currentSkin.texture === 'glass' && (
            <>
                {/* 玻璃边缘反光效果 - 只显示在棋盘边缘 */}
                <rect 
                    x="0" 
                    y="0" 
                    width={WIDTH} 
                    height={HEIGHT} 
                    fill="none"
                    stroke="#70DBDB"
                    strokeWidth="15"
                    opacity="0.4"
                    filter="url(#glassTexture)"
                />
                
                {/* 玻璃高光效果 - 调整位置和透明度 */}
                <ellipse 
                    cx={WIDTH * 0.3} 
                    cy={HEIGHT * 0.4} 
                    rx={WIDTH * 0.4} 
                    ry={HEIGHT * 0.3} 
                    fill="rgba(255, 255, 255, 0.1)" 
                    opacity="0.2"
                    filter="blur(10px)"
                />
                
                {/* 玻璃边缘高光 - 增强边缘效果 */}
                <path 
                    d={`M 0 0 Q ${WIDTH * 0.2} ${HEIGHT * 0.1}, ${WIDTH * 0.5} 0 T ${WIDTH} 0 L ${WIDTH} ${HEIGHT * 0.1} Q ${WIDTH * 0.8} ${HEIGHT * 0.2}, ${WIDTH * 0.5} ${HEIGHT * 0.1} T 0 ${HEIGHT * 0.1} Z`}
                    fill="rgba(255, 255, 255, 0.1)" 
                    opacity="0.3"
                    filter="blur(5px)"
                />
                
                {/* 底部边缘高光 */}
                <path 
                    d={`M 0 ${HEIGHT} Q ${WIDTH * 0.2} ${HEIGHT * 0.9}, ${WIDTH * 0.5} ${HEIGHT} T ${WIDTH} ${HEIGHT} L ${WIDTH} ${HEIGHT * 0.9} Q ${WIDTH * 0.8} ${HEIGHT * 0.8}, ${WIDTH * 0.5} ${HEIGHT * 0.9} T 0 ${HEIGHT * 0.9} Z`}
                    fill="rgba(255, 255, 255, 0.08)" 
                    opacity="0.3"
                    filter="blur(5px)"
                />
            </>
        )}

        {/* 宣纸棋盘特殊效果 - 折叠痕迹和边缘做旧 */}
        {currentSkin.texture === 'paper' && (
            <>
                {/* 宣纸边缘做旧效果 */}
                <rect 
                    x="0" 
                    y="0" 
                    width={WIDTH} 
                    height={HEIGHT} 
                    fill="none"
                    stroke="#A68B5B"
                    strokeWidth="15"
                    opacity="0.3"
                    filter="url(#paperEdge)"
                />
                
                {/* 折叠痕迹效果 - 模拟纸张折叠的痕迹 */}
                <g opacity="0.15">
                    {/* 主要折叠线 - 中心水平折叠 */}
                    <line 
                        x1="0" 
                        y1={HEIGHT * 0.5} 
                        x2={WIDTH} 
                        y2={HEIGHT * 0.5} 
                        stroke="#8B4513" 
                        strokeWidth="3" 
                        strokeDasharray="15,8"
                        filter="blur(1px)"
                    />
                    
                    {/* 垂直折叠线 */}
                    <line 
                        x1={WIDTH * 0.5} 
                        y1="0" 
                        x2={WIDTH * 0.5} 
                        y2={HEIGHT} 
                        stroke="#8B4513" 
                        strokeWidth="2.5" 
                        strokeDasharray="12,10"
                        filter="blur(0.8px)"
                    />
                    
                    {/* 对角线折叠痕迹 */}
                    <line 
                        x1="0" 
                        y1="0" 
                        x2={WIDTH} 
                        y2={HEIGHT} 
                        stroke="#A68B5B" 
                        strokeWidth="1.8" 
                        strokeDasharray="20,15"
                        filter="blur(1.2px)"
                    />
                    
                    <line 
                        x1={WIDTH} 
                        y1="0" 
                        x2="0" 
                        y2={HEIGHT} 
                        stroke="#A68B5B" 
                        strokeWidth="1.8" 
                        strokeDasharray="18,12"
                        filter="blur(1.2px)"
                    />
                    
                    {/* 轻微折痕 - 模拟纸张使用的痕迹 */}
                    <path 
                        d={`M ${WIDTH * 0.3} ${HEIGHT * 0.2} Q ${WIDTH * 0.4} ${HEIGHT * 0.15}, ${WIDTH * 0.5} ${HEIGHT * 0.25} T ${WIDTH * 0.6} ${HEIGHT * 0.2}`}
                        stroke="#8B4513" 
                        strokeWidth="1.2" 
                        fill="none"
                        strokeLinecap="round"
                        filter="blur(0.5px)"
                    />
                    
                    <path 
                        d={`M ${WIDTH * 0.2} ${HEIGHT * 0.7} Q ${WIDTH * 0.3} ${HEIGHT * 0.75}, ${WIDTH * 0.4} ${HEIGHT * 0.65} T ${WIDTH * 0.5} ${HEIGHT * 0.7}`}
                        stroke="#8B4513" 
                        strokeWidth="1.2" 
                        fill="none"
                        strokeLinecap="round"
                        filter="blur(0.5px)"
                    />
                </g>
                
                {/* 宣纸边缘磨损效果 */}
                <g opacity="0.1">
                    {/* 左上角磨损 */}
                    <path 
                        d={`M 0,0 Q 20,10 10,20`}
                        stroke="#8B4513" 
                        strokeWidth="2" 
                        fill="none"
                        strokeLinecap="round"
                    />
                    
                    {/* 右上角磨损 */}
                    <path 
                        d={`M ${WIDTH},0 Q ${WIDTH - 20},10 ${WIDTH - 10},20`}
                        stroke="#8B4513" 
                        strokeWidth="2" 
                        fill="none"
                        strokeLinecap="round"
                    />
                    
                    {/* 左下角磨损 */}
                    <path 
                        d={`M 0,${HEIGHT} Q 20,${HEIGHT - 10} 10,${HEIGHT - 20}`}
                        stroke="#8B4513" 
                        strokeWidth="2" 
                        fill="none"
                        strokeLinecap="round"
                    />
                    
                    {/* 右下角磨损 */}
                    <path 
                        d={`M ${WIDTH},${HEIGHT} Q ${WIDTH - 20},${HEIGHT - 10} ${WIDTH - 10},${HEIGHT - 20}`}
                        stroke="#8B4513" 
                        strokeWidth="2" 
                        fill="none"
                        strokeLinecap="round"
                    />
                </g>
            </>
        )}
        
              
        {renderGrid()}
        {renderCoordinates()}
        {renderRiverText()}
        {renderPieces()}
        {renderIndicators()}
      </svg>
      
      {/* 行棋动画层 - 使用绝对定位的div包裹，确保动画不受SVG限制 */}
      {moveAnimation && moveAnimation.piece && (
        <div
          key={`anim-${moveAnimation.id}`}
          className="chess-move-element"
          style={{
            // 计算起始位置
            left: `${toSVG(moveAnimation.from.r, moveAnimation.from.c).x - CELL_SIZE/2}px`,
            top: `${toSVG(moveAnimation.from.r, moveAnimation.from.c).y - CELL_SIZE/2}px`,
            position: 'absolute',
            width: `${CELL_SIZE}px`,
            height: `${CELL_SIZE}px`,
            zIndex: 1000,
            pointerEvents: 'none',
            // 直接计算目标位置，使用CSS transition触发动画
            transform: 'translate(0, 0)',
            transition: 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            transformOrigin: 'center',
            // 强制CSS重新计算动画：通过animation-delay触发
            animation: 'none',
            animationDelay: '0.1s'
          }}
          // 使用ref和useEffect直接操作DOM，确保动画从正确位置开始
          ref={(el) => {
            if (el && moveAnimation) {
              // 重置transform
              el.style.transform = 'translate(0, 0)';
              // 强制重排
              el.offsetHeight;
              // 设置目标transform
              const deltaX = toSVG(moveAnimation.to.r, moveAnimation.to.c).x - toSVG(moveAnimation.from.r, moveAnimation.from.c).x;
              const deltaY = toSVG(moveAnimation.to.r, moveAnimation.to.c).y - toSVG(moveAnimation.from.r, moveAnimation.from.c).y;
              el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
            }
          }}
        >
          {/* 使用SVG元素来渲染动画棋子 */}
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
  );
};
