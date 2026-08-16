import React from 'react';

const CELL_SIZE = 50;
const BOARD_OFFSET = 50;
const WIDTH = CELL_SIZE * 8 + BOARD_OFFSET * 2;
const HEIGHT = CELL_SIZE * 9 + BOARD_OFFSET * 2;

const CHINESE_NUMS = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];
const ARABIC_NUMS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const WESTERN_LETTERS = ["0", "1", "2", "3", "4", "5", "6", "7", "8"];
const WESTERN_NUMBERS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export const toBoardSVG = (r: number, c: number, flip: boolean) => ({
    x: (flip ? (8 - c) : c) * CELL_SIZE + BOARD_OFFSET,
    y: (flip ? r : (9 - r)) * CELL_SIZE + BOARD_OFFSET
});

interface BoardStaticLayerProps {
    flip: boolean;
    coordinateStyle: 'chinese' | 'western';
    bgColor: string;
    lineColor: string;
    coordColor: string;
    riverColor: string;
    texture?: string;
}

const renderPositionMarkers = (r: number, c: number, flip: boolean, lineColor: string) => {
    const markers = [];
    const { x, y } = toBoardSVG(r, c, flip);
    const markerSize = 6;
    const offset = 4;
    const boardLeft = BOARD_OFFSET;
    const boardRight = BOARD_OFFSET + 8 * CELL_SIZE;
    const boardTop = BOARD_OFFSET;
    const boardBottom = BOARD_OFFSET + 9 * CELL_SIZE;
    const hasTop = y > boardTop;
    const hasBottom = y < boardBottom;
    const hasLeft = x > boardLeft;
    const hasRight = x < boardRight;

    if (hasTop && hasLeft) {
        markers.push(
            <line key={`marker-${r}-${c}-tl-v`} x1={x - offset} y1={y - offset} x2={x - offset} y2={y - offset - markerSize} stroke={lineColor} strokeWidth="2" />,
            <line key={`marker-${r}-${c}-tl-h`} x1={x - offset} y1={y - offset} x2={x - offset - markerSize} y2={y - offset} stroke={lineColor} strokeWidth="2" />
        );
    }
    if (hasTop && hasRight) {
        markers.push(
            <line key={`marker-${r}-${c}-tr-v`} x1={x + offset} y1={y - offset} x2={x + offset} y2={y - offset - markerSize} stroke={lineColor} strokeWidth="2" />,
            <line key={`marker-${r}-${c}-tr-h`} x1={x + offset} y1={y - offset} x2={x + offset + markerSize} y2={y - offset} stroke={lineColor} strokeWidth="2" />
        );
    }
    if (hasBottom && hasLeft) {
        markers.push(
            <line key={`marker-${r}-${c}-bl-v`} x1={x - offset} y1={y + offset} x2={x - offset} y2={y + offset + markerSize} stroke={lineColor} strokeWidth="2" />,
            <line key={`marker-${r}-${c}-bl-h`} x1={x - offset} y1={y + offset} x2={x - offset - markerSize} y2={y + offset} stroke={lineColor} strokeWidth="2" />
        );
    }
    if (hasBottom && hasRight) {
        markers.push(
            <line key={`marker-${r}-${c}-br-v`} x1={x + offset} y1={y + offset} x2={x + offset} y2={y + offset + markerSize} stroke={lineColor} strokeWidth="2" />,
            <line key={`marker-${r}-${c}-br-h`} x1={x + offset} y1={y + offset} x2={x + offset + markerSize} y2={y + offset} stroke={lineColor} strokeWidth="2" />
        );
    }
    return markers;
};

export const BoardStaticLayer = React.memo(({
    flip,
    coordinateStyle,
    bgColor,
    lineColor,
    coordColor,
    riverColor,
    texture
}: BoardStaticLayerProps) => {
    const coords = [];
    if (coordinateStyle === 'chinese') {
        for (let c = 0; c < 9; c++) {
            const redPos = toBoardSVG(0, c, flip);
            coords.push(
                <text key={`coord-red-${c}`} x={redPos.x} y={flip ? redPos.y - 35 : redPos.y + 30} textAnchor="middle" fontSize="18" fill={coordColor} fontWeight="bold" fontFamily="serif">
                    {CHINESE_NUMS[c]}
                </text>
            );
            const blackPos = toBoardSVG(9, c, flip);
            coords.push(
                <text key={`coord-black-${c}`} x={blackPos.x} y={flip ? blackPos.y + 30 : blackPos.y - 35} textAnchor="middle" fontSize="16" fill={coordColor} fontWeight="bold">
                    {ARABIC_NUMS[c]}
                </text>
            );
        }
    } else {
        const calculateFixedPosition = (r: number, c: number, type: 'top' | 'bottom' | 'left' | 'right') => {
            const baseX = BOARD_OFFSET;
            const baseY = BOARD_OFFSET;
            const displayR = flip ? 9 - r : r;
            const displayC = flip ? 8 - c : c;
            const centerX = baseX + displayC * CELL_SIZE;
            const centerY = baseY + displayR * CELL_SIZE;
            switch (type) {
                case 'top': return { x: centerX, y: baseY - 30 };
                case 'bottom': return { x: centerX, y: baseY + 9 * CELL_SIZE + 35 };
                case 'left': return { x: baseX - 30, y: centerY + 8 };
                case 'right': return { x: baseX + 8 * CELL_SIZE + 30, y: centerY + 8 };
                default: return { x: centerX, y: centerY };
            }
        };
        for (let c = 0; c < 9; c++) {
            const bottomPos = calculateFixedPosition(9, c, 'bottom');
            coords.push(
                <text key={`coord-bottom-${c}`} x={bottomPos.x} y={bottomPos.y} textAnchor="middle" fontSize="16" fill={coordColor} fontWeight="bold">
                    {WESTERN_LETTERS[c]}
                </text>
            );
            const topPos = calculateFixedPosition(0, c, 'top');
            coords.push(
                <text key={`coord-top-${c}`} x={topPos.x} y={topPos.y} textAnchor="middle" fontSize="16" fill={coordColor} fontWeight="bold">
                    {WESTERN_LETTERS[c]}
                </text>
            );
        }
        for (let r = 0; r < 10; r++) {
            const redViewRow = 9 - r;
            const leftPos = calculateFixedPosition(r, 0, 'left');
            coords.push(
                <text key={`coord-left-${r}`} x={leftPos.x} y={leftPos.y} textAnchor="middle" fontSize="16" fill={coordColor} fontWeight="bold">
                    {WESTERN_NUMBERS[redViewRow]}
                </text>
            );
            const rightPos = calculateFixedPosition(r, 8, 'right');
            coords.push(
                <text key={`coord-right-${r}`} x={rightPos.x} y={rightPos.y} textAnchor="middle" fontSize="16" fill={coordColor} fontWeight="bold">
                    {WESTERN_NUMBERS[redViewRow]}
                </text>
            );
        }
    }

    const centerY = toBoardSVG(4.5, 4, flip).y;
    const centerX = toBoardSVG(4.5, 4, flip).x;
    const horizontalSpacing = 100;
    const leftSide = flip ? '楚河' : '汉界';
    const rightSide = flip ? '汉界' : '楚河';
    const paperShadow = texture === 'paper'
        ? { textShadow: '2px 2px 3px rgba(0,0,0,0.2)', stroke: riverColor, strokeWidth: '0.5' }
        : { textShadow: 'none' };

    const gridElements = [];
    const lineWidth = "2";
    const borderWidth = "3";
    const shadowWidth = "1";
    const shadowColor = "rgba(0, 0, 0, 0.3)";

    for (let r = 0; r < 9; r++) {
        if (r === 4) continue;
        for (let c = 0; c < 8; c++) {
            const displayR = flip ? 8 - r : r;
            const displayC = flip ? 8 - (c + 1) : c;
            const rectX = BOARD_OFFSET + displayC * CELL_SIZE;
            const rectY = BOARD_OFFSET + displayR * CELL_SIZE;
            let fillColor = "transparent";
            if (texture === 'glass') {
                if (r >= 0 && r <= 3) {
                    fillColor = (r + c) % 2 === 0 ? "#faf7f7ff" : "#246525ff";
                } else if (r >= 5 && r <= 8) {
                    fillColor = (r + c) % 2 === 1 ? "#faf7f7ff" : "#246525ff";
                }
            }
            gridElements.push(
                <rect key={`grid-${r}-${c}`} x={rectX} y={rectY} width={CELL_SIZE} height={CELL_SIZE} fill={fillColor} stroke="none" />
            );
            gridElements.push(
                <line key={`edge-${r}-${c}-top-shadow`} x1={rectX} y1={rectY + 1} x2={rectX + CELL_SIZE} y2={rectY + 1} stroke={shadowColor} strokeWidth={shadowWidth} />,
                <line key={`edge-${r}-${c}-top`} x1={rectX} y1={rectY} x2={rectX + CELL_SIZE} y2={rectY} stroke={lineColor} strokeWidth={lineWidth} />,
                <line key={`edge-${r}-${c}-right-shadow`} x1={rectX + CELL_SIZE - 1} y1={rectY} x2={rectX + CELL_SIZE - 1} y2={rectY + CELL_SIZE} stroke={shadowColor} strokeWidth={shadowWidth} />,
                <line key={`edge-${r}-${c}-right`} x1={rectX + CELL_SIZE} y1={rectY} x2={rectX + CELL_SIZE} y2={rectY + CELL_SIZE} stroke={lineColor} strokeWidth={lineWidth} />,
                <line key={`edge-${r}-${c}-bottom-shadow`} x1={rectX} y1={rectY + CELL_SIZE - 1} x2={rectX + CELL_SIZE} y2={rectY + CELL_SIZE - 1} stroke={shadowColor} strokeWidth={shadowWidth} />,
                <line key={`edge-${r}-${c}-bottom`} x1={rectX} y1={rectY + CELL_SIZE} x2={rectX + CELL_SIZE} y2={rectY + CELL_SIZE} stroke={lineColor} strokeWidth={lineWidth} />,
                <line key={`edge-${r}-${c}-left-shadow`} x1={rectX + 1} y1={rectY} x2={rectX + 1} y2={rectY + CELL_SIZE} stroke={shadowColor} strokeWidth={shadowWidth} />,
                <line key={`edge-${r}-${c}-left`} x1={rectX} y1={rectY} x2={rectX} y2={rectY + CELL_SIZE} stroke={lineColor} strokeWidth={lineWidth} />
            );
        }
    }

    gridElements.push(
        <rect key="river" x={BOARD_OFFSET} y={BOARD_OFFSET + CELL_SIZE * 4} width={CELL_SIZE * 8} height={CELL_SIZE} fill="transparent" stroke="none" />
    );
    const tl = toBoardSVG(0, 0, flip);
    const bl = toBoardSVG(9, 0, flip);
    const tr = toBoardSVG(0, 8, flip);
    const br = toBoardSVG(9, 8, flip);
    gridElements.push(<line key="b-left" x1={tl.x} y1={tl.y} x2={bl.x} y2={bl.y} stroke={lineColor} strokeWidth={borderWidth} />);
    gridElements.push(<line key="b-right" x1={tr.x} y1={tr.y} x2={br.x} y2={br.y} stroke={lineColor} strokeWidth={borderWidth} />);
    gridElements.push(<line key="p-b-1" x1={toBoardSVG(0, 3, flip).x} y1={toBoardSVG(0, 3, flip).y} x2={toBoardSVG(2, 5, flip).x} y2={toBoardSVG(2, 5, flip).y} stroke={lineColor} strokeWidth={borderWidth} strokeDasharray="5,5" />);
    gridElements.push(<line key="p-b-2" x1={toBoardSVG(0, 5, flip).x} y1={toBoardSVG(0, 5, flip).y} x2={toBoardSVG(2, 3, flip).x} y2={toBoardSVG(2, 3, flip).y} stroke={lineColor} strokeWidth={borderWidth} strokeDasharray="5,5" />);
    gridElements.push(<line key="p-r-1" x1={toBoardSVG(9, 3, flip).x} y1={toBoardSVG(9, 3, flip).y} x2={toBoardSVG(7, 5, flip).x} y2={toBoardSVG(7, 5, flip).y} stroke={lineColor} strokeWidth={borderWidth} strokeDasharray="5,5" />);
    gridElements.push(<line key="p-r-2" x1={toBoardSVG(9, 5, flip).x} y1={toBoardSVG(9, 5, flip).y} x2={toBoardSVG(7, 3, flip).x} y2={toBoardSVG(7, 3, flip).y} stroke={lineColor} strokeWidth={borderWidth} strokeDasharray="5,5" />);
    gridElements.push(
        ...renderPositionMarkers(2, 1, flip, lineColor),
        ...renderPositionMarkers(2, 7, flip, lineColor),
        ...renderPositionMarkers(7, 1, flip, lineColor),
        ...renderPositionMarkers(7, 7, flip, lineColor),
        ...renderPositionMarkers(3, 0, flip, lineColor),
        ...renderPositionMarkers(3, 2, flip, lineColor),
        ...renderPositionMarkers(3, 4, flip, lineColor),
        ...renderPositionMarkers(3, 6, flip, lineColor),
        ...renderPositionMarkers(3, 8, flip, lineColor),
        ...renderPositionMarkers(6, 0, flip, lineColor),
        ...renderPositionMarkers(6, 2, flip, lineColor),
        ...renderPositionMarkers(6, 4, flip, lineColor),
        ...renderPositionMarkers(6, 6, flip, lineColor),
        ...renderPositionMarkers(6, 8, flip, lineColor)
    );

    return (
        <g>
            <defs>
                <radialGradient id="spotlight" cx="50%" cy="50%" r="60%">
                    <stop offset="0%" stopColor="white" stopOpacity="0.3" />
                    <stop offset="40%" stopColor="white" stopOpacity="0.1" />
                    <stop offset="70%" stopColor="black" stopOpacity="0.1" />
                    <stop offset="100%" stopColor="black" stopOpacity="0.3" />
                </radialGradient>
                {texture === 'stone' && (
                    <filter id="stoneTexture" x="0%" y="0%" width="100%" height="100%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.015 0.035" numOctaves="6" seed="100" result="mainVeins" />
                        <feColorMatrix in="mainVeins" type="matrix" values="0.6 0.6 0.6 0 0 0.6 0.6 0.6 0 0 0.6 0.6 0.6 0 0 0 0 0 1 0" result="grayVeins" />
                        <feComponentTransfer in="grayVeins" result="grayContrast">
                            <feFuncR type="linear" slope="2.5" intercept="-0.6" />
                            <feFuncG type="linear" slope="2.5" intercept="-0.6" />
                            <feFuncB type="linear" slope="2.5" intercept="-0.6" />
                            <feFuncA type="discrete" tableValues="0 0.25 0.4 0.3 0.2" />
                        </feComponentTransfer>
                        <feTurbulence type="turbulence" baseFrequency="0.025 0.02" numOctaves="4" seed="150" result="brownSpots" />
                        <feColorMatrix in="brownSpots" type="matrix" values="0.8 0.4 0.2 0 0 0.6 0.3 0.15 0 0 0.4 0.2 0.1 0 0 0 0 0 1 0" result="brownColor" />
                        <feComponentTransfer in="brownColor" result="brownContrast">
                            <feFuncR type="linear" slope="2.0" intercept="-0.5" />
                            <feFuncG type="linear" slope="2.0" intercept="-0.5" />
                            <feFuncB type="linear" slope="2.0" intercept="-0.5" />
                            <feFuncA type="discrete" tableValues="0 0.15 0.25 0.15" />
                        </feComponentTransfer>
                        <feTurbulence type="fractalNoise" baseFrequency="0.08 0.1" numOctaves="3" seed="200" result="fineLines" />
                        <feColorMatrix in="fineLines" type="saturate" values="0" result="fineGray" />
                        <feComponentTransfer in="fineGray" result="fineContrast">
                            <feFuncR type="linear" slope="3.0" intercept="-1.0" />
                            <feFuncG type="linear" slope="3.0" intercept="-1.0" />
                            <feFuncB type="linear" slope="3.0" intercept="-1.0" />
                            <feFuncA type="discrete" tableValues="0 0.1 0.15 0.1" />
                        </feComponentTransfer>
                        <feBlend mode="multiply" in="grayContrast" in2="SourceGraphic" result="layer1" />
                        <feBlend mode="multiply" in="brownContrast" in2="layer1" result="layer2" />
                        <feBlend mode="darken" in="fineContrast" in2="layer2" result="final" />
                        <feComposite operator="in" in="final" in2="SourceGraphic" />
                    </filter>
                )}
                {texture === 'wood' && (
                    <filter id="woodTexture" x="0%" y="0%" width="100%" height="100%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.01 0.1" numOctaves="8" seed="50" result="woodNoise" />
                        <feColorMatrix in="woodNoise" type="saturate" values="0.4" result="woodColor" />
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
                {texture === 'paper' && (
                    <>
                        <filter id="paperTexture" x="0%" y="0%" width="100%" height="100%">
                            <feTurbulence type="fractalNoise" baseFrequency="0.8 0.6" numOctaves="4" seed="100" result="paperNoise" />
                            <feColorMatrix in="paperNoise" type="matrix" values="0.95 0.8 0.6 0 0 0.9 0.75 0.5 0 0 0.85 0.7 0.4 0 0 0 0 0 1 0" result="paperColor" />
                            <feComponentTransfer in="paperColor" result="paperContrast">
                                <feFuncR type="linear" slope="1.2" intercept="0.1" />
                                <feFuncG type="linear" slope="1.2" intercept="0.1" />
                                <feFuncB type="linear" slope="1.2" intercept="0.1" />
                                <feFuncA type="discrete" tableValues="0 0.05 0.08 0.06" />
                            </feComponentTransfer>
                            <feTurbulence type="fractalNoise" baseFrequency="0.02 0.01" numOctaves="3" seed="200" result="foldLines" />
                            <feColorMatrix in="foldLines" type="saturate" values="0" result="foldGray" />
                            <feComponentTransfer in="foldGray" result="foldContrast">
                                <feFuncR type="linear" slope="2.0" intercept="-0.5" />
                                <feFuncG type="linear" slope="2.0" intercept="-0.5" />
                                <feFuncB type="linear" slope="2.0" intercept="-0.5" />
                                <feFuncA type="discrete" tableValues="0 0.15 0.2 0.1" />
                            </feComponentTransfer>
                            <feBlend mode="multiply" in="paperContrast" in2="SourceGraphic" result="baseLayer" />
                            <feBlend mode="overlay" in="foldContrast" in2="baseLayer" result="finalTexture" />
                            <feComposite operator="in" in="finalTexture" in2="SourceGraphic" />
                        </filter>
                        <filter id="paperEdge" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="8" result="blur" />
                            <feColorMatrix type="matrix" values="0.8 0.6 0.4 0 0 0.7 0.5 0.3 0 0 0.6 0.4 0.2 0 0 0 0 0 0.3 0" result="agedEdge" />
                            <feComposite operator="over" in="agedEdge" in2="SourceGraphic" />
                        </filter>
                    </>
                )}
                {texture === 'glass' && (
                    <filter id="glassTexture" x="-50%" y="-50%" width="200%" height="200%">
                        <feFlood floodColor="#70DBDB" floodOpacity="0.7" result="glassBase" />
                        <feTurbulence type="fractalNoise" baseFrequency="0.03125 0.01875" numOctaves="1" seed="300" result="glassNoise" />
                        <feColorMatrix in="glassNoise" type="matrix" values="0.655 0.2 0.1 0 0 0.25 0.424 0.1 0 0 0.35 0.15 0.616 0 0 0 0 0 1 0" result="glassTint" />
                        <feComponentTransfer in="glassTint" result="glassContrast">
                            <feFuncR type="linear" slope="1.2" intercept="0.05" />
                            <feFuncG type="linear" slope="1.2" intercept="0.05" />
                            <feFuncB type="linear" slope="1.2" intercept="0.05" />
                            <feFuncA type="discrete" tableValues="0 0.3 0.5 0.4" />
                        </feComponentTransfer>
                        <feBlend mode="multiply" in="glassBase" in2="SourceGraphic" result="baseLayer" />
                        <feComposite operator="in" in="baseLayer" in2="SourceGraphic" />
                    </filter>
                )}
            </defs>

            <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill={bgColor} fillOpacity="1" filter={texture ? `url(#${texture}Texture)` : undefined} />
            <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="url(#spotlight)" opacity="0.8" />

            {texture === 'glass' && (
                <>
                    <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="none" stroke="#70DBDB" strokeWidth="15" opacity="0.4" filter="url(#glassTexture)" />
                    <ellipse cx={WIDTH * 0.3} cy={HEIGHT * 0.4} rx={WIDTH * 0.4} ry={HEIGHT * 0.3} fill="rgba(255, 255, 255, 0.1)" opacity="0.2" />
                    <path
                        d={`M 0 0 Q ${WIDTH * 0.2} ${HEIGHT * 0.1}, ${WIDTH * 0.5} 0 T ${WIDTH} 0 L ${WIDTH} ${HEIGHT * 0.1} Q ${WIDTH * 0.8} ${HEIGHT * 0.2}, ${WIDTH * 0.5} ${HEIGHT * 0.1} T 0 ${HEIGHT * 0.1} Z`}
                        fill="rgba(255, 255, 255, 0.1)"
                        opacity="0.3"
                    />
                    <path
                        d={`M 0 ${HEIGHT} Q ${WIDTH * 0.2} ${HEIGHT * 0.9}, ${WIDTH * 0.5} ${HEIGHT} T ${WIDTH} ${HEIGHT} L ${WIDTH} ${HEIGHT * 0.9} Q ${WIDTH * 0.8} ${HEIGHT * 0.8}, ${WIDTH * 0.5} ${HEIGHT * 0.9} T 0 ${HEIGHT * 0.9} Z`}
                        fill="rgba(255, 255, 255, 0.08)"
                        opacity="0.3"
                    />
                </>
            )}

            {texture === 'paper' && (
                <>
                    <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="none" stroke="#A68B5B" strokeWidth="15" opacity="0.3" filter="url(#paperEdge)" />
                    <g opacity="0.15">
                        <line x1="0" y1={HEIGHT * 0.5} x2={WIDTH} y2={HEIGHT * 0.5} stroke="#8B4513" strokeWidth="3" strokeDasharray="15,8" />
                        <line x1={WIDTH * 0.5} y1="0" x2={WIDTH * 0.5} y2={HEIGHT} stroke="#8B4513" strokeWidth="2.5" strokeDasharray="12,10" />
                        <line x1="0" y1="0" x2={WIDTH} y2={HEIGHT} stroke="#A68B5B" strokeWidth="1.8" strokeDasharray="20,15" />
                        <line x1={WIDTH} y1="0" x2="0" y2={HEIGHT} stroke="#A68B5B" strokeWidth="1.8" strokeDasharray="18,12" />
                    </g>
                </>
            )}

            {gridElements}
            {coords}
            <text x={centerX - horizontalSpacing - 10} y={centerY} textAnchor="middle" fill={riverColor} opacity="0.7" fontSize="32" fontWeight="bold" fontFamily="serif" style={paperShadow} transform={`rotate(-90, ${centerX - horizontalSpacing - 10}, ${centerY})`}>
                {leftSide === '楚河' ? '楚' : '漢'}
            </text>
            <text x={centerX - horizontalSpacing + 25} y={centerY} textAnchor="middle" fill={riverColor} opacity="0.7" fontSize="32" fontWeight="bold" fontFamily="serif" style={paperShadow} transform={`rotate(-90, ${centerX - horizontalSpacing + 25}, ${centerY})`}>
                {leftSide === '楚河' ? '河' : '界'}
            </text>
            <text x={centerX + horizontalSpacing - 25} y={centerY} textAnchor="middle" fill={riverColor} opacity="0.7" fontSize="32" fontWeight="bold" fontFamily="serif" style={paperShadow} transform={`rotate(90, ${centerX + horizontalSpacing - 25}, ${centerY})`}>
                {rightSide === '楚河' ? '河' : '界'}
            </text>
            <text x={centerX + horizontalSpacing + 10} y={centerY} textAnchor="middle" fill={riverColor} opacity="0.7" fontSize="32" fontWeight="bold" fontFamily="serif" style={paperShadow} transform={`rotate(90, ${centerX + horizontalSpacing + 10}, ${centerY})`}>
                {rightSide === '楚河' ? '楚' : '漢'}
            </text>
        </g>
    );
});
