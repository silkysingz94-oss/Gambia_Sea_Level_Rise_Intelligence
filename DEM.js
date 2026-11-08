const demPointCache = new Map();

async function getTerrariumElevation(lon, lat, z=12) {
  const n = Math.pow(2,z);

  const x = (lon+180)/360*n;
  const latRad = lat*Math.PI/180;
  const y = (1-Math.asinh(Math.tan(latRad))/Math.PI)/2*n;

  const tx=Math.floor(x);
  const ty=Math.floor(y);
  const key=`${z}/${tx}/${ty}`;

  if (!demPointCache.has(key)) {
    const promise=(async()=>{
      const url =
        `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;

      const response=await fetch(url);
      if (!response.ok) throw new Error('DEM unavailable');

      const bitmap=await createImageBitmap(await response.blob());
      const canvas=document.createElement('canvas');
      canvas.width=256;
      canvas.height=256;

      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(bitmap,0,0);

      return canvas;
    })();

    demPointCache.set(key,promise);
  }

  const canvas=await demPointCache.get(key);
  const px=Math.min(255,Math.floor((x-tx)*256));
  const py=Math.min(255,Math.floor((y-ty)*256));

  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const pixel=ctx.getImageData(px,py,1,1).data;

  return (pixel[0]*256+pixel[1]+pixel[2]/256)-32768;
}

async function updateExposure() {
  if (!eaData) return;

  const popField=$('popField').value;
  const hhField=$('hhField').value;
  const nameField=$('nameField').value;
  const threshold=effectiveLevel();

  let population=0;
  let households=0;
  let count=0;

  exposureResults=[];

  const candidates=eaData.features.filter(feature=>{
    if (!feature.geometry) return false;

    if (selectedGeometry) {
      try {
        return turf.booleanIntersects(
          feature.geometry,selectedGeometry
        );
      } catch(e) {
        return false;
      }
    }

    return true;
  });

  // Process in batches to avoid excessive concurrent requests.
  for(let start=0;start<candidates.length;start+=100) {
    const batch=candidates.slice(start,start+100);

    const results=await Promise.all(batch.map(async feature=>{
      try {
        const centroid=turf.centroid(feature);
        const coordinates=centroid.geometry.coordinates;

        if (!pointInSelectedArea({
          lng:coordinates[0],
          lat:coordinates[1]
        })) return null;

        const elevation=await getTerrariumElevation(
          coordinates[0],coordinates[1]
        );

        const props=feature.properties || {};
        const pop=Number(props[popField])||0;
        const hh=Number(props[hhField])||0;
        const exposed=elevation<=threshold;

        return {
          name:props[nameField]||'Unnamed EA',
          pop,hh,elevation,exposed,
          coordinates
        };
      } catch(e) {
        return null;
      }
    }));

    results.forEach(item=>{
      if (!item) return;

      exposureResults.push(item);

      if(item.exposed) {
        population+=item.pop;
        households+=item.hh;
        count++;
      }
    });
  }

  $('exposedPop').textContent=fmt(population,0);
  $('exposedHH').textContent=fmt(households,0);
  $('exposedFeatures').textContent=fmt(count,0);
}