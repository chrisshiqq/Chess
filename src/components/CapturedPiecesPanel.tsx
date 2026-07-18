
import React from 'react';
import { PieceType, Color, Skin, PieceMaterial } from '../types';
import { ChessPiece } from './ChessPiece';

interface SidePanelProps {
    pieces: PieceType[];
    color: Color; // The color of the pieces being displayed
    playerColor: Color; // The player's color, used for determining piece orientation
    label: string;
    isSetupMode?: boolean;
    skin?: Skin;
    material?: PieceMaterial;
    onDragStart?: (e: React.DragEvent, pieceType: PieceType, color: Color) => void;
    onDrop?: (e: React.DragEvent) => void;
    recentlyCaptured?: { color: Color; type: PieceType } | null;
}

// Order by value for "neat arrangement"
const TYPE_ORDER: PieceType[] = ['general', 'chariot', 'cannon', 'horse', 'elephant', 'advisor', 'soldier'];

const sortPieces = (pieces: PieceType[]) => {
    return [...pieces].sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));
};

const SKIN_STYLES: Record<Skin, { bg: string; border: string; text: string; headerBorder: string }> = {
    'stone-board': {
        bg: 'bg-[#d0d0d0]', // 与棋盘的 containerBg 一致
        border: 'border-[#a0a0a0]', // 与棋盘的 border 一致
        text: 'text-[#606060]', // 与棋盘的 coord 一致
        headerBorder: 'border-[#a0a0a0]' // 与棋盘的 border 一致
    },
    'wood-board': {
        bg: 'bg-[#654321]', // 与棋盘的 containerBg 一致
        border: 'border-[#3d2817]', // 与棋盘的 border 一致
        text: 'text-[#DAA520]', // 与棋盘的 grid/coord/river 一致
        headerBorder: 'border-[#3d2817]' // 与棋盘的 border 一致
    },

    'paper-board': {
        bg: 'bg-[#D8C9A8]', // 与棋盘的 containerBg 一致
        border: 'border-[#8B6B42]', // 与棋盘的 border 一致
        text: 'text-[#005AB5]', // 与棋盘的 grid/coord/river 一致
        headerBorder: 'border-[#8B6B42]' // 与棋盘的 border 一致
    },
    'glass-board': {
        bg: 'bg-[#70DBDB]', // 与棋盘的 containerBg 一致
        border: 'border-[#006000]', // 与棋盘的 border 一致
        text: 'text-[#006000]', // 与棋盘的 coord 一致
        headerBorder: 'border-[#006000]' // 与棋盘的 border 一致
    }
};

export const SidePanel: React.FC<SidePanelProps> = ({ pieces, color, playerColor, label, isSetupMode = false, skin = 'stone-board', material = 'stone', onDragStart, onDrop, recentlyCaptured }) => {
    const sortedPieces = sortPieces(pieces);

    const handleDragOver = (e: React.DragEvent) => {
        if (!isSetupMode) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const styles = isSetupMode 
        ? { bg: 'bg-stone-700', border: 'border-stone-500', text: 'text-white', headerBorder: 'border-gray-500' }
        : SKIN_STYLES[skin];

    return (
            <div className={`flex flex-col gap-0 p-0 pt-0 rounded-lg shadow-xl border-2 w-full transition-all duration-500
                    ${styles.bg} ${styles.border}
                `}
                onDragOver={handleDragOver}
                onDrop={(e) => isSetupMode && onDrop && onDrop(e)}
                style={{ 
                    minHeight: isSetupMode ? '180px' : '70px', 
                    maxHeight: isSetupMode ? '180px' : '70px',
                    position: 'relative',
                    resize: isSetupMode ? 'vertical' : 'none',
                    overflow: 'hidden'
                }}
            >
                <div className={`grid gap-0 w-full justify-items-center items-center min-h-[${isSetupMode ? '180px' : '70px'}] ${isSetupMode ? 'grid-cols-4 grid-rows-4' : 'grid-cols-8'} ${isSetupMode ? 'p-0' : ''}`}>
                {sortedPieces.map((type, idx) => {
                    // 检查当前棋子是否是最近被吃的棋子，并且是同类型中最后一个出现的（即最新被吃的）
                    const isRecentlyCaptured = !isSetupMode && recentlyCaptured && 
                        recentlyCaptured.color === color && recentlyCaptured.type === type &&
                        idx === sortedPieces.lastIndexOf(type);
                    
                    return (
                        <div 
                            key={`${color}-${type}-${idx}`} 
                            className={`relative transition-transform
                                ${isSetupMode ? 'w-12 h-12 cursor-grab active:cursor-grabbing hover:scale-105' : 'w-8 h-8 animate-scaleUp'}
                                ${isRecentlyCaptured ? 'animate-rotate' : ''}
                            `}
                            draggable={isSetupMode}
                            onDragStart={(e) => isSetupMode && onDragStart && onDragStart(e, type, color)}
                            style={{
                                // 为最近被吃的棋子添加额外的视觉效果
                                outline: isRecentlyCaptured ? '2px solid white' : 'none',
                                borderRadius: '50%',
                                position: 'relative',
                                // 调整棋子显示大小
                                transform: isSetupMode ? 'scale(1)' : 'none'
                            }}
                        >
                            <svg 
                                width={isSetupMode ? "48" : "32"} 
                                height={isSetupMode ? "48" : "32"} 
                                viewBox={isSetupMode ? "-24 -24 48 48" : "-16 -16 32 32"} 
                                className="overflow-visible pointer-events-none"
                            >
                                <ChessPiece 
                                    type={type} 
                                    color={color} 
                                    size={isSetupMode ? 48 : 32} 
                                    variant={isSetupMode ? 'normal' : 'normal'} 
                                    material={material} 
                                    playerColor={playerColor} 
                                    isRecentlyCaptured={isRecentlyCaptured} 
                                />
                            </svg>
                        </div>
                    );
                })}
                {pieces.length === 0 && <div className={`col-span-${isSetupMode ? '4' : '8'} text-xs text-center italic py-2 opacity-50 ${styles.text}`}>Empty</div>}
            </div>
        </div>
    );
};
