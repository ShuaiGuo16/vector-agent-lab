// Offline engine measurements for protocol and provider tests; never used live.
import RAPIER from '@dimforge/rapier3d-compat';
import { Simulation } from '../shared/simulation';
import { actuatorCommands } from '../server/prompts';
import type { Plan } from '../shared/protocol';
await RAPIER.init();
const plan: Plan = { goals: [
        {
            id: 'flight-one', kind: 'fly', target: null, position: [35, 20, 119], speed: 8, guidance: [], reviewAfter: false
        },
        {
            id: 'return', kind: 'depot', target: 'depot', position: null, speed: 3, guidance: [], reviewAfter: false
        }
    ] };
const sim = new Simulation();
sim.startAgentSetup();
const initialObservation = sim.observe('runtime');
sim.mission.departure = true;
sim.applyAgentPlan(plan, 1);
const observation = sim.observe('runtime');
console.log(JSON.stringify({
    initialObservation, observation, plan, facts: { actuatorCommandsAtThisState: actuatorCommands(observation, plan) }
}));
sim.dispose();
