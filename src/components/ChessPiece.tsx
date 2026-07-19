
import React, { useId } from 'react';
import { PieceType, Color, PieceMaterial } from '../types';

interface ChessPieceProps {
    type: PieceType;
    color: Color;
    size: number;
    variant?: 'normal' | 'dark';
    material?: PieceMaterial;
    playerColor?: Color; // 玩家所在方，用于决定文字朝向
    isInCheck?: boolean; // 是否处于被将军状态
    isRecentlyCaptured?: boolean; // 是否是最近被吃的棋子
    style?: React.CSSProperties;
}

const PIECE_CHARS: Record<string, { red: string; black: string }> = {
  general: { red: '帥', black: '將' },
  advisor: { red: '仕', black: '士' },
  elephant: { red: '相', black: '象' },
  horse: { red: '马', black: '馬' },
  chariot: { red: '车', black: '車' },
  cannon: { red: '炮', black: '砲' },
  soldier: { red: '兵', black: '卒' },
};

// 材质配置
const MATERIAL_CONFIGS = {
    wood: {
        red: {
            fill: '#dfae6eff',
            stroke: '#c71010ff',
            gradient: ['#F5DEB3', '#dfae6eff'],
            textColor: '#DC143C',
            textShadow: 'none',
            shine: 0.3
        },
        black: {
            fill: '#dfae6eff',
            stroke: '#2C2C2C',
            gradient: ['#F5DEB3', '#dfae6eff'],
            textColor: '#1A1A1A',
            textShadow: 'none',
            shine: 0.3
        }
    },
    stone: {
        red: {
            fill: '#E74C3C', // 深红色背景，对比度更强
            stroke: '#2C3E50', // 深灰色外圈，对比度更强
            gradient: ['#FF6B5E', '#C0392B'], // 红色渐变，对比度更强
            textColor: '#FFFFFF', // 白色文字，对比度更强
            textShadow: '0px 1px 2px rgba(0,0,0,0.5)', // 添加文字阴影，增强可读性
            shine: 0.9
        },
        black: {
            fill: '#4A90E2', // 深蓝色背景，对比度更强
            stroke: '#2C3E50', // 深灰色外圈，对比度更强
            gradient: ['#5BA8FF', '#357ABD'], // 蓝色渐变，对比度更强
            textColor: '#FFFFFF', // 白色文字，对比度更强
            textShadow: '0px 1px 2px rgba(0,0,0,0.5)', // 添加文字阴影，增强可读性
            shine: 0.9
        }
    },

    metal: {
        red: {
            fill: '#4A2C17', // 金属背景色
            stroke: '#2D1810',
            strokeWidth: 5,
            gradient: ['#5D2F0D', '#4A2C17'],
            textColor: '#F75000',
            textShadow: 'none',
            shine: 0.2,
            woodGrain: true,
            borderColor: '#F75000' // 红色回形纹颜色
        },
        black: {
            fill: '#4A2C17', // 金属背景色
            stroke: '#2D1810',
            strokeWidth: 5,
            gradient: ['#5D2F0D', '#4A2C17'],
            textColor: '#00CED1',
            textShadow: 'none',
            shine: 0.2,
            woodGrain: true,
            borderColor: '#00CED1' // 青色回形纹颜色
        }
    },
    glass: {
        red: {
            fill: 'rgba(255, 182, 193, 0.3)', // 浅粉红色玻璃
            stroke: 'rgba(139, 0, 0, 0.8)', // 绛红色边框
            gradient: ['rgba(255, 255, 255, 0.8)', 'rgba(255, 182, 193, 0.2)'], // 玻璃渐变
            textColor: '#8B0000', // 绛红色文字
            textShadow: '0px 0px 3px rgba(255,255,255,0.8), 1px 1px 2px rgba(0,0,0,0.3)', // 玻璃光效
            shine: 0.8, // 高光泽
            glassEffect: true // 玻璃效果标记
        },
        black: {
            fill: 'rgba(164, 245, 164, 0.3)', // 浅绿色玻璃
            stroke: 'rgba(0, 96, 0, 0.8)', // 深绿色边框
            gradient: ['rgba(255, 255, 255, 0.8)', 'rgba(176, 196, 222, 0.2)'], // 玻璃渐变
            textColor: '#006000', // 深绿色文字
            textShadow: '0px 0px 3px rgba(255,255,255,0.8), 1px 1px 2px rgba(0,0,0,0.3)', // 玻璃光效
            shine: 0.8, // 高光泽
            glassEffect: true // 玻璃效果标记
        }
    }
};

export const ChessPiece: React.FC<ChessPieceProps> = ({ type, color, size, variant = 'normal', material = 'wood', playerColor = 'red', isInCheck = false, isRecentlyCaptured = false, style }) => {
    const r = size / 2 - 4;
    const fontSize = size * 0.52;
    
    const isDark = variant === 'dark';
    const config = MATERIAL_CONFIGS[material][color];
    // 稳定唯一ID，避免每次渲染重建滤镜导致将军动画被重置
    const reactId = useId().replace(/:/g, '');
    const uniqueId = `${material}-${color}-${reactId}`;
    
    // 暗色变体使用固定的深色
    const fillColor = isDark ? "#3e2723" : `url(#pieceGradient-${material}-${color})`;
    const strokeColor = isDark ? '#271c19' : config.stroke;
    const charColor = isDark ? (color === 'red' ? '#c00' : '#111') : config.textColor;
    const textShadow = isDark 
        ? '0px 1px 0px rgba(255,255,255,0.1)'
        : config.textShadow;
    
    // 文字旋转逻辑：己方棋子文字向上（不旋转），敌方棋子文字向下（旋转180度）
    const shouldRotateText = color !== playerColor;

    // 只有将/帅且处于被将军状态时才应用抖动动画
    const shouldShake = isInCheck && type === 'general';
    
    // 确定应用的动画
    let animationStyle: React.CSSProperties = {};
    if (isRecentlyCaptured) {
        // 最近被吃的棋子应用旋转动画：4秒转2圈，然后停止
        animationStyle = {
            animation: 'rotate 4s linear forwards', // 4秒转2圈，forwards保持最终状态
            transformOrigin: '50% 50%', // 明确设置旋转中心为元素中心点
            transformBox: 'fill-box' // 确保旋转基于元素自身坐标系
        };
    } else if (shouldShake) {
        // 将军状态应用抖动动画（写在子节点 style 上，不依赖外部 CSS 类）
        animationStyle = {
            animation: 'shake 0.5s infinite',
            transformOrigin: 'center',
            transformBox: 'fill-box'
        };
    }
    
    return (
        <g style={{ ...animationStyle, ...style }}>
            {/* 动画定义：挂在棋子内部，确保 SVG 内也能播 */}
            <style>{`
                @keyframes shake {
                    0%, 100% { transform: translate(0, 0); }
                    25% { transform: translate(1px, 1px); }
                    50% { transform: translate(-1px, -1px); }
                    75% { transform: translate(1px, -1px); }
                }
                
                @keyframes rotate {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(720deg); }
                }
            `}</style>
            {/* 渐变定义 */}
            {!isDark && (
                <defs>
                    <radialGradient id={`pieceGradient-${material}-${color}`}>
                        <stop offset="0%" stopColor={config.gradient[0]} />
                        <stop offset="100%" stopColor={config.gradient[1]} />
                    </radialGradient>
                    
                    {/* 木纹噪声纹理滤镜 - 仅对木制棋子有效 */}
                    {material === 'wood' && (
                        <>
                            {/* 内圈裁剪路径 */}
                            <clipPath id={`innerCircle-${uniqueId}`}>
                                <circle cx="0" cy="0" r={r - 4} />
                            </clipPath>
                            <filter id={`woodPieceTexture-${uniqueId}`} x="0%" y="0%" width="100%" height="100%">
                                <feTurbulence 
                                    type="fractalNoise" 
                                    baseFrequency="0.02 0.25" 
                                    numOctaves="8" 
                                    seed="42"
                                    result="woodNoise"
                                />
                                <feColorMatrix 
                                    in="woodNoise"
                                    type="saturate" 
                                    values="0.5"
                                    result="woodColor"
                                />
                                <feComponentTransfer in="woodColor" result="woodContrast">
                                    <feFuncR type="linear" slope="2.5" intercept="-0.6" />
                                    <feFuncG type="linear" slope="2.5" intercept="-0.6" />
                                    <feFuncB type="linear" slope="2.5" intercept="-0.6" />
                                    <feFuncA type="discrete" tableValues="0 0.3 0.4 0.35" />
                                </feComponentTransfer>
                                <feBlend mode="multiply" in="woodContrast" in2="SourceGraphic" result="blend" />
                                <feComposite operator="in" in="blend" in2="SourceGraphic" />
                            </filter>
                        </>
                    )}
                </defs>
            )}
            
            {/* 金属单层棋子设计 */}
            {material === 'metal' && !isDark ? (
                <>
                    {/* 单层棋子 - 背景覆盖到外圈 */}
                    <circle 
                        r={r} 
                        fill={fillColor} 
                        stroke={strokeColor} 
                        strokeWidth="2" 
                        className="transition-colors duration-300"
                    />
                    
                    {/* 裁剪路径定义 */}
                    <defs>
                        <clipPath id={`outerCircle-${color}`}>
                            <circle cx="0" cy="0" r={r} />
                        </clipPath>
                    </defs>
                    

                    {/* 回形纹装饰 */}
                    <g>
                        {/* 外圈回形纹 - 靠近棋子边缘 */}
                        <circle 
                            r={r - 2} 
                            fill="none" 
                            stroke={(config as any).borderColor || config.stroke}
                            strokeWidth="1.5" 
                            opacity="0.8"
                        />
                        
                        {/* 中圈回形纹 - 中等距离 */}
                        <circle 
                            r={r - 6} 
                            fill="none" 
                            stroke={(config as any).borderColor || config.stroke}
                            strokeWidth="1" 
                            opacity="0.6"
                        />
                        
                        {/* 内圈回形纹 - 靠近中心 */}
                        <circle 
                            r={r - 10} 
                            fill="none" 
                            stroke={(config as any).borderColor || config.stroke}
                            strokeWidth="0.8" 
                            opacity="0.4"
                        />
                        
                        {/* 装饰性点状花纹 - 在回形纹之间 */}
                        {Array.from({ length: 12 }).map((_, i) => {
                            const angle = (i * 30) * Math.PI / 180;
                            const radius = r - 4;
                            const x = radius * Math.cos(angle);
                            const y = radius * Math.sin(angle);
                            
                            return (
                                <circle
                                    key={`dot-${i}`}
                                    cx={x}
                                    cy={y}
                                    r="0.8"
                                    fill={(config as any).borderColor || config.stroke}
                                    opacity="0.7"
                                />
                            );
                        })}
                        
                        {/* 四角装饰花纹 */}
                        {[0, 90, 180, 270].map((angle) => {
                            const radian = (angle * Math.PI) / 180;
                            const outerX = (r - 3) * Math.cos(radian);
                            const outerY = (r - 3) * Math.sin(radian);
                            const innerX = (r - 8) * Math.cos(radian);
                            const innerY = (r - 8) * Math.sin(radian);
                            
                            return (
                                <path
                                    key={`corner-${angle}`}
                                    d={`M ${outerX} ${outerY} L ${innerX} ${innerY}`}
                                    stroke={(config as any).borderColor || config.stroke}
                                    strokeWidth="1.2"
                                    opacity="0.6"
                                />
                            );
                        })}
                    </g>

                </>
            ) : material === 'glass' ? (
                <>
                    {/* 玻璃材质的特殊效果 */}
                    {/* 玻璃主体 - 半透明 */}
                    <circle 
                        r={r} 
                        fill={config.fill} 
                        stroke={config.stroke} 
                        strokeWidth={isDark ? 1 : 3} 
                        className="transition-all duration-300"
                        filter="blur(0.5px)"
                    />
                    
                    {/* 玻璃高光效果 */}
                    <ellipse 
                        cx={-r * 0.3} 
                        cy={-r * 0.4} 
                        rx={r * 0.4} 
                        ry={r * 0.25} 
                        fill="rgba(255, 255, 255, 0.7)" 
                        transform="rotate(-20)"
                        filter="blur(2px)"
                    />
                    
                    {/* 玻璃边缘高光 */}
                    <path 
                        d={`M ${-r * 0.8} ${-r * 0.3} Q ${-r * 0.5} ${-r * 0.8}, ${-r * 0.2} ${-r * 0.9}`}
                        stroke="rgba(255, 255, 255, 0.9)" 
                        strokeWidth="2" 
                        fill="none" 
                        filter="blur(1px)"
                    />
                    

                    
                    {/* 玻璃纹理效果 */}
                    <ellipse 
                        cx={r * 0.2} 
                        cy={r * 0.3} 
                        rx={r * 0.3} 
                        ry={r * 0.15} 
                        fill="rgba(255, 255, 255, 0.2)" 
                        transform="rotate(25)"
                        filter="blur(3px)"
                    />
                </>
            ) : material === 'stone' ? (
                <>
                    {/* 玉石材质棋子 - 外圈边框 */}
                    <circle 
                        r={r} 
                        fill="none" 
                        stroke={strokeColor} 
                        strokeWidth={isDark ? 1 : 2} 
                        className="transition-colors duration-300"
                    />
                    
                    {/* 分段式彩色包边 - 位于内外圈之间，每隔120度一段 */}
                    <g>
                        {[0, 120, 240].map((angle) => {
                            const radian = (angle * Math.PI) / 180;
                            const innerRadius = r - 8;
                            const outerRadius = r - 2;
                            const startAngle = angle - 55; // 每段110度宽
                            const endAngle = angle + 55;
                            
                            const x1 = innerRadius * Math.cos((startAngle * Math.PI) / 180);
                            const y1 = innerRadius * Math.sin((startAngle * Math.PI) / 180);
                            const x2 = outerRadius * Math.cos((startAngle * Math.PI) / 180);
                            const y2 = outerRadius * Math.sin((startAngle * Math.PI) / 180);
                            const x3 = outerRadius * Math.cos((endAngle * Math.PI) / 180);
                            const y3 = outerRadius * Math.sin((endAngle * Math.PI) / 180);
                            const x4 = innerRadius * Math.cos((endAngle * Math.PI) / 180);
                            const y4 = innerRadius * Math.sin((endAngle * Math.PI) / 180);
                            
                            const pathData = `M ${x1} ${y1} L ${x2} ${y2} A ${outerRadius} ${outerRadius} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerRadius} ${innerRadius} 0 0 0 ${x1} ${y1}`;
                            
                            return (
                                <path
                                    key={angle}
                                    d={pathData}
                                    fill={color === 'red' ? '#ffffff' : '#ffffff'} // 红棋蓝色包边，蓝棋红色包边
                                    opacity="0.6"
                                />
                            );
                        })}
                    </g>
                    
                    {/* 玉石背景 - 只覆盖到小线圈内部 */}
                    <circle 
                        r={r - 6} 
                        fill={fillColor} 
                        className="transition-colors duration-300"
                    />
                    
                    {/* 内圈边界 */}
                    <circle 
                        r={r - 6} 
                        fill="none" 
                        stroke={strokeColor} 
                        strokeWidth="5" 
                        opacity={0.6}
                    />
                </>
            ) : (
                <>
                    {/* 其他材质的普通棋子 */}
                    <circle 
                        r={r} 
                        fill={fillColor} 
                        stroke={strokeColor} 
                        strokeWidth={isDark ? 1 : 2} 
                        className="transition-colors duration-300"
                    />
                    
                    {/* Inner Groove */}
                    <circle 
                        r={r - 4} 
                        fill="none" 
                        stroke={strokeColor} 
                        strokeWidth="1" 
                        opacity={0.4} 
                    />
                    
                    {/* 内圈噪声纹理 */}
                    {material === 'wood' && !isDark && (
                        <circle 
                            r={r - 4} 
                            fill={fillColor} 
                            filter={`url(#woodPieceTexture-${uniqueId})`}
                            clipPath={`url(#innerCircle-${uniqueId})`}
                        />
                    )}
                </>
            )}

            {/* Character - 己方棋子文字朝向玩家，敌方棋子文字背向玩家 */}
            <text 
                textAnchor="middle" 
                dy=".35em" 
                fill={charColor} 
                fontSize={fontSize} 
                fontWeight="bold"
                fontFamily="KaiTi, serif"
                style={{ textShadow }}
                transform={shouldRotateText ? 'rotate(180)' : undefined}
            >
                {PIECE_CHARS[type][color]}
            </text>
            
            {/* Shine/Highlight - REMOVED for non-reflective material */}
        </g>
    );
};
