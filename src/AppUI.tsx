import React, { useState, useEffect } from 'react';
import { Board, Color, Position, Move, PieceType, Piece, GameStatusResult, Skin, DifficultyLevel, PieceMaterial } from './types';
import { ChessPiece } from './components/ChessPiece';
import { SKINS } from './components/ChessBoard';

// ClockDisplay component
const ClockDisplay = ({ color, time, isActive, redStepCount, blackStepCount, label, playerColor = 'red' }: { 
    color: Color, 
    time: number, 
    isActive: boolean, 
    redStepCount: number, 
    blackStepCount: number,
    label?: string,
    playerColor?: Color
}) => (
    <div className={`
        flex items-center justify-between px-4 py-2 rounded-lg border-2 shadow-lg transition-all duration-300 w-full
        ${isActive ? 'bg-stone-800 border-amber-500 ring-2 ring-amber-500/30 transform scale-105 z-10' : 'bg-stone-900/60 border-stone-700 opacity-70 grayscale'}
    `}>
        <div className="flex items-center gap-3">
            <div className="flex items-center justify-center">
                <svg width="32" height="32" viewBox="-16 -16 32 32" className="overflow-visible">
                    <ChessPiece 
                        type="general" 
                        color={color} 
                        size={32} 
                        variant="normal"
                        playerColor={color}
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
        requestAnimationFrame(() => {
            setStyle({
                top: targetPos.y,
                left: targetPos.x,
                transform: 'scale(0.6)', 
                opacity: 0,
                transition: 'all 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
            });
        });
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
                <ChessPiece 
                    type={piece.type} 
                    color={piece.color} 
                    size={50} 
                    variant="normal"
                    material={material}
                />
            </svg>
        </div>
    );
};

// MovingPiece component for move animation
const MovingPiece: React.FC<{
    piece: Piece, 
    from: Position, 
    to: Position,
    isFlipped: boolean
}> = ({ piece, from, to, isFlipped }) => {
    // Calculate initial and target positions using 50px cell size (same as chessboard)
    const startY = (isFlipped ? (9 - from.r) : from.r) * 50 + 70; // 70px offset (BOARD_OFFSET)
    const startX = (isFlipped ? (8 - from.c) : from.c) * 50 + 70;
    const targetY = (isFlipped ? (9 - to.r) : to.r) * 50 + 70;
    const targetX = (isFlipped ? (8 - to.c) : to.c) * 50 + 70;
    
    const [style, setStyle] = useState<React.CSSProperties>({
        top: startY,
        left: startX,
        transform: 'scale(1)',
        opacity: 1,
    });

    useEffect(() => {
        requestAnimationFrame(() => {
            setStyle({
                top: targetY,
                left: targetX,
                transform: 'scale(1)',
                opacity: 1,
                transition: 'all 1s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
            });
        });
    }, [startY, startX, targetY, targetX]);

    return (
        <div 
            className="absolute pointer-events-none z-40"
            style={{
                ...style,
                marginTop: -25, 
                marginLeft: -25
            }}
        >
            <svg width="50" height="50" viewBox="-25 -25 50 50" className="overflow-visible">
                <ChessPiece 
                    type={piece.type} 
                    color={piece.color} 
                    size={50} 
                    variant="normal"
                />
            </svg>
        </div>
    );
};

// Export UI components
export { ClockDisplay, FlyingPiece, MovingPiece, formatTime };