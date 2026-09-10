import {discoverAssetCatalog} from '../server/assetCatalog';
import {paletteFromAssets} from '../src/wfc/sceneLayout';
import {solvePlanarWfc,planarDirections,oppositeDirection,type PlanarPolicySpec} from '../src/wfc/planarWfc';
const p=paletteFromAssets('lake',await discoverAssetCatalog('assets'),{purpose:'road-scene'});
const num=(v:any)=>v.assetId.split('tile-')[1];
for(const id of ['048','153'])for(const v of p.variants.filter(v=>num(v)===id).slice(0,1))console.log(id,v.semanticPorts,Object.fromEntries(planarDirections.map(d=>[d,p.adjacency[v.id][d].filter(n=>/tile-(162|048|153|163)@/.test(n))])));
const width=10,depth=10;const policies:PlanarPolicySpec[]=[];
const dirs=(v:any,ch:string)=>planarDirections.filter(d=>v.semanticPorts?.[d]?.includes(ch));
for(let row=0;row<depth;row++)for(let column=0;column<width;column++){
 const rd:string[]=[];
 if(column===1&&row>=1&&row<=8){if(row<8)rd.push('north');if(row>1)rd.push('south');if(row===1||row===8||row===4)rd.push('east');}
 if(column===8&&row>=1&&row<=8){if(row<8)rd.push('north');if(row>1)rd.push('south');if(row===1||row===8||row===4)rd.push('west');}
 if(column>1&&column<8&&[1,4,8].includes(row))rd.push('east','west');
 const vs=p.variants.filter(v=>{
  const id=num(v);if(dirs(v,'road').length!==rd.length||!dirs(v,'road').every(d=>rd.includes(d)))return false;
  for(const d of planarDirections){if((d==='north'&&row===9)||(d==='south'&&row===0)||(d==='east'&&column===9)||(d==='west'&&column===0))if(dirs(v,'water').includes(d))return false;}
  if(rd.length){if(row===4&&[4,5].includes(column))return id==='207';if(row===4&&[3,6].includes(column))return ['154','161','165','171','180'].includes(id);return ['025','027','153','162'].includes(id);}
  const inLake=column>=2&&column<=7&&row>=2&&row<=7;
  if(!inLake&&dirs(v,'water').length)return false;
  return ['163','036','037','140','151','152','012'].includes(id)||(v.roles?.includes('terrain.water')&&!['215','242','244','176'].includes(id));
 });
 if(!vs.length)console.log('empty',column,row,rd);
 policies.push({type:'cell-variants',id:`${column},${row}`,column,row,variantIds:vs.map(v=>v.id)});
}
const r=solvePlanarWfc(p,{width,depth,seed:13,maxBacktracks:50,policies});console.log(r.status,r.status==='failed'?r:r.backtracks);
if(r.status==='solved')for(let y=9;y>=0;y--)console.log(r.cells.filter(c=>c.row===y).map(c=>num(c.variant)).join(' '));
