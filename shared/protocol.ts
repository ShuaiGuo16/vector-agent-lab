import { z } from 'zod';
import { ACTION_MECHANICS } from './action-mechanics';
export const ACTIONS = ['drive', 'brake', 'climb', 'cruise', 'approach', 'descend', 'hold'] as const;
export const ActionSchema = z.enum(ACTIONS);
export type Action = z.infer<typeof ActionSchema>;
// BRAKE remains readable in archived traces; live models have six distinct choices.
export const MODEL_ACTIONS = ACTIONS.filter(a => a !== 'brake');
export const TargetId = z.enum(['relay-1', 'relay-2', 'relay-3', 'charger', 'depot']);
export const GoalSchema = z.object({
    id: z.string().min(1), kind: z.enum(['drive', 'fly', 'relay', 'charge', 'depot']), target: TargetId.nullable(), position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).nullable(), speed: z.number().min(.5).max(14), guidance: z.array(z.string()), reviewAfter: z.boolean()
});
export type Goal = z.infer<typeof GoalSchema>;
// Historical traces can contain engine-created departure; new plans use ordinary drive goals.
export const ActiveGoalSchema = GoalSchema.extend({ kind: z.enum(['drive', 'fly', 'relay', 'charge', 'depot', 'departure', 'wait_review']) });
export type ActiveGoal = z.infer<typeof ActiveGoalSchema>;
export const GoalRecordSchema = z.object({
    id: z.string(), kind: z.string(), startedAt: z.number(), completedAt: z.number(), startEnergy: z.number(), endEnergy: z.number(), startPosition: z.array(z.number()), endPosition: z.array(z.number())
});
export const PlanSchema = z.object({ goals: z.array(GoalSchema) });
export type Plan = z.infer<typeof PlanSchema>;
export const DESCRIPTIONS: Record<Action, string> = ACTION_MECHANICS;
const vec = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const BaseObservationSchema = z.object({
    flightThrottle: z.number().finite().min(0).max(1).optional(), nozzleThrustLevels: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]).optional(), bodyOrientationQuaternion: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).optional(), bodyAngularVelocityWorld: vec.optional(), bodyUpWorld: vec.optional(), bodyHeadingYawRadians: z.number().finite().nullable().optional(), targetDwellSeconds: z.number().finite().nonnegative().optional(), lastLandingImpact: z.number().finite().nonnegative().optional(), chargingEligible: z.boolean().optional(), onChargingPad: z.boolean().optional(), chargingStopsCompleted: z.number().int().nonnegative().optional(), waypoint: z.object({
        kind: z.enum(['departure', 'road', 'model', 'destination']), groundedRequired: z.boolean().optional(), position: vec, distance: z.number(), heightAboveSurface: z.number()
    }).optional(), lastAppliedManeuver: ActionSchema.optional(), runId: z.string().max(100), seq: z.number().int().nonnegative(), simTime: z.number().nonnegative(), wallElapsedSeconds: z.number().nonnegative().optional(), setupElapsedSeconds: z.number().nonnegative().optional(), setupPending: z.boolean().optional(), waypointIndex: z.number().int().nonnegative().optional(), observedAt: z.number(), position: vec, velocity: vec, yaw: z.number(), grounded: z.boolean(), energy: z.number(), speed: z.number(), headingError: z.number(), distance: z.number(), heightAboveTarget: z.number(), cruiseAltitude: z.number(), target: TargetId, targetPosition: vec, departureComplete: z.boolean(), roadTravelPending: z.boolean(), stage: z.string().max(50), completed: z.array(TargetId), status: z.enum(['ready', 'running', 'success', 'failed']), seed: z.number().int(), interventions: z.number().int(), collisions: z.number().int(), staleSeconds: z.number(), planVersion: z.number().int(), legIndex: z.number().int(), paused: z.boolean()
});
export const ObservationSchema = BaseObservationSchema.extend({
    goal: ActiveGoalSchema.optional(), completedGoalIds: z.array(z.string()).optional(), goalLedger: z.array(GoalRecordSchema).optional(), reviewSchedule: z.enum(['every_relay', 'planned']).optional(), relayHandoffMode: z.enum(["continuous", "station"]).optional(), relayHandoffWaiting: z.boolean().optional(), relayHandoffWaitSeconds: z.number().nonnegative().optional()
});
export type Observation = z.infer<typeof ObservationSchema>;
export function objectiveKey(o: Pick<Observation, 'planVersion' | 'legIndex' | 'waypointIndex' | 'waypoint' | 'departureComplete' | 'relayHandoffWaiting' | 'goal'>) {
    if (o.goal)
        return `${o.planVersion}:goal:${o.goal.id}`;
    return `${o.planVersion}:setup`;
}
export const StartSchema = z.object({
    type: z.literal('start'), runId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), mode: z.enum(['manual', 'baseline', 'openrouter']), seed: z.number().int().min(1).max(99999), decisionModel: z.enum(['typesafe/jev-1.14', 'openai/gpt-6-luna-decisions', 'microsoft/microsoft-decision-1'])
});
export const ClientMessage = z.discriminatedUnion('type', [StartSchema, z.object({ type: z.literal('observation'), data: ObservationSchema }), z.object({ type: z.literal('stop'), reason: z.string().max(120) }), z.object({
        type: z.literal('event'), runId: z.string(), name: z.enum(['manual_takeover', 'recovery', 'pause', 'resume', 'outcome', 'implementation_error']), data: z.record(z.string(), z.unknown())
    })]);
export type Mode = 'manual' | 'baseline' | 'openrouter';
