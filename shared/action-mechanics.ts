// Literal actuator effects shared by all model roles. No selection criteria.
export const ACTION_MECHANICS={
  drive:'DRIVE: apply wheel throttle and steering toward the current goal only when the wheels have ground contact, including on a roof; without contact it issues brakes with zero wheel propulsion. It cannot take off. Ground speed cap is the current goal speed (also capped at 8 m/s, or 3.5 in turns).',
  brake:'BRAKE: reduce horizontal motion to zero. Ground handbrake or airborne height hold. Airborne holding consumes energy. Same actuator effect as HOLD.',
  climb:'CLIMB: gain altitude toward the supplied tracking height, up to 6 m/s, while stopping horizontal motion. This is a continuous altitude-tracking command, also capable of takeoff. Correction above the travel height is capped at 1 m/s downward.',
  cruise:'CRUISE: fly horizontally toward the objective at the planned speed cap. Vertical correction toward supplied tracking height is limited to 2 m/s in either direction. No takeoff from the ground.',
  approach:'APPROACH: fly horizontally toward the objective at a 4 m/s speed cap. Vertical correction toward supplied tracking height is limited to 2 m/s in either direction. No takeoff from the ground.',
  descend:'DESCEND: track the current transit goal vehicle-center height, or settle toward station surface +0.60 m at a landing objective, up to 3 m/s downward (or 1 m/s upward correction). The station settling height differs from the generic +0.64 m flight setpoint so the wheels can establish contact. Vertical tracking operates at any horizontal offset; it does not inspect obstacles. Airborne horizontal correction is capped at 1.4 m/s. On the ground this applies brakes and has no wheel propulsion.',
  hold:'HOLD: reduce horizontal motion to zero. Ground handbrake or airborne height hold. Airborne holding consumes energy.'
};;
