import { vi } from 'vitest';
export const labelLayer = { id:'poi_label_peak_rank_1',type:'symbol',source:'mtk','source-layer':'poi_label',layout:{'text-field':['get','name'],'text-size':12},paint:{'text-halo-color':'white','text-halo-width':1} };
export class MockMap {
  static instances: MockMap[] = [];
  handlers: Record<string, ((e: any) => void)[]> = {};
  features: any[] = [];
  canvas = document.createElement('canvas');
  setPaintProperty = vi.fn();
  queryRenderedFeatures = vi.fn(() => this.features);
  remove = vi.fn();
  controls: any[] = [];
  options: any;
  constructor(options: any) {
    this.options = options;
    MockMap.instances.push(this);
    options.container.innerHTML = '<div class="maplibregl-ctrl-attrib"><a href="https://www.maptoolkit.com/copyright/">© Maptoolkit</a> <a href="https://www.openstreetmap.org/copyright">© Openstreetmap</a></div>';
  }
  on(name: string, handler: (e: any) => void) { (this.handlers[name] ??= []).push(handler); return this; }
  fire(name: string, e: any = {}) {this.handlers[name]?.forEach(h => h(e));}
  style: any = {version:8,sources:{},layers:[structuredClone(labelLayer)]};
  setStyle = vi.fn((url: string, options: any) => {
    this.styleUrl = url;
    this.style = options.transformStyle(undefined, {version:8,sources:{},layers:[structuredClone(labelLayer)]});
    return this;
  });
  styleUrl = '';
  jumpTo = vi.fn((options: any) => { this.options.center = options.center; return this; });
  getStyle() {return this.style;}
  getCanvas() {return this.canvas;}
  getContainer() {return this.options.container;}
  addControl(control: any, position: string) {this.controls.push({control,position}); if (control.onAdd) this.options.container.appendChild(control.onAdd(this));}
}
export class MockMarker {
  static instances: MockMarker[] = [];
  coordinates: number[] = [];
  constructor() {MockMarker.instances.push(this);}
  setLngLat = vi.fn((coordinates: number[]) => {this.coordinates = coordinates; return this;});
  addTo() {return this;}
  remove = vi.fn();
}
export const maplibreMock = {default:{Map:MockMap,Marker:MockMarker,NavigationControl:class {}}};
