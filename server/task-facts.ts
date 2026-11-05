import {MISSION_LIMITS as L} from '../shared/mission-limits';

// Game requirements and control semantics. No state-to-action strategy or examples.
export const TASK_FACTS={
  objective:'Complete the mandatory grounded departure, activate all three rooftop relays and return to the depot. Avoid solid obstacles, overturning and leaving the operational district.',
  timing:{hardDeadline:false,metric:'Elapsed execution seconds; initial planning is excluded. Execution and route-review waits count toward elapsed time. No time-expiry failure.'},
  completion:{mandatoryGroundDeparture:'Cross x in (27,43), z in [112,121] while grounded before relay activation. This is a measured mission requirement; the engine does not insert a departure goal into the model plan.',
    modelWaypoints:'Model-authored vehicle-center xyz transit points advance at 3D distance strictly below 2 m; road mode also requires wheel contact. No speed or dwell requirement. After these points the station objective follows.',
    stations:'Grounded, horizontal distance strictly below station radius minus 2 m, standing-height error below 1 m, full 3D speed below 0.75 m/s.',
    relays:'Each requires last landing impact below 4.5 m/s and 2.5 continuous qualifying seconds.',
    charger:'The only energy-restoring location; adds 14 energy points/s while station requirements hold. A charger leg completes at energy >=98.',
    depot:'Terminal only; all three relays activated and 2.5 continuous qualifying seconds.'},
  failureConditions:{
    outsideDistrict:{vehicleYBelow:L.minY,absoluteVehicleXAbove:L.maxAbsX,vehicleZBelow:L.minZ,vehicleZAbove:L.maxZ},
    overturned:{bodyUpWorldYBelow:L.minUpY,meaning:'World-vertical component of the actual rotated vehicle up vector; 1 is upright.'},
    severeCollision:{velocityChangeMagnitudeAbove:L.severeCollisionDelta,units:'m/s across one 1/120-second physics step',onlyAfterSimulationSeconds:L.collisionGraceSeconds}
  },
  energy:'Energy depletion alone is not a terminal rule. Thrust weakens below 8 energy and may become insufficient; actual energy behavior is provided in physics.energy.',
  controlInterface:{
    planningReview:{
      scheduling:'The runtime reviews after relay completion changes or sustained lack of movement, charging or relay progress, subject to cooldowns. If departure, relay or charging completion changes during a review, it discards the response and requests a fresh review.',
      decisionModelCanRequestReview:false,
      energyDropAloneTriggersReview:false,
      whilePending:'The decision model continues the installed route and guidance; physics and energy use do not pause.',
      reviewOutput:'The route planner may keep or revise both route and guidance.'
    },
    routeExecution:'Once the mandatory ground departure is complete, track the model transit points in order, then the leg station. No waypoint speed/dwell requirement. The station remains current until its landing/activation/charging requirements hold. All seven maneuvers remain available at every point.',
    obstacles:'Building and vehicle bounds are solid. Supplied primitives do not plan collision-free aerial paths or autonomously choose another maneuver.',
    attitude:'An attitude stabilizer follows bounded commands; contact or dynamics can still overturn the car.',
    liftActivation:'Positive lift activates flight when energy is greater than 1; grounded non-positive lift gives control to the wheels.',
    uncertainty:'Commands are instantaneous setpoints, not predicted outcomes. Vehicle inertia, attitude, energy and request latency affect execution.'
  }
};

export const STATION_HANDOFF_REVIEW={...TASK_FACTS.controlInterface.planningReview,
  scheduling:'The runtime starts one review when a relay becomes the final landing/activation objective, replacing its post-activation review. In-flight stall reviews remain available. The reviewed relay may activate while the response is pending; that expected completion is retained as progress. Other departure, relay or charging completion changes require a fresh review.',
  whilePending:'During a relay review, complete that relay. After activation its grounded stationary station requirements remain the current assignment until the revised plan is available. The decision model chooses maneuvers to maintain that state; the engine does not park the car. During other reviews, continue the installed plan. Physics, energy use and elapsed time continue.'};
export const STATION_HANDOFF_RUNTIME={mode:'station',installation:'A relay review is queued until that relay actually activates, then installed. The next leg does not begin before activation and review readiness. The game never predicts or fabricates activation.'};
