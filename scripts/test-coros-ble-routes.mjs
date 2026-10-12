import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {encodeWatchRoute, decodeRouteInventory, routeSlot, encodeRouteBlockHeader, crc16Ccitt} = require('../dist-electron/corosBleRouteProtocol.js');
const {crc32Mpeg2} = require('../dist-electron/corosBleAuth.js');
assert.equal(crc16Ccitt(Buffer.from('123456789')), 0x29b1);

// Independent indexed-page decoder: validate the geometry that a watch reads.
function decode(file) {
  assert.equal(file.subarray(0,4).toString('hex'), '48460014');
  assert.equal(file.readUInt16LE(14), crc16Ccitt(file.subarray(0,14)));
  const body=file.subarray(16), track=body.subarray(512);
  assert.equal(file.readUInt32LE(8),body.length);
  assert.equal(file.readUInt16LE(12),crc16Ccitt(body));
  assert.equal(body.subarray(0,4).toString(),'HTRK');
  assert.equal(body.readUInt32LE(5),512);
  assert.equal(body.readUInt32LE(13),track.length);
  assert.equal(body.readUInt32LE(9),crc32Mpeg2(track));
  assert.equal(track.subarray(0,4).toString(),'TRK\0');
  const offset=track.readUInt16LE(19)*16, count=track.readUInt16LE(17)+1;
  const data=track.readUInt16LE(35)*512;
  const indexOffset=track.readUInt16LE(27)*16;
  assert.equal(track.readUInt16LE(indexOffset+7),count);
  const points=[];
  for(let page=0;page<count;page++) {
    const meta=offset+page*16;
    const signed24=at=>{const n=track.readUIntLE(at,3);return n&0x800000?n-0x1000000:n;};
    let x=signed24(meta+1), y=signed24(meta+5);
    assert.ok([0x10,0x12,0x14,0x16].includes(track[meta]));
    assert.equal(track.readInt32LE(indexOffset+9+page*8),x);
    assert.equal(track.readInt32LE(indexOffset+13+page*8),y);
    if(track[meta]===0x10)points.push({x,y});
    let end=false;
    for(let step=0;step<512;step+=4) {
      const dx=track.readInt16LE(data+page*512+step), dy=track.readInt16LE(data+page*512+step+2);
      if(dx===-32768&&dy===-32768){end=true;break;}
      x+=dx;y+=dy;if(track[meta]===0x10)points.push({x,y});
    }
    assert.equal(end,true);
  }
  return points;
}
const make=points=>({id:'route-test',name:'Trail 🏃 '.repeat(30),createdAt:'2026-10-08T12:00:00Z',distanceMeters:20_000,points});
for (const points of [
  [{lat:43,lon:-79},{lat:43.001,lon:-78.999}],
  Array.from({length:1000},(_,i)=>({lat:43+Math.sin(i/80)/200,lon:-79+i/10000})),
  [{lat:-43,lon:178},{lat:43,lon:-178}],
  Array.from({length:129},(_,i)=>({lat:20+i/100000,lon:30+i/100000}))
]) {
  const encoded=encodeWatchRoute(make(points));
  assert.deepEqual(decode(encoded.file),points.map(p=>({x:Math.trunc(p.lon/360*2**24),y:Math.trunc(p.lat/360*2**24)})).filter((p,i,a)=>i===0||p.x!==a[i-1].x||p.y!==a[i-1].y));
  const name=encoded.file.subarray(61,181).toString('utf8').split('\0')[0];
  assert.equal(name,encoded.watchName);assert.equal(name.includes('\ufffd'),false);
  for(let offset=0;offset<encoded.file.length;offset+=4096){
    const block=encoded.file.subarray(offset,offset+4096),header=encodeRouteBlockHeader(block,offset,encoded.file.length,2);
    assert.equal(header.readUInt32LE(3),offset);assert.equal(header.readUInt16LE(7),block.length);
    assert.equal(header.readUInt32LE(9),encoded.file.length-offset);
    assert.equal(header[16],2);assert.equal(header[19],3);
    assert.equal(header[20],header.subarray(2,20).reduce((s,b)=>(s+b)&255,0));
  }
}
const empty=decodeRouteInventory(Buffer.from('0064000d0000','hex'));
assert.equal(empty.capacity,100);assert.equal(routeSlot(empty,'123'),0);
const payload=Buffer.alloc(19);Buffer.from('0064010d0000','hex').copy(payload);payload[6]=2;
payload.writeBigUInt64LE(123n,7);payload.writeUInt16LE(0x1234,15);
const inventory=decodeRouteInventory(payload);
assert.equal(routeSlot(inventory,'123'),2);assert.equal(routeSlot(inventory,'456'),0);
assert.throws(()=>routeSlot({capacity:1,entries:[{slot:0,trackId:'123'}]},'456'),/full/);
assert.throws(()=>decodeRouteInventory(Buffer.from('0064020d0000','hex')),/unsupported/);
assert.throws(()=>encodeWatchRoute(make([{lat:999,lon:0},{lat:0,lon:1}])) ,/GPS point/);
assert.throws(()=>encodeWatchRoute(make([{lat:0,lon:0},{lat:0,lon:0}])),/distinct/);
assert.throws(()=>encodeWatchRoute(make(Array(40001).fill({lat:0,lon:0}))),/40,000/);
console.log('COROS route geometry, indexed pages, checksums, inventory and multi-block tests passed.');
