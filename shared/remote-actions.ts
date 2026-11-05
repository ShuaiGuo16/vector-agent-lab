import { z } from 'zod';
import { ActionSchema } from './protocol';
export const RemoteActionSchema = z.object({
    type: z.literal('action'), runId: z.string(), seq: z.number().int(), planVersion: z.number().int(),
    legIndex: z.number().int(), objectiveKey: z.string(), continuity: z.literal('goal'),
    action: ActionSchema, validUntil: z.number().finite(), probabilities: z.record(z.string(), z.number()),
    confidence: z.number(), latencyMs: z.number(), calls: z.number(), model: z.string()
});
export type RemoteAction = z.infer<typeof RemoteActionSchema>;
export type ActionState = {
    runId: string;
    planVersion: number;
    legIndex: number;
    objectiveKey: string;
};
export function isActionCurrent(action: RemoteAction | undefined, state: ActionState) {
    return !!action && action.runId === state.runId && action.planVersion === state.planVersion &&
        action.legIndex === state.legIndex && action.objectiveKey === state.objectiveKey;
}
export function canAcceptAction(action: RemoteAction, state: ActionState, lastSeq: number, maxAge: number, now = Date.now()) {
    return action.seq > lastSeq && action.validUntil > now && action.validUntil <= now + maxAge && isActionCurrent(action, state);
}
