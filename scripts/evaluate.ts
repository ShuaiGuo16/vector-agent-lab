// Offline baseline sampling horizon only; no mission deadline or live-model limit.
import RAPIER from '@dimforge/rapier3d-compat';
import {Simulation} from '../shared/simulation';
import {STEP} from '../src/flight';
await RAPIER.init();
for(const seed of [7,8]){
  const sim=new Simulation(seed);sim.mission.start();let prev='';
  for(let i=0;i<361/STEP&&sim.mission.status==='running';i++){
    sim.step('baseline');const label=`${sim.navigator.target.id} / ${sim.navigator.stage}`;
    if(label!==prev||i%1200===0){console.log(`${sim.time.toFixed(1)}s ${label} p=${sim.flight.position.toArray().map(v=>v.toFixed(1))} speed=${sim.flight.velocity.length().toFixed(1)} energy=${sim.flight.energy.toFixed(1)}`);prev=label;}
  }
  console.log(JSON.stringify({seed,status:sim.mission.status,reason:sim.mission.reason,time:sim.time,completed:sim.mission.completed,collisions:sim.mission.collisions,charges:sim.mission.charges,energy:sim.flight.energy}));
  if(sim.mission.status!=='success')process.exitCode=1;sim.dispose();
}
