import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function prepareCoreBluetooth(arch=process.arch) {
  if(process.platform!=='darwin') return;
  if(!['arm64','x64'].includes(arch)) throw new Error('Unsupported macOS Bluetooth helper architecture.');
  const destination=path.join(root,'bin',`darwin-${arch}`,'coros-corebluetooth');
  const source=path.join(root,'native','corebluetooth','main.swift');
  const info=path.join(root,'native','corebluetooth','Info.plist');
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  if(!fs.existsSync(destination)||fs.statSync(destination).mtimeMs<Math.max(fs.statSync(source).mtimeMs,fs.statSync(info).mtimeMs)) {
    const temporary=`${destination}.tmp-${process.pid}`;
    try {
      execFileSync('xcrun',['swiftc','-O','-swift-version','5','-target',`${arch==='arm64'?'arm64':'x86_64'}-apple-macosx11.0`,
        '-framework','CoreBluetooth',source,'-o',temporary,'-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',info],{stdio:'inherit'});
      fs.chmodSync(temporary,0o755);
      fs.renameSync(temporary,destination);
    } finally {fs.rmSync(temporary,{force:true});}
  }
  // Electron's development host needs the same purpose string as the package.
  const electronInfo=path.join(root,'node_modules','electron','dist','Electron.app','Contents','Info.plist');
  if(fs.existsSync(electronInfo)) {
    const value='CorosLink uses Bluetooth to connect to your COROS watch.';
    try {execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :NSBluetoothAlwaysUsageDescription ${value}`,electronInfo],{stdio:'ignore'});}
    catch {execFileSync('/usr/libexec/PlistBuddy',['-c',`Add :NSBluetoothAlwaysUsageDescription string ${value}`,electronInfo],{stdio:'ignore'});}
  }
  console.log(`Prepared native Bluetooth helper for macOS ${arch}.`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const arch=process.argv.find(x=>x.startsWith('--arch='))?.slice(7)||process.arch;
  prepareCoreBluetooth(arch);
}
