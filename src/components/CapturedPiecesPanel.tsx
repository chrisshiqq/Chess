
import React, { useId } from 'react';
import { PieceType, Color } from '../domain/types';
import { PieceMaterial } from '../ui/types';
import { ChessPiece, PieceMaterialDefs } from './ChessPiece';

interface SidePanelProps {
    pieces: PieceType[];
    color: Color; // The color of the pieces being displayed
    playerColor: Color; // The player's color, used for determining piece orientation
    isSetupMode?: boolean;
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

export const SidePanel: React.FC<SidePanelProps> = ({ pieces, color, playerColor, isSetupMode = false, material = 'stone', onDragStart, onDrop, recentlyCaptured }) => {
    const sortedPieces = sortPieces(pieces);
    const materialIdBase = `captured-${useId().replace(/:/g, '')}`;

    const handleDragOver = (e: React.DragEvent) => {
        if (!isSetupMode) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    // Match EvaluationPanel / settings panels: stone chrome, not board-skin colors
    const styles = {
        bg: 'bg-stone-900/50',
        border: 'border-stone-700',
        text: 'text-stone-400',
    };

    const setupHeightClass = 'min-h-[110px] max-h-[110px] lg:min-h-[180px] lg:max-h-[180px]';
    const capturedHeightClass = 'min-h-[70px] max-h-[70px]';

    return (
            <div className={`flex flex-col gap-0 p-0 pt-0 rounded-lg border w-full transition-all duration-500
                    ${styles.bg} ${styles.border}
                    ${isSetupMode ? setupHeightClass : capturedHeightClass}
                `}
                onDragOver={handleDragOver}
                onDrop={(e) => isSetupMode && onDrop && onDrop(e)}
                style={{ 
                    position: 'relative',
                    resize: isSetupMode ? 'vertical' : 'none',
                    overflow: 'hidden'
                }}
            >
                <div className={`grid gap-0 w-full justify-items-center items-center ${isSetupMode ? `${setupHeightClass} grid-cols-8 grid-rows-2 lg:grid-cols-4 lg:grid-rows-4 p-0` : `${capturedHeightClass} grid-cols-8`}`}>
                {sortedPieces.map((type, idx) => {
                    const materialIdPrefix = `${materialIdBase}-${color}-${type}-${idx}`;
                    // 检查当前棋子是否是最近被吃的棋子，并且是同类型中最后一个出现的（即最新被吃的）
                    const isRecentlyCaptured = !isSetupMode && recentlyCaptured && 
                        recentlyCaptured.color === color && recentlyCaptured.type === type &&
                        idx === sortedPieces.lastIndexOf(type);
                    
                    return (
                        <div 
                            key={`${color}-${type}-${idx}`} 
                            className={`relative transition-transform
                                ${isSetupMode ? 'w-10 h-10 lg:w-12 lg:h-12 cursor-grab active:cursor-grabbing hover:scale-105' : 'w-8 h-8 animate-scaleUp'}
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
                                className={`overflow-visible pointer-events-none ${isSetupMode ? 'w-10 h-10 lg:w-12 lg:h-12' : ''}`}
                            >
                                <PieceMaterialDefs idPrefix={materialIdPrefix} />
                                <ChessPiece 
                                    type={type} 
                                    color={color} 
                                    size={isSetupMode ? 48 : 32} 
                                    variant={isSetupMode ? 'normal' : 'normal'} 
                                    material={material} 
                                    playerColor={playerColor} 
                                    isRecentlyCaptured={isRecentlyCaptured} 
                                    materialIdPrefix={materialIdPrefix}
                                />
                            </svg>
                        </div>
                    );
                })}
                {pieces.length === 0 && (
                    <div className={`${isSetupMode ? 'col-span-8 lg:col-span-4' : 'col-span-8'} text-xs text-center italic py-2 opacity-50 ${styles.text}`}>
                        Empty
                    </div>
                )}
            </div>
        </div>
    );
};
