import type { Input } from './flight';

// The same six keys always move the car. Tire contact determines how forces act.
export function readControls(keys:ReadonlySet<string>,assisted:boolean,forwardSpeed:number,grounded=false):Input {
  const down=(...codes:string[])=>codes.some(code=>keys.has(code));
  const forward=down('KeyW'),back=down('KeyS'),turn=Number(down('KeyA'))-Number(down('KeyD'));
  const descend=down('ShiftLeft','ShiftRight','ControlLeft','ControlRight');
  const lift=Number(down('Space'))-Number(descend),drive=Number(forward)-Number(back);
  if(!assisted)return {pitch:Number(back)-Number(forward),roll:turn,yaw:Number(down('KeyQ'))-Number(down('KeyE')),lift,brake:false,drive,steer:turn,handbrake:descend};
  const braking=back&&!forward&&(!grounded||forwardSpeed>.65);
  return {pitch:forward&&!back?-1:back&&!forward&&!braking?.65:0,yaw:turn,roll:turn*Math.min(.65,Math.max(0,forwardSpeed)/14),lift,brake:braking,drive,steer:turn,handbrake:descend};
}
