#!/usr/bin/env node
// Configures CorosLink's local watch face compiler.
//   node scripts/configure-watchface-compiler.mjs [--libs DIR] [userDataCompilerDirectory]
// DIR holds libc++_shared.so, libprotobuf.so and libw4-watchface.so from the
// user's COROS APK (lib/arm64-v8a). They run natively on Apple Silicon. When the
// Android helper APK has been built, the emulator is configured as a fallback.
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const args=process.argv.slice(2);
const libsFlag=args.indexOf('--libs');
const libs=path.resolve(libsFlag>=0?args.splice(libsFlag,2)[1]:path.join(root,'.work/watchface-compiler/libs/arm64-v8a'));
const directory=args[0]??path.join(os.homedir(),'Library/Application Support/coroslink/watchface-compiler');
const sha=data=>createHash('sha256').update(data).digest('hex');
await fs.mkdir(directory,{recursive:true,mode:0o700});
const runtime={version:2};

const nativeDirectory=path.join(directory,'native-libs');
await fs.mkdir(nativeDirectory,{recursive:true,mode:0o700});
runtime.nativeLibraries={directory:nativeDirectory,sha256:{}};
for(const name of ['libc++_shared.so','libprotobuf.so','libw4-watchface.so']) {
  const data=await fs.readFile(path.join(libs,name));
  await fs.writeFile(path.join(nativeDirectory,name),data,{mode:0o600});
  runtime.nativeLibraries.sha256[name]=sha(data);
}

const apkSource=path.join(root,'native/watchface-compiler/build/outputs/apk/debug/CorosLinkWatchfaceCompiler-debug.apk');
if(existsSync(apkSource)) {
  const apk=await fs.readFile(apkSource);
  const apkPath=path.join(directory,'compiler.apk');
  await fs.writeFile(apkPath,apk,{mode:0o600});
  Object.assign(runtime,{sdkDirectory:path.join(root,'.work/ble-monitor/sdk'),apkPath,apkSha256:sha(apk),
    avdHome:path.join(root,'.work/watchface-compiler/avd'),androidUserHome:path.join(root,'.work/watchface-compiler/android'),avdName:'COROS_WATCHFACE_COMPILER_API35'});
}
await fs.writeFile(path.join(directory,'runtime.json'),JSON.stringify(runtime,null,2)+'\n',{mode:0o600});
console.log(`Local watch face compiler configured (native${runtime.apkPath?' with Android emulator fallback':''}).`);
