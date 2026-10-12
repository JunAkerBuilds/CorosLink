const path=require('node:path');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {Arch}=require('builder-util');
exports.default=async function beforePack(context) {
  if(context.electronPlatformName!=='darwin') {
    const bin=path.join(context.packager.projectDir,'bin',`${context.electronPlatformName}-${Arch[context.arch]}`,'python-runtime');
    const executable=context.electronPlatformName==='win32'?path.join(bin,'python.exe'):path.join(bin,'bin','python3');
    if(!fs.existsSync(executable)) throw new Error('Prepare the bundled Python runtime with binaries:prepare before packaging system Bluetooth.');
  }
  execFileSync(process.execPath,[path.join(context.packager.projectDir,'scripts','prepare-system-bluetooth.mjs'),
    `--platform=${context.electronPlatformName}`,`--arch=${Arch[context.arch]}`],{stdio:'inherit'});
};
