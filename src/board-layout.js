/** Display geometry and geometry-aware heuristic helpers.
 * Game legality/topology stays in game.js; never add legality rules here.
 */
export const SIZE=29;
export const ROOT3=Math.sqrt(3);
export const SQUARE_STEP=SIZE*1.6;
export function center(q,r,radius){
  return radius<0
    ? [SQUARE_STEP*(q+(radius+1)/2),SQUARE_STEP*(r+(radius+1)/2)]
    : [SIZE*ROOT3*(q+r/2),SIZE*1.5*r];
}
export function boardExtent(radius){
  if(radius<0){
    const half=SQUARE_STEP*(-radius)/2+SIZE;
    return {x:half,y:half};
  }
  return {x:SIZE*ROOT3*radius+SIZE+4,y:SIZE*1.5*radius+SIZE+4};
}
export function boardCenterDistance(q,r,radius){
  if(radius<0){
    const mid=(-radius-1)/2;
    return Math.abs(q-mid)+Math.abs(r-mid);
  }
  return Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r));
}
export function boardEdgeFactor(q,r,radius){
  if(radius<0){
    const n=-radius,mid=(n-1)/2;
    return Math.max(Math.abs(q-mid),Math.abs(r-mid))/Math.max(1,mid);
  }
  return Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))/Math.max(1,radius);
}
