import { z } from 'zod';
import { PlanSchema } from './protocol';
import { RemoteActionSchema } from './remote-actions';
export const PublicAgentConfigSchema = z.object({
    sourceIdentity: z.string(), configured: z.boolean(), plannerModel: z.string(), reasoning: z.string(),
    decisionModel: z.string(), decisionProvider: z.string(), maxActionAge: z.number(), decisionInterval: z.number()
}).passthrough();
export type PublicAgentConfig = z.infer<typeof PublicAgentConfigSchema>;
export const ServerMessageSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('hello'), config: PublicAgentConfigSchema }),
    z.object({
        type: z.literal('started'), runId: z.string(), reviewSchedule: z.enum(['every_relay', 'planned'])
    }),
    z.object({
        type: z.literal('plan'), runId: z.string(), plan: PlanSchema, version: z.number().int(), latencyMs: z.number(), model: z.string()
    }),
    RemoteActionSchema,
    z.object({ type: z.literal('agent_status'), state: z.string() }),
    z.object({
        type: z.literal('error'), message: z.string(), kind: z.string().optional()
    }),
    z.object({
        type: z.literal('finished'), runId: z.string(), summary: z.object({ outcome: z.string(), calls: z.number() }).passthrough()
    })
]);
