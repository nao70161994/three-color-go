/** Shared terminal target for training AND 3-player MaxN search.
 * Each mode produces a nonnegative, absolute-color share summing to one.
 * This is observed endgame reward, not a tactical teacher's move score.
 */
import {COLORS,scores,winner} from './game.js';

export const PV_REWARD_PROFILES=Object.freeze(['winner','blend','margin']);
export function resolvePVRewardProfile(model){
  // Existing PV2 candidate JSONs (created before this experiment) used blend.
  return model?.rewardProfile ?? (model?.architecture==='hex-group-pv-16-v2'?'blend':'winner');
}
export function validatePVRewardProfile(profile){
  if(!PV_REWARD_PROFILES.includes(profile))
    throw Error('Invalid PV reward profile: '+profile);
  return profile;
}
export function terminalPVReward(state,profile='winner'){
  validatePVRewardProfile(profile);
  if(!state.ended)throw Error('PV reward requires a terminal game');
  const all=scores(state),winners=new Set(winner(state));
  const won=COLORS.map(c=>winners.has(c)?1/winners.size:0);
  if(profile==='winner')return won;
  const counts=COLORS.map(c=>all[c]),sum=counts.reduce((a,b)=>a+b,0);
  let auxiliary;
  if(profile==='blend'){
    auxiliary=sum?counts.map(n=>n/sum):[1/3,1/3,1/3];
  }else{
    // Normalized pairwise STONE MARGINS, not absolute stone shares.
    // Translation-invariant: [20,10,5] equals [120,110,105].
    // Scale by max score spread to avoid board-size dominated logits.
    const spread=Math.max(1,Math.max(...counts)-Math.min(...counts));
    const centered=counts.map(n=>2*n/spread);
    const top=Math.max(...centered);
    const exps=centered.map(n=>Math.exp(n-top));
    const total=exps.reduce((a,b)=>a+b,0);
    auxiliary=exps.map(n=>n/total);
  }
  return won.map((v,i)=>.75*v+.25*auxiliary[i]);
}
