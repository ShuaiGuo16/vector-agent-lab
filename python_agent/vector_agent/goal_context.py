"""Explicit-goal context. Measurements and mechanics only; no action recommendations."""
import math
from .context import CONTRACT, WORLD, TARGETS, rounded, physical_state

MECHANICS = {k:v for k,v in CONTRACT["actionMechanics"].items() if k != "brake"}
PHYSICS = CONTRACT["executionFacts"]["physics"]
C = CONTRACT["taskConstants"]


def decision_timing(config):
    return {
        'regularRequestIntervalMs': config.DECISION_INTERVAL_MS,
        'arrivingResponseMaxAgeMs': config.ACTION_MAX_AGE_MS,
        'acceptedCommandLifetime': 'Until replaced, or the current goal/plan changes; pause, takeover and stop cancel control.',
        'goalChanges': 'Request a fresh decision immediately, without waiting for the regular interval.',
        'requestTiming': 'One decision request at a time. The interval is nominal wall time between regular dispatches; provider latency can delay subsequent dispatches.',
    }


def geometry(seed):
    boxes = WORLD['collisionMaps']['odd' if seed % 2 else 'even']
    kinds = list(dict.fromkeys((b['kind'] for b in boxes)))
    return {
        'columns': ['kindIndex', 'minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'],
        'kinds': kinds,
        'solids': [[kinds.index(b['kind']), *b['min'], *b['max']] for b in boxes],
        'meaning': 'Complete static solid map, world-axis bounds in metres; y is altitude. No obstacles omitted.',
    }


def task(o):
    facts = CONTRACT['taskFacts']
    return {
        **facts,
        'completion': {k: v for k, v in facts['completion'].items() if k != 'modelWaypoints'},
        'controlInterface': {k: v for k, v in facts['controlInterface'].items() if k not in ('planningReview', 'routeExecution')},
        'goalExecution': 'Execute the model-authored ordered goals from the current vehicle position, including the mandatory grounded departure when departureComplete is false. The engine does not insert departure or transit goals. drive/fly advance at 3D distance <2 m; drive also requires wheel contact. relay/charge/depot use station acceptance. Completion IDs persist across revisions. All six maneuvers are available; goal kind is an assignment, not an action mask.',
        'reviewScheduling': {
            'mode': o.reviewSchedule or 'every_relay',
            'stationReviews': 'Every relay, plus charger goals with reviewAfter=true' if o.reviewSchedule != 'planned' else 'Only relay/charge goals with reviewAfter=true',
            'start': 'When the scheduled station goal begins, before landing/activation/charging completes.',
            'handoff': 'After actual completion, a separate wait_review goal requires wheel contact and 3D speed <0.75 m/s within the same station until a response is ready. The engine does not park the vehicle.',
            'recovery': 'After 15 seconds without movement >3 m, energy gain >3, or goal/relay progress; at least 20 seconds after last review dispatch. Intentional wait_review is excluded. Review dispatches are at least 8 seconds apart.',
            'decisionModelCanRequestReview': False,
            'energyDropAloneTriggersReview': False,
        },
    }


def vehicle(o):
    return {
        **physical_state(o),
        'position': list(map(rounded, o.position)),
        'velocity': list(map(rounded, o.velocity)),
        'grounded': o.grounded,
        'energy': rounded(o.energy),
        'headingErrorRadians': rounded(o.headingError),
        'lastLandingImpact': o.lastLandingImpact,
        'lastAppliedManeuver': o.lastAppliedManeuver,
        'flightThrottle': o.flightThrottle,
    }


def planner_input(o, previous=None, reason=None, execution_history=None, review_application=None):
    application = review_application or {'mode': 'on_response' if previous else 'initial_setup', 'completionGoalId': None}
    return {
        'task': task(o),
        'actionMechanics': MECHANICS,
        'vehicle': vehicle(o),
        'mission': {
            'elapsedExecutionSeconds': rounded(o.simTime),
            'departureComplete': o.departureComplete,
            'completedRelays': o.completed,
            'chargingStopsCompleted': o.chargingStopsCompleted,
        },
        'runtime': {
            'initialPlanningPausesPhysics': True,
            'reviewsPausePhysics': False,
            'snapshotDoesNotRefresh': True,
            'handoff': 'Scheduled station reviews install only after the station actually completes; other reviews install while moving.',
        },
        'physics': {
            **PHYSICS,
            'units': 'metres, seconds; energy capacity 100',
            'chargePerSecond': 14,
            'climbSpeedCap': 6,
            'descentSpeedCap': 3,
            'roadSpeedCap': 8,
            'roadTurnSpeedCap': 3.5,
        },
        'map': {
            'departure': [35, 0.6, 119],
            'targets': WORLD['targets'],
            'streetX': WORLD['streetX'],
            'streetZ': WORLD['streetZ'],
            'geometry': geometry(o.seed),
        },
        'review': {
            'reason': reason or 'Initial planning',
            'application': application,
            'installedPlan': previous.wire() if previous else None,
            'currentGoal': o.goal.model_dump() if o.goal else None,
            'completedGoalIds': o.completedGoalIds or [],
            'actualGoalRecords': o.goalLedger or [],
        },
        **({'executionHistory': execution_history} if previous else {}),
        'executionObservationFields': {
            'goal': 'Current model-authored goal, or the temporary wait_review assignment at a completed station',
            'completedGoalIds': 'Actually completed IDs, retained across revisions',
            'goalLedger': 'Actual start/end times, energy and positions, not predicted costs',
        },
    }


def goal_conditions(o):
    g = o.goal
    if not g:
        return {}
    p = g.position or [TARGETS[g.target][k] for k in ('x', 'y', 'z')]
    if g.kind in ('drive', 'fly'):
        return {'distance3DAccepted': math.dist(o.position, p) < C['transitRadius'], 'wheelContactAccepted': g.kind != 'drive' or o.grounded}
    if g.kind == 'departure':
        return {'inDepartureArea': 27 < o.position[0] < 43 and 112 <= o.position[2] <= 121, 'wheelContact': o.grounded}
    t = TARGETS[g.target]
    return {
        'horizontalAccepted': math.hypot(o.position[0] - t['x'], o.position[2] - t['z']) < t['radius'] - C['stationRadiusInset'],
        'standingHeightAccepted': abs(o.position[1] - t['y'] - C['standingHeight']) < C['stationHeightTolerance'],
        'wheelContact': o.grounded,
        'speedAccepted': math.hypot(*o.velocity) < C['stationSpeed'],
        **({'plannerResponseInstalled': False} if g.kind == 'wait_review' else {'chargeComplete': o.energy >= C['chargeComplete']} if g.kind == 'charge' else {
            'qualifyingStationarySeconds': o.targetDwellSeconds,
            'durationComplete': (o.targetDwellSeconds or 0) >= C['dwellSeconds'],
            **({'landingQualityAccepted': o.lastLandingImpact is not None and o.lastLandingImpact < C['landingImpact'], 'activated': g.target in o.completed} if g.kind == 'relay' else {'allRelaysActivated': len(o.completed) == 3}),
        }),
    }


def path_point(g):
    position = g.position
    if position is None and g.target:
        t = TARGETS[g.target]
        position = [t['x'], t['y'] + 0.6, t['z']]
    return {
        'id': g.id,
        'kind': g.kind,
        'target': g.target,
        'position': position,
        'speed': g.speed,
    }


def decision_state(o, plan, facts, timing=None):
    if not o.goal or facts.actuatorCommandsAtThisState is None:
        raise ValueError('Explicit goal and actuator measurements required')
    g = o.goal.model_dump()
    if g['target']:
        t = TARGETS[g['target']]
        if g['position'] is None:
            g['position'] = [t['x'], t['y'] + 0.6, t['z']]
        g['stationRadius'] = t['radius']
        g['surfaceHeight'] = t['y']
    return {
        'suppliedFacts': {
            'task': task(o),
            'physics': PHYSICS,
            'geometry': geometry(o.seed),
            **({'decisionTiming': timing} if timing is not None else {}),
        },
        'modelPlan': {'currentGoalGuidance': g.pop('guidance'), 'upcomingPath': [path_point(x) for x in (plan.goals or [])[0 if o.goal.kind == 'departure' else o.legIndex + 1:]]},
        'liveState': {
            'currentGoal': g,
            'conditions': goal_conditions(o),
            'vehicle': vehicle(o),
            'completedRelays': o.completed,
            'departureComplete': o.departureComplete,
            'trackingHeight': o.cruiseAltitude,
            'elapsedExecutionSeconds': rounded(o.simTime),
            'actuatorCommandsAtThisState': {k: c.model_dump() for k, c in facts.actuatorCommandsAtThisState.items() if k in MECHANICS},
        },
    }
