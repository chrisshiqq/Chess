import React from 'react';

interface PlayerEvaluation {
  total: number;
  material: number;
  position: number;
  mobility: number;
  threat: number;
  safety: number;
  tactic: number;
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
      red: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0, tactic: 0 },
      black: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0, tactic: 0 }
    },
    post: evaluation?.post || { 
      red: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0, tactic: 0 },
      black: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0, tactic: 0 }
    },
    diff: evaluation?.diff || { 
      red: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0, tactic: 0 },
      black: { total: 0, material: 0, position: 0, mobility: 0, threat: 0, safety: 0, tactic: 0 }
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
      <div className="space-y-1">
        {/* Evaluation Header */}
        <div className="grid grid-cols-4 gap-0.5 text-center">
          <span className={`text-xs font-bold leading-tight ${netWinScore > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {netWinScore > 0 ? '+' : ''}{netWinScore.toFixed(1)}
          </span>
          <span className="text-xs text-stone-400 leading-tight">Before</span>
          <span className="text-xs text-stone-400 leading-tight">After</span>
          <span className="text-xs text-stone-400 leading-tight">Diff</span>
        </div>
        
        {/* Total Score */}
        <div className="grid grid-cols-4 gap-0.5 items-start">
          <span className="text-xs font-semibold text-stone-300 leading-none">
            {color.toUpperCase()}
          </span>
          <span className={`text-xs font-bold leading-none ${playerEval.pre.total > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {playerEval.pre.total.toFixed(1)}
          </span>
          <span className={`text-xs font-bold leading-none ${playerEval.post.total > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {playerEval.post.total.toFixed(1)}
          </span>
          <span className={`text-xs font-bold leading-none ${playerEval.diff.total > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {playerEval.diff.total > 0 ? '+' : ''}{playerEval.diff.total.toFixed(1)}
          </span>
        </div>
        
        {/* Score Breakdown */}
        <div className="space-y-0.5 pt-0.5">
          {/* 按指定顺序渲染评估项 */}
          {['material', 'position', 'mobility', 'threat', 'safety', 'tactic'].map((key) => {
            // 确保所有值都是数字类型，添加默认值
            const preValue = Number(playerEval.pre[key as keyof PlayerEvaluation] || 0);
            const postValue = Number(playerEval.post[key as keyof PlayerEvaluation] || 0);
            const diffValue = Number(playerEval.diff[key as keyof PlayerEvaluation] || 0);
            
            return (
              <div key={key} className="grid grid-cols-4 gap-0.5 items-start">
                <span className="text-xs text-stone-400 capitalize leading-none">{key}</span>
                <span className={`text-xs font-bold leading-none ${preValue > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {preValue.toFixed(1)}
                </span>
                <span className={`text-xs font-bold leading-none ${postValue > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {postValue.toFixed(1)}
                </span>
                <span className={`text-xs font-bold leading-none ${diffValue > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {diffValue > 0 ? '+' : ''}{diffValue.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};