import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRoadster } from './roadster';
import { createSky, createSurfaceTexture, CinemaPass } from './cinema';
import { decorateDistrict } from './district-details';
import { BUILDINGS, PARKED } from '../shared/world';
import { Flight, OLD_TERRACE, PADS, THRUST_POINTS, type Pad } from './flight';

const boxGeo=new THREE.BoxGeometry(1,1,1);
const temp=new THREE.Object3D();
let seed=731;
function rand(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
const mat=(color:THREE.ColorRepresentation,roughness=.75,metalness=.1)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
const luminous=(color:THREE.ColorRepresentation,intensity=2)=>new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:intensity,roughness:.5});
export type Building={x:number;z:number;w:number;d:number;h:number};

export class City {
  scene=new THREE.Scene();
  renderer:THREE.WebGLRenderer;
  camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.2,1800);
  composer:EffectComposer;
  bloom:UnrealBloomPass;
  cinema:CinemaPass;
  renderScale=.95;
  performanceWindow:number[]=[];
  performanceSeconds=0;
  car=new THREE.Group();
  flames:THREE.Mesh[]=[];
  nozzles:THREE.Group[]=[];
  buildings:Building[]=[];
  sun=new THREE.DirectionalLight(0xffb27c,2.15);
  water:THREE.ShaderMaterial;
  shadow:THREE.Mesh;
  particles:THREE.Points;
  particleData=new Float32Array(180*3);
  particleLife=new Float32Array(180);
  particleVelocity=new Float32Array(180*3);
  particleCursor=0;
  elapsed=0;
  quality='balanced';
  constructor(canvas:HTMLCanvasElement,flight:Flight){
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));
    this.renderer.setSize(innerWidth,innerHeight);
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate=false;
    this.renderer.shadowMap.needsUpdate=true;
    this.renderer.info.autoReset=false;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=.97;
    this.scene.fog=new THREE.FogExp2(0x677f91,.0026);
    this.scene.add(createSky());
    this.scene.add(new THREE.HemisphereLight(0xa5d5ed,0x33374a,.85));
    this.sun.position.set(-100,160,-100);this.sun.castShadow=true;
    this.sun.shadow.mapSize.set(1024,1024);
    Object.assign(this.sun.shadow.camera,{left:-60,right:60,top:60,bottom:-60,near:1,far:420});
    this.sun.shadow.normalBias=.3;this.sun.shadow.bias=-.0007;
    this.scene.add(this.sun,this.sun.target);
    // A prefiltered reflection map is baked once; no per-frame reflection renders.
    const env=new RoomEnvironment();const pmrem=new THREE.PMREMGenerator(this.renderer);
    const envRT=pmrem.fromScene(env,.04);this.scene.environment=envRT.texture;this.scene.environmentIntensity=.35;env.dispose();pmrem.dispose();
    this.water=new THREE.ShaderMaterial({uniforms:{time:{value:0}},vertexShader:`varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec3 vP;uniform float time;void main(){float waves=sin(vP.x*.16+time*.5+sin(vP.y*.07))*sin(vP.y*.35+time*.4);float streak=pow(max(0.,sin(vP.y*.7+sin(vP.x*.3)+time*.6)),14.);vec3 c=mix(vec3(.12,.26,.31),vec3(.26,.40,.45),waves*.5+.5);c+=vec3(.30,.22,.14)*streak*.24;gl_FragColor=vec4(c,1.);}`});
    const water=new THREE.Mesh(new THREE.PlaneGeometry(2600,2600),this.water);water.rotation.x=-Math.PI/2;water.position.y=-2;this.scene.add(water);
    this.box(0,-1,-56,380,2,450,mat(0x344d57));flight.box(0,-1,-56,380,2,450);
    this.box(0,.02,-56,365,.05,435,new THREE.MeshStandardMaterial({color:0x8797a2,map:createSurfaceTexture('road'),roughness:.85}));
    this.makeDistrict(flight);
    decorateDistrict(this.scene,this.buildings,this.box.bind(this));
    this.mergeStatic();
    this.makeCar();
    this.scene.add(this.car);
    this.shadow=new THREE.Mesh(new THREE.PlaneGeometry(7,9),new THREE.MeshBasicMaterial({map:this.radialTexture(),transparent:true,opacity:.4,depthWrite:false,color:0x052934}));
    this.shadow.rotation.x=-Math.PI/2;this.scene.add(this.shadow);
    const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.BufferAttribute(this.particleData,3));
    this.particles=new THREE.Points(pg,new THREE.PointsMaterial({size:.45,map:this.radialTexture(),color:0xa5fff0,transparent:true,opacity:.24,blending:THREE.AdditiveBlending,depthWrite:false}));
    this.particles.frustumCulled=false;this.scene.add(this.particles);
    this.composer=new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene,this.camera));
    this.bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.12,.35,1.5);
    this.composer.addPass(this.bloom);this.composer.addPass(new OutputPass());
    this.cinema=new CinemaPass();this.composer.addPass(this.cinema);
    this.setQuality('balanced');
  }
  box(x:number,y:number,z:number,w:number,h:number,d:number,material:THREE.Material,parent:THREE.Object3D=this.scene){
    const mesh=new THREE.Mesh(boxGeo,material);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  mergeStatic(){
    const batches=new Map<THREE.Material,THREE.Mesh[]>();
    for(const child of this.scene.children){
      if(child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh) && child.material instanceof THREE.MeshStandardMaterial){
        const batch=batches.get(child.material)||[];batch.push(child);batches.set(child.material,batch);
      }
    }
    for(const [material,meshes] of batches){
      if(meshes.length<2)continue;
      const geometries=meshes.map(m=>{m.updateMatrix();return m.geometry.clone().applyMatrix4(m.matrix);});
      const geometry=mergeGeometries(geometries);
      if(geometry){const merged=new THREE.Mesh(geometry,material);merged.castShadow=true;merged.receiveShadow=true;this.scene.add(merged);meshes.forEach(m=>this.scene.remove(m));}
      geometries.forEach(g=>g.dispose());
    }
  }
  radialTexture(){
    const c=document.createElement('canvas');c.width=c.height=64;const cx=c.getContext('2d')!;
    const g=cx.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.25,'rgba(255,255,255,.6)');g.addColorStop(1,'rgba(255,255,255,0)');cx.fillStyle=g;cx.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);
  }
  makeDistrict(flight:Flight){
    const walls=[mat(0x627c86),mat(0x395c6c,.35,.35),mat(0x71878d),mat(0x526c76),mat(0x8c8e86),mat(0x405962,.35,.3)];
    const concrete=mat(0x778b8c),roof=new THREE.MeshStandardMaterial({color:0xa9b4b3,map:createSurfaceTexture('roof'),roughness:.92}),dark=mat(0x263f4b),trim=mat(0x91a5a6,.45,.3);
    const beaconMat=luminous(0xff9874,3);
    const trafficMats=[mat(0x72858c),mat(0xc4b6a4),mat(0x3e535e)];const trafficLight=luminous(0xff8869,2);
    const windowTransforms:THREE.Matrix4[]=[],windowColors:THREE.Color[]=[];
    const addWindows=(b:Building)=>{
      const curtain=(Math.round(b.x/70)+Math.round((b.z-12)/70)+10)%3===1;
      for(let level=3;level<b.h-1;level+=3.5){
        for(let side=0;side<4;side++){
          const extent=side<2?b.w:b.d;
          for(let pos=-extent/2+2;pos<extent/2-1;pos+=3.3){
            temp.position.set(side<2?b.x+pos:b.x+(side===2?-1:1)*(b.w/2+.025),level,side<2?b.z+(side===0?-1:1)*(b.d/2+.025):b.z+pos);
            temp.rotation.set(0,0,0);temp.scale.set(side<2?(curtain?3.1:2.35):.06,curtain?3.1:1.9,side<2?.06:(curtain?3.1:2.35));temp.updateMatrix();windowTransforms.push(temp.matrix.clone());
            windowColors.push(new THREE.Color(rand()>.80?(rand()>.4?0xd9a167:0x9abfac):(curtain?0x355866:0x243c48)));
          }
        }
      }
    };
    // A compact, legible street grid; the waterfront remains open on the west.
    const laneMat=luminous(0xa8b8a8,.15);
    for(let x=-175;x<=175;x+=70){
      this.box(x,.09,-56,1,.04,435,dark);
      for(let z=-270;z<160;z+=13)this.box(x,.12,z,.24,.02,4,laneMat);
      this.box(x-10,.12,-56,.25,.15,435,trim);this.box(x+10,.12,-56,.25,.15,435,trim);
    }
    for(const z of [-233,-163,-93,-23,48,119]){
      for(let x=-180;x<182;x+=13)this.box(x,.13,z,4,.02,.24,laneMat);
      this.box(0,.13,z-10,365,.2,.25,trim);this.box(0,.13,z+10,365,.2,.25,trim);
    }
    const pads=[OLD_TERRACE,...PADS];
    for(const building of BUILDINGS){
      const {x,z,h,w,d}=building;
      const pad=pads.find(p=>p.x===x&&p.z===z);


      const b={x,z,h,w,d};this.buildings.push(b);
      this.box(x,.22,z,47,.45,47,concrete);
      flight.box(x,.20,z,47,.4,47);
      this.box(x,h/2,z,w,h,d,walls[Math.floor(rand()*walls.length)]);flight.box(x,h/2,z,w,h,d);
      this.box(x,h-.25,z,w+.6,.5,d+.6,trim);
      this.box(x,h+.035,z,w-.8,.06,d-.8,roof);
      for(let level=4;level<h-1;level+=7)this.box(x,level,z,w+.12,.16,d+.12,dark);
      addWindows(b);
      // Roof machinery sits outside the landing circle.
      this.box(x+w/2-5,h+1.1,z-d/2+5,4,2.2,5,concrete);
      this.box(x+w/2-5,h+2.25,z-d/2+5,3.8,.12,4.8,dark);
      for(let slat=0;slat<5;slat++)this.box(x+w/2-6.5+slat*.7,h+2.35,z-d/2+5,.15,.1,4.5,trim);
      if(!pad && rand()>.6){
        this.box(x,h+1,z,8,2,7,concrete);this.box(x,h+5,z,.18,8,.18,trim);
        const lamp=new THREE.Mesh(new THREE.SphereGeometry(.24,6,4),beaconMat);lamp.position.set(x,h+9,z);this.scene.add(lamp);
      }
      if(pad)this.makePad(pad,pad===OLD_TERRACE?-1:PADS.indexOf(pad));
    }
    const windows=new THREE.InstancedMesh(boxGeo,new THREE.MeshBasicMaterial({color:0xffffff}),windowTransforms.length);
    windowTransforms.forEach((m,i)=>{windows.setMatrixAt(i,m);windows.setColorAt(i,windowColors[i]);});this.scene.add(windows);
    // Slender background towers soften into the haze.
    for(let i=0;i<42;i++){
      const x=-440+rand()*880,z=-340-rand()*210,h=25+rand()*110,w=14+rand()*26;
      if(i%5===0){
        const tower=new THREE.Mesh(new THREE.CylinderGeometry(w*.35,w*.5,h,12),walls[i%walls.length]);tower.position.set(x,h/2,z);this.scene.add(tower);
        this.box(x,h+6,z,.3,12,.3,trim);
      }else if(i%5===1){
        this.box(x,h*.35,z,w,h*.7,w,walls[i%walls.length]);
        this.box(x,h*.82,z,w*.68,h*.26,w*.68,walls[i%walls.length]);
        this.box(x,h*.98,z,w*.4,h*.08,w*.4,roof);
      }else this.box(x,h/2,z,w,h,w,walls[i%walls.length]);
      if(i%3===0){this.box(x,h+1,z,w*.65,2,w*.65,roof);this.box(x,h+2.05,z,w*.65,.08,w*.65,beaconMat);}
    }
    // Waterfront promenade, lamps, and repeated small trees.
    const trunk=mat(0x4a5453),leaf=mat(0x426d67),light=luminous(0xffd5a1,3);
    const leafGeo=new THREE.IcosahedronGeometry(2,1);
    for(let z=-260;z<162;z+=18){
      this.box(-183,1,z,1.1,2,1.1,concrete);this.box(-183,4,z,.15,5,.15,trunk);this.box(-183,6.5,z,1,.18,.9,light);
      this.box(-165,1.8,z,.5,3.6,.5,trunk);
      const tree=new THREE.Mesh(leafGeo,leaf);tree.position.set(-165,4,z);tree.scale.set(1,1.6,1);tree.castShadow=true;this.scene.add(tree);
    }
    // Road vehicles provide scale without a traffic simulation.
    for(let i=0;i<PARKED.length;i++){
      const {x,z}=PARKED[i];
      // Keep junctions and the racing line clear; these vehicles are parked at the curb.
      if([-233,-163,-93,-23,48,119].some(j=>Math.abs(z-j)<15))continue;
      this.box(x,.7,z,1.8,1.2,4,trafficMats[i%3]);
      flight.box(x,.7,z,1.8,1.2,4);
      this.box(x,.9,z+2.03,1.4,.12,.06,trafficLight);
    }
  }
  makePad(pad:Pad,index:number){
    const group=new THREE.Group();group.position.set(pad.x,pad.y+.09,pad.z);this.scene.add(group);
    const surface=new THREE.Mesh(new THREE.CylinderGeometry(pad.radius,pad.radius,.12,64),mat(0x263e48,.7,.25));surface.receiveShadow=true;group.add(surface);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(pad.radius-.25,.075,6,80),luminous(index<0?0xc8dcd0:0xc7c4a0,1));ring.rotation.x=-Math.PI/2;ring.position.y=.14;group.add(ring);
    const inner=new THREE.Mesh(new THREE.RingGeometry(pad.radius-1.2,pad.radius-1.08,64),new THREE.MeshBasicMaterial({color:0x7baca8,side:THREE.DoubleSide,transparent:true,opacity:.5}));inner.rotation.x=-Math.PI/2;inner.position.y=.15;group.add(inner);
    const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d')!;
    ctx.fillStyle='#b6d1c4';ctx.font='300 104px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(index<0?'V':String(index+1).padStart(2,'0'),128,125);
    ctx.font='15px Arial';ctx.fillText(index<0?'LAUNCH':'LANDING ZONE',128,195);
    const number=new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false}));number.rotation.x=-Math.PI/2;number.position.y=.16;group.add(number);
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2;const tile=this.box(Math.sin(a)*(pad.radius+.5),.2,Math.cos(a)*(pad.radius+.5),.5,.18,.5,luminous(0xffc28a,2),group);tile.rotation.y=a;
    }
  }
  makeCar(){
    this.car=createRoadster();
    const graphite=mat(0x14212a,.3,.65),chrome=mat(0x8ca5ad,.22,.9);
    for(const p of THRUST_POINTS){
      const nozzle=new THREE.Group();nozzle.position.copy(p);this.car.add(nozzle);this.nozzles.push(nozzle);
      const shroud=new THREE.Mesh(new THREE.CylinderGeometry(.12,.17,.15,12,1,true),graphite);shroud.position.y=-.12;nozzle.add(shroud);
      const rim=new THREE.Mesh(new THREE.TorusGeometry(.16,.018,6,16),chrome);rim.rotation.x=Math.PI/2;rim.position.y=-.20;nozzle.add(rim);
      const flame=new THREE.Mesh(new THREE.ConeGeometry(.15,1,12,1,true),new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec2 vUv;void main(){float a=(1.-vUv.y)*.8;vec3 c=mix(vec3(.25,.9,1.),vec3(.8,1.,.9),pow(1.-vUv.y,3.));gl_FragColor=vec4(c,a);}`}));
      // Cone tip points down, wide mouth meets the nozzle.
      flame.rotation.z=Math.PI;flame.position.y=-.8;nozzle.add(flame);this.flames.push(flame);
    }
    const glow=new THREE.PointLight(0x90ffdc,3,8,2);glow.position.set(0,-.7,0);this.car.add(glow);
  }
  update(flight:Flight,dt:number){
    const lastShadowTick=Math.floor(this.elapsed*12);
    this.elapsed+=dt;this.water.uniforms.time.value=this.elapsed;
    if(Math.floor(this.elapsed*12)!==lastShadowTick)this.renderer.shadowMap.needsUpdate=true;
    this.car.position.copy(flight.position);this.car.quaternion.copy(flight.quaternion);
    const wheels=this.car.userData.wheels as THREE.Group[];
    wheels?.forEach((wheel,i)=>{wheel.position.y=.04-flight.wheelLengths[i];wheel.rotation.y=(i<2?-1:1)*Math.PI/2+flight.wheelSteering[i];wheel.rotation.z=(i<2?-1:1)*flight.wheelSpins[i];});
    this.flames.forEach((flame,i)=>{
      const power=flight.thrusts[i];flame.visible=power>.02;
      const length=.25+power*2.1+(Math.sin(this.elapsed*70+i)*.07);flame.scale.set(.8+power*.3,length, .8+power*.3);flame.position.y=-.3-length/2;
    });
    const roof=this.surfaceAt(flight.position.x,flight.position.z);
    const above=flight.position.y-roof;
    this.shadow.position.set(flight.position.x,roof+.16,flight.position.z);this.shadow.rotation.z=-flight.yaw;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity=.33*Math.max(0,1-above/25);this.shadow.scale.setScalar(1+Math.max(0,above)*.035);
    this.sun.position.copy(flight.position).add(new THREE.Vector3(-130,64,-140));this.sun.target.position.copy(flight.position);
    for(let i=0;i<180;i++){
      if(this.particleLife[i]>0){this.particleLife[i]-=dt;for(let a=0;a<3;a++)this.particleData[i*3+a]+=this.particleVelocity[i*3+a]*dt;if(this.particleLife[i]<=0)this.particleData[i*3+1]=-100;}
    }
    if(flight.throttle>.1 && dt>0){
      for(let i=0;i<4;i++){
        const n=this.particleCursor++%180;const pos=THRUST_POINTS[i].clone().applyQuaternion(flight.quaternion).add(flight.position);
        const vel=flight.up.clone().multiplyScalar(-9).addScaledVector(flight.velocity,.3);
        this.particleData.set([pos.x,pos.y-.3,pos.z],n*3);this.particleVelocity.set([vel.x+(rand()-.5)*2,vel.y,vel.z+(rand()-.5)*2],n*3);this.particleLife[n]=.3+rand()*.3;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate=true;
  }
  surfaceAt(x:number,z:number){
    for(const b of this.buildings)if(Math.abs(x-b.x)<b.w/2&&Math.abs(z-b.z)<b.d/2)return b.h;
    return Math.abs(x)<190&&z>-281&&z<169?0:-2;
  }
  setQuality(quality:string){
    this.quality=quality;this.performanceWindow=[];this.performanceSeconds=0;
    this.renderScale=quality==='high'?Math.min(devicePixelRatio,1.25):quality==='low'?.70:Math.min(devicePixelRatio,1);
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.shadowMap.enabled=quality!=='low';this.renderer.shadowMap.needsUpdate=true;
    this.bloom.enabled=quality==='high';this.resize();
  }
  trackPerformance(dt:number){
    if(this.quality!=='balanced'||dt<=0||dt>.15)return;
    this.performanceWindow.push(dt);this.performanceSeconds+=dt;
    if(this.performanceSeconds<4)return;
    const average=this.performanceSeconds/this.performanceWindow.length;
    let scale=this.renderScale;
    if(average>1/43)scale=Math.max(.72,scale-.07);
    else if(average<1/57)scale=Math.min(Math.min(devicePixelRatio,1),scale+.035);
    this.performanceSeconds=0;this.performanceWindow=[];
    if(Math.abs(scale-this.renderScale)>.01){this.renderScale=scale;this.renderer.setPixelRatio(scale);this.resize();}
  }
  resize(){
    this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth,innerHeight);this.composer.setPixelRatio(this.renderScale);this.composer.setSize(innerWidth,innerHeight);
    this.cinema.resize(innerWidth,innerHeight,this.renderScale);
  }
  render(){this.renderer.info.reset();this.composer.render();}
}

