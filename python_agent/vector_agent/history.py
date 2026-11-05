"""Factual execution context, independent of model choices or strategy quality."""
from .context import CONTRACT, TARGETS, rounded


def objective_fields(o):
    if o.goal:
        g = o.goal
        t = TARGETS[g.target] if g.target else None
        position = g.position[:] if g.position is not None else [t['x'], t['y'] + 0.6, t['z']]
        return {
            'goalId': g.id,
            'goalKind': g.kind,
            'goalPosition': position,
            'trackingHeight': o.cruiseAltitude,
            **({'stationSurfaceHeight': t['y']} if t else {}),
        }
    return {}


class ExecutionHistory:
    def __init__(self):
        self.settings = CONTRACT['executionHistoryConfig']
        self.samples, self.events = ([], [])
        self.previous = None
        self.last_sample = float('-inf')

    def observe(self, o):
        if o.setupPending or o.paused or o.status != 'running':
            return
        previous = self.previous

        def event(kind, data):
            self.events.append({
                'elapsedExecutionSeconds': rounded(o.simTime),
                'type': kind,
                'data': data,
            })
        if previous is None or o.planVersion != previous.planVersion:
            event('planObserved', {'planVersion': o.planVersion})

        def objective_key(state):
            if state.goal:
                return (state.planVersion, state.goal.id)
            return (state.planVersion, None)
        if previous is None or objective_key(o) != objective_key(previous):
            if o.goal:
                event('goalObserved', {'planVersion': o.planVersion, **objective_fields(o)})
        if previous:
            if o.departureComplete and (not previous.departureComplete):
                event('departureCompleted', {})
            for relay in o.completed:
                if relay not in previous.completed:
                    event('relayActivated', {'relay': relay})
            if o.chargingStopsCompleted != previous.chargingStopsCompleted:
                event('chargingStopsChanged', {'count': o.chargingStopsCompleted})
            if o.grounded and (not previous.grounded):
                event('groundContact', {'position': o.position[:], 'landingImpact': o.lastLandingImpact})
            if o.collisions > previous.collisions:
                event('collisionCountChanged', {'count': o.collisions})
        if o.simTime - self.last_sample >= self.settings['sampleIntervalSeconds']:
            self.samples.append({
                'elapsedExecutionSeconds': rounded(o.simTime),
                'planVersion': o.planVersion,
                **objective_fields(o),
                'position': list(map(rounded, o.position)),
                'velocity': list(map(rounded, o.velocity)),
                'energy': rounded(o.energy),
                'grounded': o.grounded,
                'appliedManeuver': o.lastAppliedManeuver,
            })
            self.last_sample = o.simTime
        self.samples = [s for s in self.samples if s['elapsedExecutionSeconds'] >= o.simTime - self.settings['recentWindowSeconds']]
        self.previous = o

    def snapshot(self):
        return {
            'description': 'Recent measured execution samples and mission events since execution began. appliedManeuver is observed actuation, not merely a requested model choice. No diagnosis or recommended action.',
            **self.settings,
            'samples': self.samples[:],
            'missionEvents': self.events[:],
        }
