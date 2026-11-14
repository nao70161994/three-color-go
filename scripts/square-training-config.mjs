/** Argument validation shared by the square teacher-imitation trainer and tests. */
export function squareTrainingCounts(args=[]){
  if(!Array.isArray(args))throw Error('Expected square-board game counts');
  const games=[0,1,2].map(i=>args[i]===undefined?[12,3,1][i]:Number(args[i]));
  if(games.some(n=>!Number.isInteger(n)||n<0||n>300)||games.every(n=>n===0))
    throw Error('Expected game counts for 9/13/19 between 0 and 300');
  return games;
}
