// Deterministically fitted from real three-player square-board teacher games.
export const SQUARE_POLICY_WEIGHTS={
  "architecture": "square-linear-policy-v1",
  "weights": [
    2.1820008,
    2.7868346,
    -2.6546514,
    -2.0918911,
    7.2461964,
    2.9790285,
    3.6632617,
    2.7041353,
    0.7820283,
    6.6718674,
    3.5239635,
    0.0911191,
    0.0324765,
    -0.0105265,
    1.7988035,
    0.0483706
  ],
  "passWeights": [
    -0.9806089,
    8.8169583,
    2.2844458
  ],
  "training": {
    "kind": "square-3-player-teacher-imitation",
    "games": 16,
    "boardSizes": [
      9,
      13,
      19
    ],
    "seed": 7112026,
    "positions": 1981,
    "learningRate": 0.11,
    "details": "balanced+tactical teacher actions, online softmax cross-entropy, true square rules",
    "checkpoint": "frozen-supervised-square-20261107"
  }
};
