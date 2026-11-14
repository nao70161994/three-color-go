/** Single source of truth for CPU IDs, geometry capabilities and safe fallbacks.
 * Neither the UI nor the worker should infer model compatibility from names.
 */
const UNIVERSAL=['easy','normal','hard'];
const HEX_ONLY=['neural','trained-lr001-final','trained-lr001-peak',
  'trained-lr0003-peak','elite-attn64-50000','elite-gnn64-50000','elite-pv2-122400'];
const SQUARE_ONLY=['square-trained-v1','square-gnn16-32',
  'square-gnn64-32','square-attn64-32'];
export const CPU_LEVELS=Object.freeze([...UNIVERSAL,...HEX_ONLY,...SQUARE_ONLY]);
export const SEAT_LEVELS=Object.freeze(['human',...CPU_LEVELS]);
export function isCpuLevelSupported(level,radius){
  if(!CPU_LEVELS.includes(level)||!Number.isInteger(radius))return false;
  if(UNIVERSAL.includes(level))return true;
  if(HEX_ONLY.includes(level))
    return radius>0 && !(level==='elite-attn64-50000' && radius>=8);
  if(SQUARE_ONLY.includes(level))
    return radius<0 && !(level==='square-attn64-32' && radius<=-19);
  return false;
}
export function defaultCpuLevelForBoard(radius){
  return radius<0?'square-trained-v1':'hard';
}
export function compatibleCpuLevel(level,radius){
  return isCpuLevelSupported(level,radius)?level:defaultCpuLevelForBoard(radius);
}
export function compatibleSeats(levels,radius){
  return levels.map(level=>level==='human'?'human':compatibleCpuLevel(level,radius));
}
export function cpuCompatibilityReason(level,radius){
  if(!CPU_LEVELS.includes(level))return '不明なCPU難易度です';
  if(level==='square-attn64-32'&&radius<=-19)
    return '19×19のAttentionは計算負荷が高いため現在利用できません';
  if(level==='elite-attn64-50000'&&radius>=8)
    return '大型六角盤のAttentionは計算負荷が高いため現在利用できません';
  return radius<0?'このCPUは六角盤専用です':'このCPUは四角盤専用です';
}
