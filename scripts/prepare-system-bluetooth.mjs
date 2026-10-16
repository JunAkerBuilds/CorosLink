import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareCoreBluetooth} from './prepare-corebluetooth.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function prepareSystemBluetooth(platform=process.platform,arch=process.arch) {
  if(platform==='darwin') {
    if(process.platform!=='darwin') throw new Error('Building the CoreBluetooth helper requires macOS and Xcode command-line tools.');
    prepareCoreBluetooth(arch);return;
  }
  const lock=JSON.parse(fs.readFileSync(path.join(root,'scripts','bundled-bleak.lock.json'),'utf8'));
  const target=`${platform}-${arch}`, wheels=lock.targets[target];
  if(!wheels) throw new Error(`System Bluetooth is not supported for ${target}.`);
  // Compiled wheels only import on the CPython they were built for: winrt has no
  // pure-Python fallback, so a cp310 wheel under the bundled 3.11 breaks Windows Bluetooth.
  const runtime=JSON.parse(fs.readFileSync(path.join(root,'scripts','bundled-binaries.lock.json'),'utf8')).python.version.split('.').slice(0,2).join('.');
  const abi=`cp${runtime.replace('.','')}`;
  const stale=wheels.filter(wheel=>!wheel.filename.endsWith('-none-any.whl')&&!wheel.filename.includes(`-${abi}-`));
  if(lock.pythonVersion!==runtime||stale.length) throw new Error(
    `scripts/bundled-bleak.lock.json targets Python ${lock.pythonVersion} but the bundled runtime is ${runtime}${stale.length?` (${stale.map(wheel=>wheel.filename).join(', ')})`:''}. Re-pin the Bluetooth wheels for ${abi}.`);
  const bin=path.join(root,'bin',target), destination=path.join(bin,'ble-python');
  const marker=path.join(destination,'coroslink-ble-dependencies.json');
  const fingerprint=createHash('sha256').update(JSON.stringify(wheels)).digest('hex');
  if(fs.existsSync(marker)&&JSON.parse(fs.readFileSync(marker,'utf8')).fingerprint===fingerprint) return;
  const temporary=path.join(bin,'.ble-wheels');fs.mkdirSync(temporary,{recursive:true});
  try {
    await Promise.all(wheels.map(async wheel=>{
      const response=await fetch(wheel.url);
      if(!response.ok) throw new Error(`Could not download ${wheel.filename}.`);
      const bytes=Buffer.from(await response.arrayBuffer());
      if(createHash('sha256').update(bytes).digest('hex')!==wheel.sha256) throw new Error(`Hash mismatch for ${wheel.filename}.`);
      fs.writeFileSync(path.join(temporary,wheel.filename),bytes);
    }));
    fs.rmSync(destination,{recursive:true,force:true});fs.mkdirSync(destination,{recursive:true});
    const extractor=`import pathlib,sys,zipfile\nsource=pathlib.Path(sys.argv[1]);destination=pathlib.Path(sys.argv[2]).resolve()\nfor file in source.glob('*.whl'):\n with zipfile.ZipFile(file) as archive:\n  for item in archive.infolist():\n   target=(destination/item.filename).resolve()\n   if not target.is_relative_to(destination): raise ValueError('unsafe wheel path')\n  archive.extractall(destination)\n`;
    let succeeded=false;
    for(const python of ['python3','python']) {
      try {execFileSync(python,['-c',extractor,temporary,destination],{stdio:'inherit'});succeeded=true;break;}
      catch(error){if(error.code!=='ENOENT') throw error;}
    }
    if(!succeeded) throw new Error('Python 3 is required when preparing bundled Bluetooth packages.');
    fs.writeFileSync(marker,JSON.stringify({fingerprint,pythonVersion:lock.pythonVersion,bleakVersion:lock.bleakVersion}));
    console.log(`Prepared hash-verified native Bluetooth dependencies for ${target}.`);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await prepareSystemBluetooth(process.argv.find(x=>x.startsWith('--platform='))?.slice(11)||process.platform,
    process.argv.find(x=>x.startsWith('--arch='))?.slice(7)||process.arch);
}
