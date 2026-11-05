// Physical failure thresholds; elapsed time is a measurement, not a failure rule.
export const MISSION_LIMITS={
  minY:-3,maxAbsX:195,minZ:-285,maxZ:175,minUpY:.1,
  collisionCountDelta:6,severeCollisionDelta:14,collisionGraceSeconds:2
} as const;
