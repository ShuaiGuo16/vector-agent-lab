import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original, locally modeled silver concept coupe, shaped against references/car-reference.png.
// All detail is static and baked by material: no extra render passes or downloaded model.
export function createRoadster():THREE.Group {
  const car=new THREE.Group();
  car.userData.wheels=[] as THREE.Group[];
  const paint=new THREE.MeshPhysicalMaterial({color:0xb2c1c9,metalness:.65,roughness:.42,clearcoat:.5,clearcoatRoughness:.32,envMapIntensity:.8});
  const carbon=new THREE.MeshStandardMaterial({color:0x10171e,metalness:.4,roughness:.32,side:THREE.DoubleSide});
  const glass=new THREE.MeshPhysicalMaterial({color:0x102530,metalness:.8,roughness:.12,clearcoat:1,envMapIntensity:.85});
  const rubber=new THREE.MeshStandardMaterial({color:0x101316,roughness:.86});
  const alloy=new THREE.MeshStandardMaterial({color:0x718189,metalness:.95,roughness:.23});
  const rotor=new THREE.MeshStandardMaterial({color:0x404b50,metalness:.85,roughness:.5});
  const caliper=new THREE.MeshStandardMaterial({color:0xa78753,metalness:.6,roughness:.3});
  const headlight=new THREE.MeshBasicMaterial({color:new THREE.Color(2.7,3.6,4),toneMapped:false});
  const taillight=new THREE.MeshBasicMaterial({color:new THREE.Color(3,.025,.012),toneMapped:false});
  function mesh(geometry:THREE.BufferGeometry,material:THREE.Material,parent:THREE.Object3D=car){const m=new THREE.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function box(x:number,y:number,z:number,w:number,h:number,d:number,material:THREE.Material,parent:THREE.Object3D=car){const m=mesh(new THREE.BoxGeometry(w,h,d),material,parent);m.position.set(x,y,z);return m;}
  function line(points:number[][],radius:number,material:THREE.Material){return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p as [number,number,number]))),Math.max(12,points.length*5),radius,5,false),material);}
  function surface(rows:number,cols:number,point:(v:number,u:number)=>number[],material:THREE.Material,flip=false){
    const p:number[]=[],ix:number[]=[];
    for(let j=0;j<=rows;j++)for(let k=0;k<=cols;k++)p.push(...point(j/rows,k/cols));
    for(let j=0;j<rows;j++)for(let k=0;k<cols;k++){const a=j*(cols+1)+k,b=a+cols+1;ix.push(...(flip?[a,a+1,b,a+1,b+1,b]:[a,b,a+1,a+1,b,b+1]));}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return mesh(g,material);
  }
  function panel(points:number[][],material:THREE.Material){
    const g=new THREE.BufferGeometry(),ix:number[]=[];for(let i=1;i<points.length-1;i++)ix.push(0,i,i+1);
    g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));g.setIndex(ix);g.computeVertexNormals();return mesh(g,material);
  }
  // Shape-preserving Hermite interpolation keeps the flanks smooth between sections.
  function profile(z:number,p:number[][]){
    if(z<=p[0][0])return p[0][1];
    for(let i=1;i<p.length;i++)if(z<=p[i][0]){
      const [x0,y0]=p[i-1],[x1,y1]=p[i],h=x1-x0,t=(z-x0)/h,d=(y1-y0)/h;
      const prev=i>1?(y0-p[i-2][1])/(x0-p[i-2][0]):d;
      const next=i+1<p.length?(p[i+1][1]-y1)/(p[i+1][0]-x1):d;
      const m0=prev*d<=0?0:2*prev*d/(prev+d),m1=next*d<=0?0:2*next*d/(next+d);
      return (2*t**3-3*t*t+1)*y0+(t**3-2*t*t+t)*h*m0+(-2*t**3+3*t*t)*y1+(t**3-t*t)*h*m1;
    }return p.at(-1)![1];
  }
  const width=(z:number)=>profile(z,[[-2.5,.87],[-2.1,1.03],[-1.45,1.1],[-.5,.99],[.4,1.02],[1.4,1.16],[2.08,1.09],[2.35,1.01]]);
  const deck=(z:number)=>profile(z,[[-2.5,-.065],[-2.05,.10],[-1.1,.22],[0,.24],[1,.29],[1.85,.29],[2.35,.20]]);
  const arch=(z:number)=>{let y=-.38;for(const wz of [-1.46,1.45]){const dz=Math.abs(z-wz);if(dz<.515)y=Math.max(y,-.12+Math.sqrt(.515**2-dz**2));}return y;};
  const shoulder=(z:number)=>Math.max(deck(z)+.18*Math.exp(-(((z+1.46)/.72)**2))+.19*Math.exp(-(((z-1.45)/.68)**2)),arch(z)+.065);
  const top=(z:number,u:number)=>deck(z)+(shoulder(z)-deck(z))*Math.abs(u)**2.5+.025*(1-u*u);
  // The point of the nose leads the outer cheeks, unlike a rectangular bumper.
  const noseSweep=(z:number,u:number)=>z+.20*u*u*Math.exp(-(((z+2.5)/.35)**2))-.18*u*u*Math.exp(-(((z-2.35)/.35)**2));
  surface(112,32,(v,u)=>{const z=-2.5+v*4.85,t=u*2-1;return [width(z)*t,top(z,t),noseSweep(z,t)];},paint);
  for(const side of [-1,1]){
    surface(112,8,(v,u)=>{
      const z=-2.5+v*4.85,hi=top(z,1),lo=arch(z),waist=Math.exp(-(((z-.2)/.85)**4));
      return [side*(width(z)-.035*u-.085*Math.sin(u*Math.PI)*waist),THREE.MathUtils.lerp(hi,lo,u),noseSweep(z,1)];
    },paint,side<0);
    // Exposed carbon inlet carved visually into the concave lower door/rear haunch.
    panel([[side*.987,.10,.15],[side*1.073,.25,.76],[side*1.09,.17,1.00],[side*.986,-.30,.78],[side*.956,-.24,.24]],carbon);
    line([[side*.974,.125,-.68],[side*.99,.20,.07],[side*1.08,.265,.77],[side*1.115,.32,.91]],.022,paint);
    line([[side*.975,-.335,-.83],[side*.987,-.35,.12],[side*1.08,-.32,.88]],.035,carbon);
    // Door seams and flush handle remain on the body rather than floating over it.
    line([[side*.989,.25,-.77],[side*.958,.01,-.58],[side*.929,-.23,-.48]],.005,carbon);
    box(side*1.012,.245,.39,.012,.021,.16,alloy);
    const mirror=mesh(new THREE.SphereGeometry(1,16,8),paint);mirror.position.set(side*1.04,.35,-.64);mirror.scale.set(.145,.045,.085);
    line([[side*.77,.32,-.58],[side*.99,.35,-.64]],.016,carbon);
    // Narrow lamps, stretched horizontally across the pointed face.
    const lamp=Array.from({length:14},(_,i)=>{const t=i/13,x=.42+t*.48,z=-2.30+t*.19;return [side*x,top(z,x/width(z))+.016,noseSweep(z,x/width(z))];});
    line(lamp,.032,carbon);line(lamp.map(([x,y,z])=>[x,y+.023,z-.005]),.009,headlight);
    // Front corner openings sit between the nose bridge and a thin carbon splitter.
    panel([[side*.70,-.13,-2.40],[side*.94,.005,-2.24],[side*.98,-.30,-2.20],[side*.82,-.34,-2.34]],carbon);
    line([[side*.63,-.13,-2.43],[side*.72,-.25,-2.40],[side*.82,-.35,-2.36]],.035,paint);
    line([[side*.88,-.35,-2.30],[side*.99,-.29,-2.15],[side*1.035,-.20,-2.03]],.018,paint);
  }
  // Black central trapezoid is recessed behind a narrow sculpted nose bridge.
  panel([[-.53,-.115,-2.492],[.53,-.115,-2.492],[.76,-.345,-2.415],[-.76,-.345,-2.415]],carbon);
  surface(1,24,(v,u)=>{const t=u*2-1;return [width(-2.5)*t,THREE.MathUtils.lerp(top(-2.5,t),-.125,v),noseSweep(-2.5,t)];},paint,true);
  line([[-1.005,-.36,-2.17],[-.81,-.38,-2.37],[0,-.38,-2.49],[.81,-.38,-2.37],[1.005,-.36,-2.17]],.025,carbon);
  box(0,-.375,.1,1.78,.07,3.85,carbon);
  // Small hood creases sweep from the nose into the front wheel shoulders.
  for(const side of [-1,1])line(Array.from({length:18},(_,i)=>{const z=-2.2+i/17*1.16,x=.31+i/17*.25;return [side*x,top(z,x/width(z))+.004,z];}),.004,alloy);

  // One continuous, low teardrop canopy; the edge is swept back around the cabin.
  const canopyW=(z:number)=>profile(z,[[-1.18,.72],[-.45,.76],[.25,.77],[.70,.71],[1.36,.58]]);
  const canopyH=(z:number)=>profile(z,[[-1.18,.255],[-.45,.55],[.12,.60],[.55,.55],[1.36,.30]]);
  const canopyY=(z:number,u:number)=>.26+(canopyH(z)-.26)*Math.pow(Math.max(0,1-Math.abs(u)**4),.52);
  surface(56,32,(v,u)=>{const z=-1.18+v*2.54,t=u*2-1;return [t*canopyW(z),canopyY(z,t),z];},glass);
  for(const side of [-1,1]){
    // Thin A pillar and sill, broad flying rear buttress flowing out into the hip.
    line(Array.from({length:18},(_,i)=>{const z=-1.14+i/17*.82;return [side*canopyW(z)*.86,canopyY(z,.86)+.006,z];}),.016,paint);
    line(Array.from({length:24},(_,i)=>{const z=-1.14+i/23*2.46;return [side*canopyW(z),.265,z];}),.011,alloy);
    surface(32,8,(v,u)=>{
      const z=.22+v*1.42,inner=.65-v*.08,outer=.70+v*.34;
      const yInner=z<1.36?canopyY(z,Math.min(.98,inner/canopyW(z))):top(z,inner/width(z));
      return [side*THREE.MathUtils.lerp(inner,outer,u),THREE.MathUtils.lerp(yInner,top(z,outer/width(z)),u)+.018*Math.sin(u*Math.PI),z];
    },paint,side<0);
    // Louvres directly behind the shoulders, visible from the chase camera.
    for(let n=0;n<5;n++){const z=1.56+n*.095;line([[side*.41,top(z,.41/width(z))+.01,z],[side*.77,top(z,.77/width(z))+.01,z+.025]],.013,carbon);}
  }
  // Broad open rear with twin slim lamps, a swept lip and diffuser fins.
  surface(1,28,(v,u)=>{const t=u*2-1;return [t*1.005,.13-v*.38,2.355-.18*t*t];},carbon);
  surface(1,28,(v,u)=>{const t=u*2-1;return [t*width(2.35),THREE.MathUtils.lerp(top(2.35,t),.13,v),2.35-.18*t*t+v*.01];},paint);
  surface(1,28,(v,u)=>{const t=u*2-1;return [t*(1.005-v*.05),-.25-v*.10,2.36-.18*t*t-v*.07];},paint);
  line(Array.from({length:24},(_,i)=>{const t=-1+i/23*2;return [t*1.02,.23,2.37-.18*t*t];}),.022,paint);
  for(const side of [-1,1])line(Array.from({length:14},(_,i)=>{const x=.18+i/13*.78;return [side*x,.14,2.375-.18*x*x];}),.014,taillight);
  for(const x of [-.72,-.36,0,.36,.72])box(x,-.32,2.20,.022,.16,.44,carbon);

  // Thin sidewalls and swept turbine spokes make the large wheels read at game scale.
  for(const side of [-1,1])for(const z of [-1.46,1.45]){
    const wheel=new THREE.Group();wheel.position.set(side*(z>0?1.07:1.015),-.12,z);wheel.rotation.y=side*Math.PI/2;car.add(wheel);
    wheel.userData.wheel=true;car.userData.wheels.push(wheel);
    mesh(new THREE.TorusGeometry(.372,.086,10,48),rubber,wheel);
    const inner=mesh(new THREE.CylinderGeometry(.35,.35,.16,36),carbon,wheel);inner.rotation.x=Math.PI/2;
    const disc=mesh(new THREE.CylinderGeometry(.288,.288,.025,36),rotor,wheel);disc.rotation.x=Math.PI/2;disc.position.z=.058;
    mesh(new THREE.TorusGeometry(.343,.012,6,48),alloy,wheel).position.z=.09;
    box(.21,0,.075,.06,.18,.035,caliper,wheel);
    for(let n=0;n<10;n++){
      const a=n*Math.PI*2/10,points=[[.072,0],[.30,.08],[.335,.025],[.13,-.025]].map(([r,t])=>[Math.sin(a)*r+Math.cos(a)*t,Math.cos(a)*r-Math.sin(a)*t,.105]);
      const blade=panel(points,alloy);blade.removeFromParent();wheel.add(blade);
    }
    const hub=mesh(new THREE.CylinderGeometry(.078,.078,.03,16),carbon,wheel);hub.rotation.x=Math.PI/2;hub.position.z=.105;
    const center=mesh(new THREE.CylinderGeometry(.035,.035,.035,12),alloy,wheel);center.rotation.x=Math.PI/2;center.position.z=.12;
  }
  car.updateMatrixWorld(true);
  function batch(root:THREE.Group){
    const inverse=root.matrixWorld.clone().invert(),batches=new Map<THREE.Material,THREE.Mesh[]>();
    root.traverse(obj=>{
      if(!(obj instanceof THREE.Mesh)||Array.isArray(obj.material))return;
      let parent=obj.parent;while(parent&&parent!==root){if(parent.userData.wheel)return;parent=parent.parent;}
      const list=batches.get(obj.material)||[];list.push(obj);batches.set(obj.material,list);
    });
    for(const [material,meshes] of batches){
      const parts=meshes.map(m=>m.geometry.clone().applyMatrix4(m.matrixWorld).applyMatrix4(inverse));
      for(const part of parts)if(!part.getAttribute('uv'))part.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
      const combined=mergeGeometries(parts);if(combined){mesh(combined,material,root);meshes.forEach(m=>{m.removeFromParent();m.geometry.dispose();});}parts.forEach(p=>p.dispose());
    }
  }
  // Four independently animated wheel batches retain suspension, steering and spin.
  for(const wheel of car.userData.wheels as THREE.Group[])batch(wheel);
  batch(car);
  return car;
}
