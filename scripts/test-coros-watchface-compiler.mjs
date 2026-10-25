import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import zlib from 'node:zlib';
const require=createRequire(import.meta.url);
const {prepareLocalWatchfaceZip,CorosWatchfaceCompiler}=require('../dist-electron/corosWatchfaceCompiler.js');
const {createStoreZip}=require('../dist-electron/zipStore.js');
const {compileWatchface,WatchfaceCompileError}=require('../dist-electron/watchfaceCompiler/compiler.js');
const {FIELDS}=require('../dist-electron/watchfaceCompiler/fields.js');
const {cbzCompress,encodeImageBlock,encodeFramesBlock}=require('../dist-electron/watchfaceCompiler/bitmap.js');
const {parseConfig,parsePos,parseRect,rgb222}=require('../dist-electron/watchfaceCompiler/config.js');
const {decodePng}=require('../dist-electron/watchfaceCompiler/png.js');
const {findCorosBitmapBlocks,decodeCorosBitmapFrame,decodeCorosLayout}=require('../dist-electron/corosBinLayout.js');
const unzipper=require('unzipper');
const {getWatchfaceTarget}=require('../dist-electron/watchfaceTargets.js');

// Minimal PNG writer: colorType 6 RGBA unless given, rows already in the target format.
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type,'latin1'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));return Buffer.concat([len,body,crc]);};
function pngRaw(width,height,depth,colorType,rows,extra=[]){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=depth;ihdr[9]=colorType;
 const data=Buffer.concat(rows.map(row=>Buffer.concat([Buffer.from([0]),Buffer.from(row)])));
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),...extra,chunk('IDAT',zlib.deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);
}
const png=(width,height,fill=()=>[255,255,255,255])=>pngRaw(width,height,8,6,Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>fill(x,y)).flat()));
/** CRC-16/CCITT-FALSE over bytes 18 onward, as stored at 12. */
function crc16(bytes){let crc=0xffff;for(const byte of bytes){crc^=byte<<8;for(let bit=0;bit<8;bit++)crc=crc&0x8000?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;}return crc;}
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'coros-compiler-test-'));
const entry=(name,data)=>({name,data:Buffer.from(data)});
try {
 const make=async(name,entries)=>{const filename=path.join(temp,name);await fs.writeFile(filename,createStoreZip(entries));return filename;};
 const basic=[entry('info.json','{"m_app":"watchface_800x800"}'),entry('watchface_416x416/config.txt','[watchface_id]=0'),entry('watchface_800x800/config.txt','[watchface_id]=0')];
 const valid=await prepareLocalWatchfaceZip(await make('valid.dat',basic));
 const normalized=await unzipper.Open.buffer(valid.zip);
 assert.ok(normalized.files.some(e=>e.path==='watchface_416x416/config.txt'));
 assert.equal(normalized.files.some(e=>e.path.startsWith('watchface_800x800/')),false);
 assert.equal(JSON.parse((await normalized.files.find(e=>e.path==='info.json').buffer()).toString()).m_app,'watchface_416x416');
 assert.equal((await prepareLocalWatchfaceZip(await make('nested.zip',basic.map(e=>({...e,name:'Wrapper/'+e.name}))))).faceId,valid.faceId);
 assert.equal((await prepareLocalWatchfaceZip(await make('same.dat',basic))).faceId,valid.faceId,'identical source gives stable local ID');
 assert.ok(valid.faceId>=0x40000000&&valid.faceId<=0x7fffffff);
 await assert.rejects(prepareLocalWatchfaceZip(await make('unsafe.zip',[...basic,entry('../escape.png','x')])) ,/unsafe/);
 await assert.rejects(prepareLocalWatchfaceZip(await make('project.zip',[entry('coroslink-project.json','{}')])) ,/final/);
 await assert.rejects(prepareLocalWatchfaceZip(await make('wrong.zip',[entry('info.json','{}'),entry('watchface_800x800/config.txt','')])) ,/416/);
 const unconfigured=new CorosWatchfaceCompiler(temp);
 assert.deepEqual([unconfigured.status().available,'engine' in unconfigured.status()],[true,false],'CorosLink\'s own compiler needs no setup and there is no other engine');
 await assert.rejects(unconfigured.compile(path.join(temp,'missing.dat'),'x'));
 assert.equal(unconfigured.status().busy,false);
 assert.throws(()=>unconfigured.fileForPreview('arbitrary'),/Compile/);
 console.log('Local compiler archive bounds, normalization, stable IDs and opaque export tokens passed.');

 // Built-in compiler units: COROS RLE, config parsing quirks, PNG decoding.
 assert.deepEqual([...cbzCompress(Uint8Array.from([1,1,1,2,0xc5,3]))],[0xc3,1,2,0xc1,0xc5,3]);
 assert.deepEqual([...cbzCompress(new Uint8Array(70).fill(7))],[0xff,7,0xc7,7],'runs split at 63');
 assert.deepEqual([rgb222(0xffffff),rgb222(0xff0000),rgb222(0x00aa55),rgb222(0)],[0x3f,0x30,0x09,0]);
 assert.deepEqual(parsePos('{-12, 34}'),[12,34],'COROS drops minus signs in positions');
 assert.deepEqual(parseRect('{10,20,30,40}'),{x0:10,y0:20,x1:30,y1:40,align:0});
 assert.deepEqual(parseRect('{-1,2,70000,4,right|bottom}'),{x0:-1,y0:2,x1:4464,y1:4,align:0x24});
 assert.equal(parseRect('{1,2,3,4,left}').align,0x11,'a present alignment field centres the other axis');
 assert.deepEqual([...parseConfig('[a]=1\r\n[a]=2\n[b]=\n[b]=3\n junk\n')],[['a','1'],['b','3']],'first key wins; empty counts as absent');
 const gray=decodePng(pngRaw(2,1,8,0,[[0,255]]));
 assert.deepEqual([...gray.data],[0,0,0,255,255,255,255,255]);
 assert.deepEqual([...decodePng(pngRaw(1,1,16,0,[[0x12,0x34]])).data],[0x12,0x12,0x12,255],'16-bit keeps the high byte');
 const paletted=decodePng(pngRaw(9,1,1,3,[[0b01000000,0b10000000]],[chunk('PLTE',Buffer.from([255,0,0,0,0,255])),chunk('tRNS',Buffer.from([128]))]));
 assert.deepEqual([...paletted.data.subarray(0,8)],[255,0,0,128,0,0,255,255]);
 assert.deepEqual([...paletted.data.subarray(32,36)],[0,0,255,255],'1-bit rows continue into the next byte');
 assert.throws(()=>decodePng(Buffer.from('not a png')),/PNG/);
 const block=encodeImageBlock(decodePng(png(4,2,x=>x<2?[255,0,0,255]:[0,0,255,255])));
 assert.deepEqual([block.readUInt16LE(0),block.readUInt16LE(2),block[5],block[6],block[7]],[4,2,0x20,1,1],'two colours encode as one LUT frame');
 assert.throws(()=>encodeFramesBlock([]),/at least one/);

 // The built-in engine end to end, through the service and its worker.
 const glyphs=Object.fromEntries(Array.from({length:10},(_,d)=>[`watchface_416x416/digits/${d}.png`,png(12,18,(x,y)=>(x+y+d)%3?[255,255,255,255]:[0,0,0,0])]));
 const built=[entry('info.json',JSON.stringify({m_name:'Built-in',m_app:'watchface_416x416',o_wf_ver:1,o_diy_version:2})),
  entry('watchface_customize.png',png(32,32,(x,y)=>[x*8,y*8,128,255])),
  entry('watchface_416x416/config.txt',['[background_icon_pos]={0,0}','[background_icon]=bg.png','[bg_color]=0xff0000',
   '[time_hour_high_pos]={100,120}','[time_hour_high_font]=digits','[step_rect]={10,20,30,40,right}','[step_font]=digits','[step_font_color]=0x00ff00',
   '[bluetooth_icon_pos]={-5,6}','[bluetooth_icon]=icon\\bt.png','[no_disturb_icon_pos]={7,8}','[no_disturb_icon]=icon/battery.png','[chart_selected_bar_color]=0xff0000','[chart_curves_lower_color]=0x00ff88','[weather_wind_icon_pos]={9,9}','[weather_wind_icon]=icon\\Heart.png',''].join('\r\n')),
  entry('watchface_416x416/AODconfig.txt','[background_icon_pos]={7,9}\n[background_icon]=aod.png\n[bg_color]=0xffffff\n[time_hour_high_pos]={100,120}\n[time_hour_high_font]=digits\n'),
  entry('watchface_416x416/bg.png',png(208,208,(x,y)=>[x,y,(x*y)&255,255])),
  entry('watchface_416x416/aod.png',png(208,208,(x,y)=>x>=20&&x<40&&y>=30&&y<50?[0,255,255,255]:[0,0,0,0])),
  entry('watchface_416x416/icon/bt.png',png(10,10)),entry('watchface_416x416/icon/battery.png',png(10,10)),entry('watchface_416x416/icon/heart.png',png(10,10)),
  ...Object.entries(glyphs).map(([name,data])=>entry(name,data))];
 const engine=new CorosWatchfaceCompiler(path.join(temp,'built-in'));
 const compiled=await engine.compile(await make('built-in.dat',built),'Built-in');
 assert.equal(compiled.model,'pace-pro');assert.equal('engine' in compiled,false);
 const bin=await fs.readFile(compiled.filePath);
 assert.equal(bin.toString('latin1',0,4),'614A');
 assert.equal(bin.readUInt32LE(4),compiled.faceId);
 assert.equal(bin.readUInt32LE(8),bin.length-18);
 assert.equal(bin.readUInt16LE(12),crc16(bin.subarray(18)));
 assert.equal(bin.readUInt32LE(0x322),0x1202,'AOD header follows the normal one');
 assert.equal(bin.readUInt32LE(0x1202+4),0xffffffff,'the AOD header carries no face ID');
 assert.equal(bin[0x22],0x30,'bg_color as rgb222');
 assert.equal(bin[0x13b],2,'o_diy_version');
 assert.deepEqual([bin.readUInt32LE(0xdde),bin.readUInt32LE(0xe62),bin.readUInt32LE(0xde2)],[0xff0000,0x00ff88,0],'chart colors are full RGB words, as in COROS-built faces');
 const blockAt=offset=>{const at=bin.readUInt32LE(offset);return at?[bin.readUInt16LE(at),bin.readUInt16LE(at+2),bin[at+6]]:null;};
 assert.deepEqual(blockAt(0x1a),[416,416,1],'background scaled to the screen');
 assert.deepEqual(blockAt(0x1e),[315,315,1],'thumbnail falls back to the preview, scaled to 315');
 const aodOffset=bin.readUInt32LE(0x322);
 assert.deepEqual(blockAt(aodOffset+0x1a),[416,416,1],'AOD background scales to the native display');
 assert.notEqual(bin.readUInt32LE(aodOffset+0x1a),bin.readUInt32LE(0x1a),'AOD keeps its independent background');
 assert.deepEqual([bin.readInt32LE(aodOffset+0x12),bin.readInt32LE(aodOffset+0x16)],[7,9],'AOD keeps its background position');
 assert.equal(bin.readUInt32LE(aodOffset+0x1e),0,'AOD has no picker thumbnail');
 assert.equal(bin[aodOffset+0x22],0,'AOD retains the firmware black fill, ignoring bg_color');
 const aodBlock=findCorosBitmapBlocks(bin,aodOffset+0x1202).find(block=>block.offset===bin.readUInt32LE(aodOffset+0x1a));
 const aodPixels=decodeCorosBitmapFrame(bin,aodBlock,0);
 const aodPixel=(x,y)=>[...aodPixels.subarray((y*416+x)*4,(y*416+x)*4+4)];
 assert.deepEqual(aodPixel(50,70),[0,255,255,255],'AOD artwork keeps its color');
 assert.deepEqual(aodPixel(208,208),[0,0,0,0],'AOD background transparency survives encoding');
 const backgroundCase=(config)=>compileWatchface(new Map(built.map(e=>[e.name,e.name.endsWith('/AODconfig.txt')?Buffer.from(config):e.data])),{faceId:1});
 const defaultPosition=backgroundCase('[background_icon]=aod.png\n').bin;
 assert.ok(defaultPosition.readUInt32LE(aodOffset+0x1a)>0,'Studio AOD backgrounds compile without a position key');
 assert.deepEqual([defaultPosition.readInt32LE(aodOffset+0x12),defaultPosition.readInt32LE(aodOffset+0x16)],[0,0],'an omitted AOD position defaults to the origin');
 assert.equal(backgroundCase('[time_hour_high_pos]={100,120}\n[time_hour_high_font]=digits\n').bin.readUInt32LE(aodOffset+0x1a),0,'a background-free AOD must not borrow Current artwork');
 const sharedBackground=backgroundCase('[background_icon]=bg.png\n').bin;
 assert.equal(sharedBackground.readUInt32LE(aodOffset+0x1a),sharedBackground.readUInt32LE(0x1a),'a shared Current/AOD background reuses its bitmap');
 const missingBackground=backgroundCase('[background_icon]=missing-aod.png\n');
 assert.equal(missingBackground.bin.readUInt32LE(aodOffset+0x1a),0,'a missing AOD background stays blank');
 assert.ok(missingBackground.warnings.includes('missing-aod.png is missing.'),'missing AOD backgrounds produce a warning');
 assert.deepEqual(blockAt(FIELDS.time_hour_high_font[1]),[12,18,10],'digit fonts are one 10-frame block');
 assert.equal(bin.readUInt32LE(FIELDS.step_font[1]),bin.readUInt32LE(FIELDS.time_hour_high_font[1]),'a shared font folder is stored once');
 assert.deepEqual([bin.readInt16LE(FIELDS.step_rect[1]),bin.readInt16LE(FIELDS.step_rect[1]+6),bin[FIELDS.step_rect[1]+8]],[10,40,0x14]);
 assert.deepEqual(blockAt(FIELDS.bluetooth_icon[1]),[10,10,1]);
 assert.deepEqual([bin.readInt32LE(FIELDS.bluetooth_icon_pos[1]),bin.readInt32LE(FIELDS.bluetooth_icon_pos[1]+4)],[5,6],'COROS drops minus signs in positions');
 assert.ok(compiled.warnings.includes('bluetooth_icon_pos is {-5,6}, but COROS drops minus signs, so it lands at {5,6}.'),compiled.warnings.join('\n'));
 assert.equal(bin.readUInt32LE(FIELDS.no_disturb_icon[1]),0,'"/" paths stay blank, as in COROS');
 assert.equal(bin.readUInt32LE(FIELDS.weather_wind_icon[1]),0,'paths are case-sensitive');
 assert.ok(compiled.warnings.some(w=>w==='icon/battery.png uses "/"; write it as icon\\battery.png.'),compiled.warnings.join('\n'));
 assert.ok(compiled.warnings.some(w=>w.includes('icon/Heart.png is missing; the archive has icon/heart.png')),compiled.warnings.join('\n'));
 assert.deepEqual([engine.status().phase,engine.status().busy],['ready',false]);
 const tooMany=[...built.filter(e=>!e.name.startsWith('watchface_416x416/digits/')),...Array.from({length:256},(_,i)=>entry(`watchface_416x416/digits/${String(i).padStart(3,'0')}.png`,png(2,2)))];
 await assert.rejects(engine.compile(await make('too-many.dat',tooMany),'Too many'),/too many images/);
 assert.equal(engine.status().phase,'failed');
 assert.throws(()=>compileWatchface(new Map([['info.json',Buffer.from('{}')]]),{faceId:1}),WatchfaceCompileError);
 // CorosLink-only chart heart rate (WFChartInfo.heart_rate, NOMAD's second daily page): written like chart_step at 0xf86, sharing its font.
 const heart=new Map([['info.json',Buffer.from('{}')],['watchface_416x416/config.txt',Buffer.from('[chart_rect]={89,273,323,325}\n[chart_step_icon_pos]={147,343}\n[chart_step_icon]=step.png\n[chart_step_rect]={189,343,257,374,hcenter|vcenter}\n[chart_step_font]=num\n[chart_heart_rate_icon_pos]={227,293}\n[chart_heart_rate_icon]=heart.png\n[chart_heart_rate_rect]={270,293,335,328,hcenter|vcenter}\n[chart_heart_rate_font]=num\n')],
  ['watchface_416x416/step.png',png(3,2)],['watchface_416x416/heart.png',png(2,3)],...Array.from({length:10},(_,d)=>[`watchface_416x416/num/${d}.png`,png(4,5)])]);
 const heartBin=compileWatchface(heart,{faceId:1}).bin;
 assert.deepEqual([heartBin.readInt32LE(0xf86),heartBin.readInt32LE(0xf8a),...[0,2,4,6].map(i=>heartBin.readInt16LE(0xf92+i))],[227,293,270,293,335,328]);
 assert.ok(heartBin.readUInt32LE(0xf8e)>heartBin.readUInt32LE(0xf74),'the heart icon block follows the step icon, as in official NOMAD');
 assert.equal(heartBin.readUInt32LE(0xf9c),heartBin.readUInt32LE(0xf82),'one font block shared with chart_step');
 assert.equal(heartBin.readUInt16LE(0x138),0x1202,'faces without decimal points keep COROS\'s header size');
 // CorosLink-only decimal points of activity totals (issue #153): PACE Pro reads them past the 0x1202 header.
 const swimConfig='[week_swim_icon_pos]={100,200}\n[week_swim_icon]=swim.png\n[week_swim_rect]={130,200,200,230,left|vcenter}\n[week_swim_font]=num\n[week_swim_unit_icon]=unit\n[week_swim_point_icon]=point.png\n';
 const swimFiles=[['info.json',Buffer.from('{}')],['watchface_416x416/swim.png',png(3,2)],['watchface_416x416/point.png',png(2,7)],['watchface_416x416/unit/00.png',png(5,7)],['watchface_416x416/unit/01.png',png(5,7)],...Array.from({length:10},(_,d)=>[`watchface_416x416/num/${d}.png`,png(4,7)])];
 const swim=(config,aod)=>compileWatchface(new Map([...swimFiles,['watchface_416x416/config.txt',Buffer.from(config)],...(aod?[['watchface_416x416/AODconfig.txt',Buffer.from(aod)]]:[])]),{faceId:1}).bin;
 const swimBin=swim(swimConfig);
 assert.equal(swimBin.readUInt16LE(0x138),0x1222,'a decimal point extends the header, as some official faces are');
 const pointAt=swimBin.readUInt32LE(0x1216);
 assert.ok(pointAt>0,'week swim point at 0x1202 + 4 × 5');
 assert.deepEqual([swimBin.readUInt16LE(pointAt),swimBin.readUInt16LE(pointAt+2),swimBin[pointAt+6]],[2,7,1],'the point is a single image');
 assert.ok(pointAt>swimBin.readUInt32LE(0x1124),'the point block follows the unit block');
 assert.deepEqual([0x1202,0x1206,0x120a,0x120e,0x1212,0x121a,0x121e].map(offset=>swimBin.readUInt32LE(offset)),[0,0,0,0,0,0,0],'other totals keep no point');
 const swimLayout=decodeCorosLayout(swimBin,findCorosBitmapBlocks(swimBin,0x1222));
 assert.ok(swimLayout.modes[0].elements.some(element=>element.id==='weekSwim.decimal'&&element.active&&element.config?.asset==='week_swim_point_icon'),'recovery reads the point back');
 const swimAod=swim(swimConfig,'[week_swim_icon_pos]={100,200}\n[week_swim_icon]=swim.png\n');
 assert.deepEqual([swimAod.readUInt32LE(0x322),swimAod.readUInt16LE(0x1222+0x138),swimAod.toString('latin1',0x1222,0x1226)],[0x1222,0x1222,'614A'],'the AOD header follows at the same size');
 assert.equal(swim(swimConfig.replace(/\[week_swim_point_icon\][^\n]*\n/,'')).readUInt16LE(0x138),0x1202,'without the point the header stays 0x1202');
 assert.equal(swim(swimConfig.replace(/\[week_swim_icon_pos\][^\n]*\n/,'')).readUInt16LE(0x138),0x1202,'a point without its total is not written');
 // Records COROS's own compiler writes for fields the field probe never reached (offsets read from it on 2026-10-25).
 const blockOf=(b,offset)=>{const at=b.readUInt32LE(offset);return at?[b.readUInt16LE(at),b.readUInt16LE(at+2),b[at+6]]:null;};
 const numFont=Array.from({length:10},(_,d)=>[`watchface_416x416/num/${d}.png`,png(4,5)]);
 const bare=(config,files)=>compileWatchface(new Map([['info.json',Buffer.from('{}')],['watchface_416x416/config.txt',Buffer.from(config)],...files]),{faceId:1}).bin;
 // The selectable barometer, directional branch: position 0x396, down/flat/up icons 0x39e/0x3a2/0x3a6, integer rectangle 0x3aa, decimal rectangle 0x3b4, font 0x3be, tint 0x3c2.
 const baroConfig=['[rect_control1_pos]={50,250}','[control_barometer_icon_pos]={3,4}','[control_barometer_down_icon]=down.png','[control_barometer_flat_icon]=flat.png','[control_barometer_up_icon]=up.png',
  '[control_barometer_integer_rect]={20,0,70,30,hcenter|vcenter}','[control_barometer_decimal_rect]={75,0,100,30,hcenter|vcenter}','[control_barometer_font]=num','[control_barometer_font_color]=0xff0000','[control_point_icon]=point.png'].join('\n')+'\n';
 const baroFiles=[['watchface_416x416/down.png',png(11,7)],['watchface_416x416/flat.png',png(12,8)],['watchface_416x416/up.png',png(13,9)],['watchface_416x416/point.png',png(2,7)],...numFont];
 const baroBin=bare(baroConfig,baroFiles);
 assert.deepEqual([baroBin.readInt32LE(0x396),baroBin.readInt32LE(0x39a)],[3,4],'barometer position');
 assert.deepEqual([blockOf(baroBin,0x39e),blockOf(baroBin,0x3a2),blockOf(baroBin,0x3a6)],[[11,7,1],[12,8,1],[13,9,1]],'three trend icons');
 assert.deepEqual([baroBin.readInt16LE(0x3aa),baroBin.readInt16LE(0x3ae),baroBin.readInt16LE(0x3b4),baroBin.readInt16LE(0x3b8)],[20,70,75,100],'integer and decimal rectangles');
 assert.deepEqual(blockOf(baroBin,0x3be),[4,5,10],'one digit font');
 assert.equal(baroBin[0x3c2],0x30,'font tint as rgb222');
 assert.equal(baroBin[0x13a],0,'the barometer needs no format version');
 assert.equal(baroBin.readUInt32LE(0x4c2)>0,true,'the decimal point is the shared control_point_icon');
 assert.equal(bare(baroConfig.replace(/\[control_barometer_font\][^\n]*\n/,''),baroFiles).readInt16LE(0x3aa),0,'the rectangles wait for the font, as in COROS');
 assert.equal(bare(baroConfig.replace(/\[rect_control1_pos\][^\n]*\n/,''),baroFiles).readUInt32LE(0x39e),0,'control records wait for the control origin');
 const baroLayout=decodeCorosLayout(baroBin,findCorosBitmapBlocks(baroBin,0x1202));
 const baroElements=baroLayout.modes[0].elements.filter(element=>element.control==='barometer'&&element.active);
 assert.deepEqual(baroElements.map(element=>element.id).sort(),['control.barometer.decimal','control.barometer.down','control.barometer.flat','control.barometer.up','control.barometer.value'],'recovery reads the barometer record back');
 assert.deepEqual(baroElements.find(element=>element.id==='control.barometer.down').position,{x:3,y:4},'the trend icons share the record position');
 // The airplane and sleep images are drawn at the Bluetooth and Do Not Disturb positions (firmware 0x4cb4c4); the compiler writes those only beside the indicator's own icon.
 const statusFiles=[['watchface_416x416/blank.png',png(1,1,()=>[0,0,0,0])],['watchface_416x416/air.png',png(30,28)],['watchface_416x416/bed.png',png(32,30)]];
 const statusBin=bare('[bluetooth_icon_pos]={30,40}\n[bluetooth_off_icon]=blank.png\n[airplane_icon]=air.png\n[no_disturb_icon_pos]={330,40}\n[no_disturb_off_icon]=blank.png\n[sleep_mode_icon]=bed.png\n',statusFiles);
 assert.deepEqual([statusBin.readInt32LE(0x26),statusBin.readInt32LE(0x42),blockOf(statusBin,0x56),blockOf(statusBin,0x52)],[30,330,[30,28,1],[32,30,1]],'airplane and sleep images beside their indicators');
 const lonelyAirplane=bare('[bluetooth_icon_pos]={30,40}\n[airplane_icon]=air.png\n',statusFiles);
 assert.deepEqual([lonelyAirplane.readInt32LE(0x26),blockOf(lonelyAirplane,0x56)],[0,[30,28,1]],'an airplane image alone leaves its position unwritten, which is why Studio adds a blank indicator icon');
 // The lunar date tables: a rectangle and a frame table each, Simplified at 0xbaa and Traditional at 0xbda; one folder serves both.
 const lunarFrames=(n,w,h)=>Array.from({length:n},(_,i)=>[`watchface_416x416/ly/${String(i).padStart(2,'0')}.png`,png(w,h,()=>[i*9,20,40,255])]);
 const lunarBin=bare('[chinese_lunar_year_rect]={10,20,142,68,left|vcenter}\n[chinese_lunar_year_icon_dir]=ly\n[chinese_tw_lunar_year_rect]={10,20,142,68,left|vcenter}\n[chinese_tw_lunar_year_icon_dir]=ly\n',lunarFrames(23,44,48));
 assert.deepEqual([lunarBin.readInt16LE(0xbaa),lunarBin.readInt16LE(0xbae),lunarBin[0xbb2],blockOf(lunarBin,0xbb4)],[10,142,0x11,[44,48,23]],'year table: rectangle, left|vcenter, 23 frames');
 assert.equal(lunarBin.readUInt32LE(0xbe4),lunarBin.readUInt32LE(0xbb4),'the Traditional table shares the Simplified block');
 assert.equal(lunarBin[0x13a],1,'the lunar date needs format version 1');
 assert.equal(bare('[chinese_lunar_year_rect]={10,20,142,68,left|vcenter}\n',[]).readInt16LE(0xbaa),0,'the rectangle waits for its frames');
 console.log(`Built-in compiler units, worker compile (${compiled.durationMs} ms), headers, CRC, AOD, warnings and face errors passed.`);

 // Only CorosLink's compiler: the old COROS-compiler switch is ignored, and every watch builds through the same service.
 process.env.COROSLINK_WATCHFACE_COMPILER='coros';
 const only=new CorosWatchfaceCompiler(path.join(temp,'only'));
 const again=await only.compile(await make('only.dat',built),'Only');
 assert.ok((await fs.readFile(again.filePath)).equals(await fs.readFile(compiled.filePath)),'the same face compiles to the same bytes');
 delete process.env.COROSLINK_WATCHFACE_COMPILER;
 const apex=[entry('info.json','{"m_name":"APEX"}'),entry('watchface_260x260/config.txt','[background_icon_pos]={0,0}\n[background_icon]=bg.png\n'),
  entry('watchface_260x260/bg.png',png(26,26,(x,y)=>[x*9,y*9,90,255]))];
 const apexBuilt=await only.compile(await make('apex.dat',apex),'APEX',getWatchfaceTarget('apex-4'));
 assert.equal(apexBuilt.model,'apex-4');
 assert.equal((await fs.readFile(apexBuilt.filePath)).toString('latin1',0,4),'062R','APEX 4 builds its own memory-in-pixel BIN');
 await assert.rejects(only.compile(await make('apex-only.dat',apex),'APEX',getWatchfaceTarget('pace-pro')),/416 × 416 PACE Pro/);
 console.log('One compiler for every watch: no COROS engine, stable output, APEX 4 memory-in-pixel BIN passed.');
}finally{await fs.rm(temp,{recursive:true,force:true});}
