import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
/** Builds the native watch face compiler host. It runs the user's Android arm64
 * COROS compiler libraries directly, so it exists only for Apple Silicon. */
export function prepareWatchfaceCompiler(arch=process.arch) {
  if(process.platform!=='darwin'||arch!=='arm64') return;
  const sourceDirectory=path.join(root,'native','watchface-compiler-macos');
  const sources=fs.readdirSync(sourceDirectory).filter(name=>/\.(c|h|S)$/.test(name)).map(name=>path.join(sourceDirectory,name));
  const destination=path.join(root,'bin','darwin-arm64','coros-watchface-compiler');
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  const newest=Math.max(...sources.map(file=>fs.statSync(file).mtimeMs));
  if(fs.existsSync(destination)&&fs.statSync(destination).mtimeMs>=newest) return;
  const temporary=`${destination}.tmp-${process.pid}`;
  try {
    execFileSync('xcrun',['clang','-O2','-Wall','-Wextra','-Wno-unused-parameter','-target','arm64-apple-macosx12.0',
      ...sources.filter(file=>!file.endsWith('.h')),'-o',temporary],{stdio:'inherit'});
    fs.chmodSync(temporary,0o755);
    fs.renameSync(temporary,destination);
  } finally {fs.rmSync(temporary,{force:true});}
  console.log('Prepared native watch face compiler for macOS arm64.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  prepareWatchfaceCompiler(process.argv.find(x=>x.startsWith('--arch='))?.slice(7)||process.arch);
}
