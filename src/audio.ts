export class FlightAudio {
  context:AudioContext|null=null;
  master:GainNode|null=null;
  engine:OscillatorNode|null=null;
  engineGain:GainNode|null=null;
  noiseGain:GainNode|null=null;
  filter:BiquadFilterNode|null=null;
  enabled=false;
  init(){
    if(this.context){void this.context.resume();return;}
    const ctx=new AudioContext();this.context=ctx;
    this.master=ctx.createGain();this.master.gain.value=0;this.master.connect(ctx.destination);
    this.engine=ctx.createOscillator();this.engine.type='triangle';this.engine.frequency.value=45;
    this.engineGain=ctx.createGain();this.engineGain.gain.value=0;this.engine.connect(this.engineGain);this.engineGain.connect(this.master);this.engine.start();
    const buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*.6;
    const noise=ctx.createBufferSource();noise.buffer=buffer;noise.loop=true;
    this.filter=ctx.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=400;
    this.noiseGain=ctx.createGain();this.noiseGain.gain.value=0;
    noise.connect(this.filter);this.filter.connect(this.noiseGain);this.noiseGain.connect(this.master);noise.start();
  }
  toggle(){this.init();this.enabled=!this.enabled;this.master!.gain.setTargetAtTime(this.enabled?.25:0,this.context!.currentTime,.15);return this.enabled;}
  update(thrust:number,speed:number,paused:boolean,grounded=false,motor=0,slip=0){
    if(!this.context)return;const t=this.context.currentTime;
    this.engine!.frequency.setTargetAtTime(grounded?48+speed*5+motor*35:38+thrust*65+speed*.35,t,.1);
    this.engineGain!.gain.setTargetAtTime(paused?0:grounded?.025+motor*.12:thrust*.18,t,.12);
    this.noiseGain!.gain.setTargetAtTime(paused?0:Math.min(.65,thrust*.55+speed*.003+(grounded?Math.min(.2,slip*.025):0)),t,.15);
    this.filter!.frequency.setTargetAtTime(250+thrust*1250+speed*7+(grounded?slip*160:0),t,.1);
  }
  private tone(frequency:number,duration:number,volume:number){
    if(!this.context||!this.enabled)return;const ctx=this.context,o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=frequency;g.gain.setValueAtTime(volume,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+duration);o.connect(g);g.connect(this.master!);o.start();o.stop(ctx.currentTime+duration);
  }
  tick(go:boolean){this.tone(go?880:440,.18,.15);}
  land(speed:number){this.tone(65,.18,Math.min(.25,speed*.025));}
  chime(){
    if(!this.context||!this.enabled)return;const ctx=this.context;
    [523.25,659.25,783.99].forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=f;o.type='sine';g.gain.setValueAtTime(0,ctx.currentTime);g.gain.linearRampToValueAtTime(.18,ctx.currentTime+i*.11+.02);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+i*.11+.8);o.connect(g);g.connect(this.master!);o.start(ctx.currentTime+i*.11);o.stop(ctx.currentTime+i*.11+.85);});
  }
}
