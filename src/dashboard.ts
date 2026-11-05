import './dashboard.css';

export type Readings = { speed: number; reserve: number; altitude: number; thrust: number; state: string };

/** Presentation only: consumes measurements, never controls the vehicle. */
export class Dashboard {
  private speed: HTMLElement;
  private reserve: HTMLElement;
  private altitude: HTMLElement;
  private thrust: HTMLElement;
  private state: HTMLElement;
  private dials: HTMLElement[];

  constructor(root: HTMLElement) {
    root.classList.add('dashboard');
    root.innerHTML = `
      <div class="dial speed-dial"><span class="vehicle-state">PARKED</span><strong data-speed>0</strong><span class="unit">KM / H</span></div>
      <div class="dial small-dial"><span class="dial-label">RESERVE</span><strong data-reserve>100</strong><span class="unit">%</span></div>
      <div class="dial small-dial"><span class="dial-label">ALTITUDE</span><strong data-altitude>0</strong><span class="unit">M</span></div>
      <div class="thrust-meter"><span>THRUST</span><div><i></i></div></div>`;
    this.speed = root.querySelector('[data-speed]')!;
    this.reserve = root.querySelector('[data-reserve]')!;
    this.altitude = root.querySelector('[data-altitude]')!;
    this.thrust = root.querySelector('.thrust-meter i')!;
    this.state = root.querySelector('.vehicle-state')!;
    this.dials = Array.from(root.querySelectorAll<HTMLElement>('.dial'));
  }

  update(readings: Readings) {
    this.speed.textContent = String(Math.round(readings.speed));
    this.reserve.textContent = String(Math.round(readings.reserve));
    this.altitude.textContent = String(Math.round(readings.altitude));
    this.state.textContent = readings.state;
    [readings.speed / 100, readings.reserve / 100, readings.altitude / 100].forEach((value, i) => {
      this.dials[i].style.setProperty('--sweep', `${Math.max(0, Math.min(1, value)) * 270}deg`);
    });
    this.dials[1].classList.toggle('low', readings.reserve < 20);
    this.thrust.style.width = `${Math.max(0, Math.min(1, readings.thrust)) * 100}%`;
  }
}
