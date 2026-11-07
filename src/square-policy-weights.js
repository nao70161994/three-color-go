// Replaced by the deterministic square-board teacher-imitation training command.
// Initialized checkpoint is not a trained policy; final build records the number of games.
export const SQUARE_POLICY_WEIGHTS={
  architecture:'square-linear-policy-v1',
  weights:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  passWeights:[-4,6,1.5],
  training:{kind:'untrained-initialization',games:0,boardSizes:[],seed:7112026}
};
