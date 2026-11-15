import React from 'react';

interface PlayerEvaluation {
  total: number;
  material: number;
  position: number;
  mobility: number;
  threat: number;
  safety: number;
}

interface EvaluationPanelProps {
  color: 'red' | 'black';
  evaluation: {
    pre: {
      red: PlayerEvaluation;
      black: PlayerEvaluation;
    };
    post: {
      red: PlayerEvaluation;
      black: PlayerEvaluation;
    };
    diff: {
      red: PlayerEvaluation;
      black: PlayerEvaluation;
    };
  };
}

export const EvaluationPanel: React.FC<EvaluationPanelProps> = ({ 
  color, 
  evaluation 
}) => {
  // 添加空值检查和默认值处理
  const safeEvaluation = {
    pre: evaluation?.pre || { 
      red: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0 },
      black: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0 }
    },
    post: evaluation?.post || { 
      red: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0 },
      black: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0 }
    },
    diff: evaluation?.diff || { 
      red: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0 },
      black: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0 }
    }
  };
  
  // 获取当前颜色的评估数据
  const playerEval = {
    pre: safeEvaluation.pre[color],
    post: safeEvaluation.post[color],
    diff: safeEvaluation.diff[color]
  };
  
  // 获取对手颜色和净胜分
  const opponentColor = color === 'red' ? 'black' : 'red';
  const opponentTotal = safeEvaluation.post[opponentColor].total;
  const netWinScore = playerEval.post.total - opponentTotal;
  
  return (
    <div className="bg-stone-900/50 p-2 rounded-lg border border-stone-700">
      {/* 所有行共用一个 4 列 grid → 列严格对齐 */}
      <div className="grid grid-cols-4 gap-0.5 text-xs">
        {/* Header 行 */}
        <span className={`font-bold leading-tight text-center ${netWinScore > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {netWinScore > 0 ? '+' : ''}{netWinScore.toFixed(1)}
        </span>
        <span className="text-stone-400 leading-tight text-center">Before</span>
        <span className="text-stone-400 leading-tight text-center">After</span>
        <span className="text-stone-400 leading-tight text-center">Diff</span>

        {/* Total Score 行 */}
        <span className="font-semibold text-stone-300 leading-none">
          {color.toUpperCase()}
        </span>
        <span className={`font-bold leading-none text-right ${playerEval.pre.total > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {playerEval.pre.total.toFixed(1)}
        </span>
        <span className={`font-bold leading-none text-right ${playerEval.post.total > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {playerEval.post.total.toFixed(1)}
        </span>
        <span className={`font-bold leading-none text-right ${playerEval.diff.total > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {playerEval.diff.total > 0 ? '+' : ''}{playerEval.diff.total.toFixed(1)}
        </span>

        {/* Score Breakdown 行 */}
        {(['material', 'position', 'mobility', 'threat', 'safety'] as const).map((key) => {
          const preValue = Number(playerEval.pre[key] || 0);
          const postValue = Number(playerEval.post[key] || 0);
          const diffValue = Number(playerEval.diff[key] || 0);
          return [
            <span key={`l-${key}`} className="text-stone-400 capitalize leading-none">{key}</span>,
            <span key={`p-${key}`} className={`font-bold leading-none text-right ${preValue > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {preValue.toFixed(1)}
            </span>,
            <span key={`o-${key}`} className={`font-bold leading-none text-right ${postValue > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {postValue.toFixed(1)}
            </span>,
            <span key={`d-${key}`} className={`font-bold leading-none text-right ${diffValue > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {diffValue > 0 ? '+' : ''}{diffValue.toFixed(1)}
            </span>,
          ];
        }).flat()}
      </div>
    </div>
  );
};
