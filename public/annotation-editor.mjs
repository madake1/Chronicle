import { parseYear, formatYear } from './chronology.mjs';

export function annotationEditor(container, add) {
  function append(item) {
    const row = document.createElement('div');
    row.className = 'segment-edit';
    function field(label, control, value) {
      const wrapper = document.createElement('label');
      wrapper.append(label, control);
      control.value = value ?? '';
      row.append(wrapper);
      return control;
    }
    const select = (label, choices, value) => {
      const control = document.createElement('select');
      for (const [text, key] of choices) control.add(new Option(text, key));
      return field(label, control, value ?? choices[0][1]);
    };
    const input = (label, value) => field(label, document.createElement('input'), value);
    const kind = select('时间表达', [['年份落点', 'point'], ['起止跨度', 'range'], ['可能发生范围', 'window']], item?.kind);
    const start = input('年份 / 起始年份', item?.start === undefined ? '' : formatYear(item.start));
    start.placeholder = '例如 公元前 1 年';
    const end = input('结束年份', item?.end === undefined ? '' : formatYear(item.end));
    const confidence = select('可信度', ['确定', '推测', '约略'].map(value => [value, value]), item?.confidence);
    const place = input('地点名称', item?.place);
    const longitude = input('经度（−180 到 180）', item?.longitude);
    const latitude = input('纬度（−90 到 90）', item?.latitude);
    const description = input('说明', item?.description);
    const source = input('来源', item?.source);
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.textContent = '地图选点';
    const picker = document.createElement('div');
    picker.className = 'annotation-picker';
    picker.hidden = true;
    const pickerMessage = document.createElement('p');
    pickerMessage.setAttribute('role', 'status');
    row.append(pick, pickerMessage, picker);
    let map;
    pick.onclick = async () => {
      if (!picker.hidden) {
        picker.hidden = true;
        return;
      }
      picker.hidden = false;
      if (map) { map.resize(); return; }
      pick.disabled = true;
      try {
        const { Map, setWorkerUrl } = await import('/atlas/vendor/maplibre-gl.mjs');
        if (!row.isConnected) return;
        setWorkerUrl('/atlas/vendor/maplibre-gl-worker.mjs');
        map = new Map({ container: picker, center: [0, 20], zoom: 1,
          renderWorldCopies: false, style: { version: 8,
            sources: { land: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
            layers: [
              { id: 'water', type: 'background', paint: { 'background-color': '#aac9d7' } },
              { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#e9e4d4' } },
            ],
          },
        });
        map.on('click', event => {
          const { lng, lat } = event.lngLat.wrap();
          longitude.value = lng.toFixed(6);
          latitude.value = lat.toFixed(6);
          pickerMessage.textContent = '已填入地图坐标';
          picker.hidden = true;
        });
        map.on('load', async () => {
          try {
            const response = await fetch('/atlas/data/land.geojson');
            if (!response.ok) throw new Error('missing land');
            await map?.getSource('land')?.setData(await response.json());
          } catch {
            pickerMessage.textContent = '地理参照缺失，仍可选点或手填经纬度。';
          }
        });
      } catch {
        picker.hidden = true;
        pickerMessage.textContent = '地图无法启动，请手填经纬度。';
      } finally { pick.disabled = false; }
    };
    const sync = () => { end.parentElement.hidden = kind.value === 'point'; };
    kind.onchange = sync;
    sync();
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '移除标注';
    row.dispose = () => { map?.remove(); map = undefined; };
    remove.onclick = () => { row.dispose(); row.remove(); };
    row.append(remove);
    row.read = () => {
      const fields = { ...item, id: item?.id ?? row.annotationId };
      for (const key of ['kind', 'start', 'end', 'confidence', 'place', 'description', 'source', 'longitude', 'latitude']) delete fields[key];
      if (start.value.trim() || !end.parentElement.hidden && end.value.trim()) {
        fields.kind = kind.value;
        fields.start = parseYear(start.value);
        fields.confidence = confidence.value;
        if (kind.value !== 'point') {
          fields.end = parseYear(end.value);
          if (fields.end <= fields.start) throw new Error('结束年份必须晚于起始年份');
        }
      }
      if (longitude.value.trim() || latitude.value.trim()) {
        fields.longitude = Number(longitude.value);
        fields.latitude = Number(latitude.value);
        if (!longitude.value.trim() || !latitude.value.trim() ||
            !(Math.abs(fields.longitude) <= 180 && Math.abs(fields.latitude) <= 90)) {
          throw new Error('请输入完整且有效的经纬度');
        }
      }
      for (const [key, control] of Object.entries({ place, description, source })) {
        if (control.value.trim()) fields[key] = control.value.trim();
      }
      if (fields.start === undefined && fields.longitude === undefined && !fields.place) return null;
      return fields;
    };
    row.annotationId = item?.id ?? crypto.randomUUID();
    container.append(row);
  }
  add.onclick = () => append();
  return {
    load(items = []) {
      for (const row of container.children) row.dispose();
      container.replaceChildren();
      items.forEach(append);
    },
    value() { return [...container.children].map(row => row.read()).filter(Boolean); },
  };
}
