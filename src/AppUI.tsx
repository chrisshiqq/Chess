import React, { useState, useEffect, useId } from 'react';
import { Color, Position, Piece } from './domain/types';
import { PieceMaterial } from './ui/types';
import { ChessPiece, PieceMaterialDefs } from './components/ChessPiece';

// ClockDisplay component
const ClockDisplay = ({ color, time, isActive, redStepCount, blackStepCount }: {
    color: Color, 
    time: number, 
    isActive: boolean, 
    redStepCount: number, 
    blackStepCount: number
}) => {
    const materialIdPrefix = `clock-${useId().replace(/:/g, '')}`;
    return (
    <div className={`
        flex items-center justify-between px-4 py-2 rounded-lg border-2 shadow-lg transition-all duration-300 w-full
        ${isActive ? 'bg-stone-800 border-amber-500 ring-2 ring-amber-500/30 transform scale-105 z-10' : 'bg-stone-900/60 border-stone-700 opacity-70 grayscale'}
    `}>
        <div className="flex items-center gap-3">
            <div className="flex items-center justify-center">
                <svg width="32" height="32" viewBox="-16 -16 32 32" className="overflow-visible">
                    <PieceMaterialDefs idPrefix={materialIdPrefix} />
                    <ChessPiece 
                        type="general" 
                        color={color} 
                        size={32} 
                        variant="normal"
                        playerColor={color}
                        materialIdPrefix={materialIdPrefix}
                    />
                </svg>
            </div>
            <span className={`text-base font-semibold ${isActive ? 'text-amber-400' : 'text-stone-500'} ml-3`}>
                # {color === 'red' ? redStepCount : blackStepCount}
            </span>
        </div>
        <span className={`font-mono text-lg font-bold tracking-widest ${isActive ? 'text-white' : 'text-stone-400'}`}>
            {formatTime(time)}
        </span>
    </div>
    );
};

// Helper function to format time
const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// FlyingPiece component
const FlyingPiece: React.FC<{
    piece: Piece, 
    startPos: Position, 
    targetPos: {x: number, y: number},
    isFlipped: boolean,
    material?: PieceMaterial
}> = ({ piece, startPos, targetPos, isFlipped, material = 'wood' }) => {
    const materialIdPrefix = `flying-${useId().replace(/:/g, '')}`;
    // 使用与ChessBoard组件相同的坐标计算逻辑
    const CELL_SIZE = 50;
    const BOARD_OFFSET = 50;
    
    // 计算正确的起点坐标，与ChessBoard的toSVG函数逻辑一致
    const [style, setStyle] = useState<React.CSSProperties>({
        top: (isFlipped ? startPos.r : (9 - startPos.r)) * CELL_SIZE + BOARD_OFFSET,
        left: (isFlipped ? (8 - startPos.c) : startPos.c) * CELL_SIZE + BOARD_OFFSET,
        transform: 'scale(1)',
        opacity: 1,
    });

    useEffect(() => {
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => {
                setStyle({
                    top: targetPos.y,
                    left: targetPos.x,
                    transform: 'scale(0.6)',
                    opacity: 0,
                    transition: 'all 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
                });
            });
        });
        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
        };
    }, [targetPos]);

    return (
        <div 
            className="absolute pointer-events-none z-30"
            style={{
                ...style,
                marginTop: -25, 
                marginLeft: -25
            }}
        >
            <svg width="50" height="50" viewBox="-25 -25 50 50" className="overflow-visible">
                <PieceMaterialDefs idPrefix={materialIdPrefix} />
                <ChessPiece 
                    type={piece.type} 
                    color={piece.color} 
                    size={50} 
                    variant="normal"
                    material={material}
                    materialIdPrefix={materialIdPrefix}
                />
            </svg>
        </div>
    );
};

// Export UI components
export { ClockDisplay, FlyingPiece };
