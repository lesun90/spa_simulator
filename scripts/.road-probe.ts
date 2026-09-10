import {discoverAssetCatalog} from '../server/assetCatalog';
import {paletteFromAssets} from '../src/wfc/sceneLayout';
import {createWorldPlan} from '../src/wfc/worldPlanner';
import {planScenicWorld} from '../src/wfc/scenicWorldPlan';
import {solvePlanarWfc} from '../src/wfc/planarWfc';
import {policiesFromWorldPlan,validateWorldPlanResult} from '../src/wfc/worldPlanPolicies';
const p=paletteFromAssets('probe',await discoverAssetCatalog('assets'),{purpose:'road-scene'});
for (const width of [10,16,24,32]) for (const seed of [13,134,1345]) {
 const start=performance.now();
 const plan=planScenicWorld(createWorldPlan({width,depth:width,seed,roadCoverage:.5,scenic:true}),p,seed);
 const r=solvePlanarWfc(p,{width,depth:width,seed,policies:policiesFromWorldPlan(plan)});
 const c=r.status==='solved'?r.cells:[];
 console.log({width,seed,ms:Math.round(performance.now()-start),status:r.status,diagnostics:validateWorldPlanResult(plan,p,r),counts:Object.fromEntries([...new Set(c.map(x=>x.variant.assetId))].map(id=>[id.split('tile-')[1],c.filter(x=>x.variant.assetId===id).length]))});
 if(width===10&&seed===13)for(let row=9;row>=0;row--) console.log(Array.from({length:10},(_,col)=>c.find(x=>x.row===row&&x.column===col)?.variant.assetId.split('tile-')[1]??'---').join(' '));
}
