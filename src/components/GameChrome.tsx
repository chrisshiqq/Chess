import React, { memo } from 'react';
import { GameClockDisplay } from '../AppUI';
import { Color, PieceType } from '../domain/types';
import { PieceMaterial } from '../ui/types';
import { SidePanel } from './CapturedPiecesPanel';
import { EvaluationPanel } from './EvaluationPanel';

export type GameTab = 'game' | 'replay' | 'setup' | 'settings' | 'stats';

type OnlineSummary = {
    roomCode: string;
    peerNick?: string | null;
    myColor: Color;
} | null;

export const GameModeNav = memo(({
    activeTab,
    onlineInfo,
    isThinking,
    onGame,
    onReplay,
    onSetup,
    onSettings,
    onLeave,
}: {
    activeTab: GameTab;
    onlineInfo: OnlineSummary;
    isThinking: boolean;
    onGame: () => void;
    onReplay: () => void;
    onSetup: () => void;
    onSettings: () => void;
    onLeave: () => void;
}) => (
    <div className="w-full mb-3 max-w-[500px] mx-auto">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-stone-400 px-1">
            <span>
                {onlineInfo ? (
                    <>
                        Online · Room{' '}
                        <span className="font-mono text-amber-400 tracking-wider">
                            {onlineInfo.roomCode.toUpperCase()}
                        </span>
                        {onlineInfo.peerNick ? ` · vs ${onlineInfo.peerNick}` : ''}
                        {' · '}
                        {onlineInfo.myColor === 'red' ? 'Playing Red' : 'Playing Black'}
                    </>
                ) : 'Local game'}
            </span>
            <button type="button" onClick={onLeave} className="text-rose-300 hover:text-rose-200 font-semibold">
                Leave
            </button>
        </div>
        <div className="flex gap-1">
            <ModeButton active={activeTab === 'game'} onClick={onGame}>Game</ModeButton>
            <ModeButton active={activeTab === 'replay'} onClick={onReplay}>Replay</ModeButton>
            <ModeButton active={activeTab === 'setup'} onClick={onSetup} disabled={isThinking}>Setup</ModeButton>
            <ModeButton active={activeTab === 'settings'} onClick={onSettings}>Setting</ModeButton>
        </div>
    </div>
));

const ModeButton = ({ active, disabled = false, onClick, children }: {
    active: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-xs transition-[color,background-color,opacity] ${
            active ? 'bg-amber-600 text-white' : 'bg-stone-700 text-stone-400 hover:bg-stone-600'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
        {children}
    </button>
);

type Evaluation = React.ComponentProps<typeof EvaluationPanel>['evaluation'];
type PanelDragHandler = (event: React.DragEvent, pieceType: PieceType, color: Color) => void;

export const PlayerSidebar = memo(({
    playerColor,
    isSetupMode,
    isReplaying,
    replayIndex,
    redStepCount,
    blackStepCount,
    topPanelColor,
    topPanelPieces,
    bottomPanelColor,
    bottomPanelPieces,
    material,
    recentlyCaptured,
    evaluation,
    opponentPanelRef,
    ownPanelRef,
    onDragStart,
    onDropRed,
    onDropBlack,
}: {
    playerColor: Color;
    isSetupMode: boolean;
    isReplaying: boolean;
    replayIndex: number;
    redStepCount: number;
    blackStepCount: number;
    topPanelColor: Color;
    topPanelPieces: PieceType[];
    bottomPanelColor: Color;
    bottomPanelPieces: PieceType[];
    material: PieceMaterial;
    recentlyCaptured: { color: Color; type: PieceType } | null;
    evaluation: Evaluation;
    opponentPanelRef: React.RefObject<HTMLDivElement | null>;
    ownPanelRef: React.RefObject<HTMLDivElement | null>;
    onDragStart: PanelDragHandler;
    onDropRed: (event: React.DragEvent) => void;
    onDropBlack: (event: React.DragEvent) => void;
}) => {
    const opponentColor: Color = playerColor === 'red' ? 'black' : 'red';
    const shownRedSteps = isReplaying ? Math.ceil(replayIndex / 2) : redStepCount;
    const shownBlackSteps = isReplaying ? Math.floor(replayIndex / 2) : blackStepCount;
    const opponentPieces = topPanelColor === opponentColor ? topPanelPieces : bottomPanelPieces;
    const ownPieces = topPanelColor === playerColor ? topPanelPieces : bottomPanelPieces;
    const dropFor = (color: Color) => color === 'red' ? onDropRed : onDropBlack;

    return (
        <div className="contents lg:flex lg:flex-col lg:h-[550px] lg:w-[300px] lg:order-1">
            <div className="order-1 w-full flex flex-col gap-2 lg:h-[275px] lg:justify-end">
                <div className={isSetupMode ? 'hidden lg:block' : undefined}>
                    <GameClockDisplay color={opponentColor} redStepCount={shownRedSteps} blackStepCount={shownBlackSteps} />
                </div>
                {!isSetupMode ? (
                    <div ref={opponentPanelRef} className="w-full">
                        <SidePanel color={opponentColor} playerColor={playerColor} pieces={opponentPieces} material={material}
                            onDragStart={onDragStart} onDrop={dropFor(opponentColor)} recentlyCaptured={recentlyCaptured} />
                    </div>
                ) : (
                    <div className="lg:hidden">
                        <SidePanel color={topPanelColor} playerColor={playerColor} pieces={topPanelPieces} isSetupMode material={material}
                            onDragStart={onDragStart} onDrop={dropFor(topPanelColor)} recentlyCaptured={recentlyCaptured} />
                    </div>
                )}
                <div className="hidden lg:block"><EvaluationPanel color={opponentColor} evaluation={evaluation} /></div>
            </div>

            <div className="order-3 w-full flex flex-col gap-2 lg:h-[275px] lg:justify-start">
                <div className="hidden lg:block"><EvaluationPanel color={playerColor} evaluation={evaluation} /></div>
                {!isSetupMode ? (
                    <div ref={ownPanelRef} className="w-full">
                        <SidePanel color={playerColor} playerColor={playerColor} pieces={ownPieces} material={material}
                            onDragStart={onDragStart} onDrop={dropFor(playerColor)} recentlyCaptured={recentlyCaptured} />
                    </div>
                ) : (
                    <div className="lg:hidden">
                        <SidePanel color={bottomPanelColor} playerColor={playerColor} pieces={bottomPanelPieces} isSetupMode material={material}
                            onDragStart={onDragStart} onDrop={dropFor(bottomPanelColor)} recentlyCaptured={recentlyCaptured} />
                    </div>
                )}
                <div className={isSetupMode ? 'hidden lg:block' : undefined}>
                    <GameClockDisplay color={playerColor} redStepCount={shownRedSteps} blackStepCount={shownBlackSteps} />
                </div>
            </div>
        </div>
    );
});

export const DesktopSetupSupply = memo(({
    playerColor,
    topPanelColor,
    topPanelPieces,
    bottomPanelPieces,
    material,
    recentlyCaptured,
    onDragStart,
    onDropRed,
    onDropBlack,
}: {
    playerColor: Color;
    topPanelColor: Color;
    topPanelPieces: PieceType[];
    bottomPanelPieces: PieceType[];
    material: PieceMaterial;
    recentlyCaptured: { color: Color; type: PieceType } | null;
    onDragStart: PanelDragHandler;
    onDropRed: (event: React.DragEvent) => void;
    onDropBlack: (event: React.DragEvent) => void;
}) => (
    <div className="hidden lg:block">
        <SidePanel color="black" playerColor={playerColor}
            pieces={topPanelColor === 'black' ? topPanelPieces : bottomPanelPieces}
            isSetupMode material={material} onDragStart={onDragStart} onDrop={onDropBlack}
            recentlyCaptured={recentlyCaptured} />
        <SidePanel color="red" playerColor={playerColor}
            pieces={topPanelColor === 'red' ? topPanelPieces : bottomPanelPieces}
            isSetupMode material={material} onDragStart={onDragStart} onDrop={onDropRed}
            recentlyCaptured={recentlyCaptured} />
    </div>
));
